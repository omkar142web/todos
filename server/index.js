require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");

const {
  get,
  all,
  run,
  withTransaction,
  ready,
  isRemote,
  dbKind,
  rowToFolder,
  rowToTodo,
} = require("./db");
const {
  signToken,
  requireAuth,
  hashPassword,
  verifyPassword,
  newId,
  normalizeUsername,
  isValidUsername,
} = require("./auth");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "..");

// Behind Render / Railway / Fly / Nginx: correct client IPs for rate-limiting.
app.set("trust proxy", 1);

// Never deploy with the dev fallback secret — tokens would be forgeable.
if (
  process.env.NODE_ENV === "production" &&
  !process.env.JWT_SECRET
) {
  console.error("FATAL: JWT_SECRET must be set in production.");
  process.exit(1);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));

const corsOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
app.use("/api/auth/", authLimiter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Serverless hosts (Vercel) boot the app per invocation: ensure the DB
// schema exists before any /api handler runs. One shared promise, so warm
// processes and concurrent requests don't race it.
app.use("/api", async (req, res, next) => {
  try {
    await ready();
    next();
  } catch (err) {
    next(err);
  }
});

/* ---------- Auth ---------- */

app.post("/api/auth/signup", async (req, res) => {
  const username = normalizeUsername(req.body && req.body.username);
  const password = String((req.body && req.body.password) || "");

  if (!isValidUsername(username))
    return res.status(400).json({
      error: "Username must be 3-20 chars: letters, numbers, underscore",
    });
  if (password.length < 8)
    return res.status(400).json({ error: "Password must be 8+ characters" });

  const existing = await get(
    "SELECT id FROM users WHERE username = ?",
    username,
  );
  if (existing)
    return res.status(409).json({ error: "Username already in use" });

  const id = newId();
  const now = Date.now();
  const password_hash = await hashPassword(password);
  await run(
    "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
    id,
    username,
    password_hash,
    now,
  );

  const token = signToken({ id, username });
  res.status(201).json({ token, user: { id, username } });
});

app.post("/api/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body && req.body.username);
  const password = String((req.body && req.body.password) || "");

  if (!isValidUsername(username) || !password)
    return res.status(400).json({ error: "Enter username and password" });

  const row = await get("SELECT * FROM users WHERE username = ?", username);
  if (!row)
    return res.status(401).json({ error: "Invalid username or password" });

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok)
    return res.status(401).json({ error: "Invalid username or password" });

  const token = signToken({ id: row.id, username: row.username });
  res.json({ token, user: { id: row.id, username: row.username } });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const row = await get("SELECT id, username FROM users WHERE id = ?", req.userId);
  if (!row) return res.status(401).json({ error: "User not found" });
  res.json({ user: row });
});

/* ---------- Validation helpers ---------- */

const PRIORITIES = new Set(["none", "low", "medium", "high"]);

function cleanTodoInput(body, fallbackId) {
  const title = String(body.title || "").trim().slice(0, 200);
  if (!title) return { error: "Title is required" };
  const description = String(body.description || "").slice(0, 5000);
  const due =
    body.due === "" || body.due == null ? "" : String(body.due).slice(0, 10);
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due))
    return { error: "Due must be YYYY-MM-DD" };
  const priority = PRIORITIES.has(body.priority) ? body.priority : "none";
  const folderId = String(body.folderId || body.folder_id || "").slice(0, 64);
  const completed = body.completed === true || body.completed === 1 ? 1 : 0;
  const createdAt = Number(body.createdAt || body.created_at) || Date.now();
  const updatedAt = Number(body.updatedAt || body.updated_at) || Date.now();
  return {
    value: {
      id: String(body.id || fallbackId).slice(0, 64),
      title,
      description,
      due,
      priority,
      folderId,
      completed,
      createdAt,
      updatedAt,
    },
  };
}

/* ---------- State ---------- */

app.get("/api/state", requireAuth, async (req, res) => {
  const folders = (
    await all(
      "SELECT * FROM folders WHERE user_id = ? ORDER BY created_at ASC",
      req.userId,
    )
  ).map(rowToFolder);
  const todos = (
    await all(
      "SELECT * FROM todos WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5000",
      req.userId,
    )
  ).map(rowToTodo);
  res.json({ todos, folders });
});

/* ---------- Todos ---------- */

app.put("/api/todos/:id", requireAuth, async (req, res) => {
  const { error, value } = cleanTodoInput(
    { ...req.body, id: req.params.id },
    req.params.id,
  );
  if (error) return res.status(400).json({ error });

  // Folder must belong to user (or be empty = inbox).
  if (value.folderId) {
    const f = await get(
      "SELECT id FROM folders WHERE id = ? AND user_id = ?",
      value.folderId,
      req.userId,
    );
    if (!f) value.folderId = "";
  }

  const existing = await get(
    "SELECT updated_at FROM todos WHERE id = ? AND user_id = ?",
    value.id,
    req.userId,
  );
  // Last-write-wins: ignore stale writes from another device.
  if (existing && existing.updated_at > value.updatedAt) {
    const current = await get(
      "SELECT * FROM todos WHERE id = ? AND user_id = ?",
      value.id,
      req.userId,
    );
    return res.json({ todo: rowToTodo(current), stale: true });
  }

  await run(
    `INSERT INTO todos (id, user_id, title, description, due, priority, folder_id, completed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, user_id) DO UPDATE SET
       title=excluded.title, description=excluded.description, due=excluded.due,
       priority=excluded.priority, folder_id=excluded.folder_id,
       completed=excluded.completed, updated_at=excluded.updated_at`,
    value.id,
    req.userId,
    value.title,
    value.description,
    value.due,
    value.priority,
    value.folderId,
    value.completed,
    value.createdAt,
    value.updatedAt,
  );
  const row = await get(
    "SELECT * FROM todos WHERE id = ? AND user_id = ?",
    value.id,
    req.userId,
  );
  res.json({ todo: rowToTodo(row) });
});

app.delete("/api/todos/:id", requireAuth, async (req, res) => {
  await run("DELETE FROM todos WHERE id = ? AND user_id = ?", req.params.id, req.userId);
  res.json({ ok: true });
});

/* ---------- Folders ---------- */

app.put("/api/folders/:id", requireAuth, async (req, res) => {
  const name = String((req.body && req.body.name) || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Folder name is required" });
  const createdAt = Number(req.body.createdAt) || Date.now();
  const updatedAt = Number(req.body.updatedAt) || Date.now();
  const id = String(req.params.id).slice(0, 64);

  const dup = await get(
    "SELECT id FROM folders WHERE user_id = ? AND lower(name) = lower(?) AND id != ?",
    req.userId,
    name,
    id,
  );
  if (dup) return res.status(409).json({ error: "Folder already exists" });

  const existing = await get(
    "SELECT updated_at FROM folders WHERE id = ? AND user_id = ?",
    id,
    req.userId,
  );
  if (existing && existing.updated_at > updatedAt) {
    const current = await get(
      "SELECT * FROM folders WHERE id = ? AND user_id = ?",
      id,
      req.userId,
    );
    return res.json({ folder: rowToFolder(current), stale: true });
  }

  await run(
    `INSERT INTO folders (id, user_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id, user_id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`,
    id,
    req.userId,
    name,
    createdAt,
    updatedAt,
  );
  const row = await get(
    "SELECT * FROM folders WHERE id = ? AND user_id = ?",
    id,
    req.userId,
  );
  res.json({ folder: rowToFolder(row) });
});

app.delete("/api/folders/:id", requireAuth, async (req, res) => {
  const id = req.params.id;
  const now = Date.now();
  await withTransaction(async (t) => {
    await t.run(
      "UPDATE todos SET folder_id = '', updated_at = ? WHERE user_id = ? AND folder_id = ?",
      now,
      req.userId,
      id,
    );
    await t.run("DELETE FROM folders WHERE id = ? AND user_id = ?", id, req.userId);
  });
  res.json({ ok: true, updatedAt: now });
});

/** Bulk import for first-login migration. Upserts only, never deletes. */
app.post("/api/sync/import", requireAuth, async (req, res) => {
  const todos = Array.isArray(req.body.todos) ? req.body.todos.slice(0, 5000) : [];
  const folders = Array.isArray(req.body.folders)
    ? req.body.folders.slice(0, 500)
    : [];

  let importedTodos = 0;
  let importedFolders = 0;

  await withTransaction(async (t) => {
    for (const f of folders) {
      const name = String(f.name || "").trim().slice(0, 80);
      if (!name) continue;
      const id = String(f.id || "").slice(0, 64);
      if (!id) continue;
      const createdAt = Number(f.createdAt) || Date.now();
      const updatedAt = Number(f.updatedAt) || Date.now();
      const dup = await t.get(
        "SELECT id FROM folders WHERE user_id = ? AND lower(name) = lower(?) AND id != ?",
        req.userId,
        name,
        id,
      );
      if (dup) continue;
      await t.run(
        `INSERT INTO folders (id, user_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id, user_id) DO UPDATE SET name=excluded.name, updated_at=MAX(folders.updated_at, excluded.updated_at)`,
        id,
        req.userId,
        name,
        createdAt,
        updatedAt,
      );
      importedFolders++;
    }
    const folderIds = new Set(
      (await t.all("SELECT id FROM folders WHERE user_id = ?", req.userId)).map(
        (r) => r.id,
      ),
    );
    for (const td of todos) {
      const { error, value } = cleanTodoInput(td, td.id);
      if (error || !value.id) continue;
      if (value.folderId && !folderIds.has(value.folderId)) value.folderId = "";
      await t.run(
        `INSERT INTO todos (id, user_id, title, description, due, priority, folder_id, completed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id, user_id) DO UPDATE SET
           title=excluded.title, description=excluded.description, due=excluded.due,
           priority=excluded.priority, folder_id=excluded.folder_id,
           completed=excluded.completed, updated_at=MAX(todos.updated_at, excluded.updated_at)`,
        value.id,
        req.userId,
        value.title,
        value.description,
        value.due,
        value.priority,
        value.folderId,
        value.completed,
        value.createdAt,
        value.updatedAt,
      );
      importedTodos++;
    }
  });

  res.json({ ok: true, importedTodos, importedFolders });
});

// JSON errors for API callers (Express default would send HTML).
app.use("/api", (err, req, res, next) => {
  console.error("API error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Server error" });
});

/* ---------- Static frontend (same-origin, no CORS needed) ---------- */

// Allowlist: only the public frontend files are ever served.
// (Serving the repo root would leak server/*.js and data/focus.db.)
const PUBLIC_FILES = new Set(["index.html", "app.js", "styles.css"]);

app.get(["/", "/index.html"], (req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

app.get("/app.js", (req, res) => {
  res.type("text/javascript").sendFile(path.join(ROOT, "app.js"));
});

app.get("/styles.css", (req, res) => {
  res.type("text/css").sendFile(path.join(ROOT, "styles.css"));
});

// SPA fallback for non-API routes. Unknown /api/* routes fall through to
// Express's default JSON 404 instead of returning index.html.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (PUBLIC_FILES.has(req.path.slice(1))) return next();
  res.sendFile(path.join(ROOT, "index.html"));
});

if (require.main === module) {
  // Traditional hosts (Render, Railway, `npm start`): long-lived process.
  ready()
    .then(() => {
      console.log(`DB: ${dbKind}`);
      app.listen(PORT, () => {
        console.log(`Focus todo server on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error("FATAL: database init failed:", err);
      process.exit(1);
    });
} else {
  // Serverless (Vercel): the platform invokes the exported app per request.
  // Schema init happens lazily via the /api gate above.
  ready().catch((err) => console.error("Database init failed:", err));
}

module.exports = app;

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

// Database backend:
// - Supabase / any Postgres: set DATABASE_URL (pooling string, port 6543).
//   Required on Vercel; recommended on Render/Railway.
// - Turso (libSQL): set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN).
// - Neither: local SQLite file for offline dev (same schema, same SQL family).
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const TURSO_URL = String(process.env.TURSO_DATABASE_URL || "").trim();
const TURSO_TOKEN = String(process.env.TURSO_AUTH_TOKEN || "").trim();

const dbKind = DATABASE_URL
  ? "supabase"
  : TURSO_URL
    ? "turso"
    : "local file";
const isRemote = dbKind !== "local file";

let pgPool = null; // created lazily so `require("./db")` never connects
function pool() {
  if (!pgPool) {
    // eslint-disable-next-line global-require
    const { Pool } = require("pg");
    // Reuse across serverless invocations in the same warm process.
    if (!globalThis.__focusPgPool) {
      globalThis.__focusPgPool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 5,
      });
    }
    pgPool = globalThis.__focusPgPool;
  }
  return pgPool;
}

let libsql = null; // created lazily for the same reason
function local() {
  if (!libsql) {
    // eslint-disable-next-line global-require
    const { createClient } = require("@libsql/client");
    if (TURSO_URL) {
      libsql = createClient({
        url: TURSO_URL,
        authToken: TURSO_TOKEN || undefined,
      });
    } else {
      const DB_PATH =
        process.env.DATABASE_PATH ||
        path.join(__dirname, "..", "data", "focus.db");
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      libsql = createClient({ url: pathToFileURL(DB_PATH).href });
    }
  }
  return libsql;
}

// Route code always uses `?` placeholders. Postgres needs `$1, $2, …`
// and has no scalar MAX() (use GREATEST instead) — translate on that path.
function toPostgres(sql) {
  let i = 0;
  return sql
    .replace(/\?/g, () => "$" + ++i)
    .replace(/MAX\(/g, "GREATEST(");
}

async function get(sql, ...args) {
  if (dbKind === "supabase") {
    const res = await pool().query(toPostgres(sql), args);
    return res.rows[0];
  }
  const res = await local().execute({ sql, args });
  return res.rows[0];
}

async function all(sql, ...args) {
  if (dbKind === "supabase") {
    const res = await pool().query(toPostgres(sql), args);
    return res.rows;
  }
  const res = await local().execute({ sql, args });
  return res.rows;
}

async function run(sql, ...args) {
  if (dbKind === "supabase") {
    await pool().query(toPostgres(sql), args);
    return;
  }
  await local().execute({ sql, args });
}

async function withTransaction(fn) {
  if (dbKind === "supabase") {
    const client = await pool().connect();
    const api = {
      get: async (sql, ...args) =>
        (await client.query(toPostgres(sql), args)).rows[0],
      all: async (sql, ...args) =>
        (await client.query(toPostgres(sql), args)).rows,
      run: async (sql, ...args) => {
        await client.query(toPostgres(sql), args);
      },
    };
    try {
      await client.query("BEGIN");
      const out = await fn(api);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      throw err;
    } finally {
      client.release();
    }
  }
  const tx = await local().transaction("write");
  const api = {
    get: async (sql, ...args) => (await tx.execute({ sql, args })).rows[0],
    all: async (sql, ...args) => (await tx.execute({ sql, args })).rows,
    run: async (sql, ...args) => {
      await tx.execute({ sql, args });
    },
  };
  try {
    const out = await fn(api);
    await tx.commit();
    return out;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore rollback errors
    }
    throw err;
  }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS todos (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'none',
    folder_id TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_todos_folder ON todos(user_id, folder_id)`,
];

// Shared init promise: serverless invocations and concurrent requests
// all await the same schema setup instead of racing it.
let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = init().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

async function init() {
  if (dbKind !== "supabase") {
    const c = local();
    if (dbKind === "local file") {
      await c.execute("PRAGMA journal_mode = WAL;");
      await c.execute("PRAGMA foreign_keys = ON;");
    }
    for (const stmt of SCHEMA) await c.execute(stmt);
    await migrateUsersToUsername();
    return;
  }
  for (const stmt of SCHEMA) await run(stmt);
}

// Migrate pre-username DBs (users.email) to users.username. Local SQLite
// files only: hosted databases are created fresh with the new schema.
async function migrateUsersToUsername() {
  if (dbKind !== "local file") return;
  const cols = await all("PRAGMA table_info(users)");
  const names = new Set(cols.map((c) => c.name));
  if (names.has("username") || !names.has("email")) return;

  await withTransaction(async (t) => {
    await t.run(`CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`);
    const rows = await t.all("SELECT * FROM users");
    const used = new Set();
    for (const row of rows) {
      let base = String(row.email || "")
        .trim()
        .toLowerCase()
        .split("@")[0]
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 20);
      if (base.length < 3) base = "user_" + String(row.id || "").slice(0, 6);
      let candidate = base;
      let n = 1;
      while (used.has(candidate)) {
        const suffix = String(n++);
        candidate = (base + "_" + suffix).slice(0, 20);
      }
      used.add(candidate);
      await t.run(
        "INSERT INTO users_new (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
        row.id,
        candidate,
        row.password_hash,
        row.created_at,
      );
    }
    await t.run("DROP TABLE users;");
    await t.run("ALTER TABLE users_new RENAME TO users;");
  });
}

function rowToFolder(row) {
  return {
    id: row.id,
    name: row.name,
    // pg returns BIGINT as string; libsql returns numbers.
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToTodo(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    due: row.due || "",
    priority: row.priority || "none",
    folderId: row.folder_id || "",
    completed: Number(row.completed) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

module.exports = {
  get,
  all,
  run,
  withTransaction,
  ready,
  isRemote,
  dbKind,
  rowToFolder,
  rowToTodo,
};

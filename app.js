/* =========================================
       DATA
    ========================================= */

const STORAGE_KEY = "focus-todo-app";

const defaultData = {
  todos: [],
  folders: [
    { id: "personal", name: "Personal" },
    { id: "work", name: "Work" },
    { id: "projects", name: "Projects" },
    { id: "shopping", name: "Shopping" },
  ],
};

const FOLDER_COLORS = [
  "#b8b8b2",
  "#9db8ad",
  "#c0b191",
  "#b39aa5",
  "#93a7c4",
  "#a8a8c9",
  "#8fb0a5",
];
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_ALERT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>';
const ICON_FOLDER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const ICON_PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const ICON_CAL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/></svg>';
const ICON_FLAG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>';

let data = loadData();
let currentView = "inbox";
let searchQuery = "";

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (!saved) return structuredClone(defaultData);

    const merged = {
      ...structuredClone(defaultData),
      ...JSON.parse(saved),
    };

    if (!Array.isArray(merged.todos)) merged.todos = [];
    if (!Array.isArray(merged.folders)) merged.folders = [];

    return merged;
  } catch {
    return structuredClone(defaultData);
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    toast("Could not save — storage is full", "error");
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function folderColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FOLDER_COLORS[h % FOLDER_COLORS.length];
}

/* =========================================
       INITIALIZE
    ========================================= */

function init() {
  document.documentElement.dataset.theme = "dark";

  const pill = document.getElementById("datePill");
  if (pill) {
    pill.innerHTML =
      ICON_CAL +
      "<span>" +
      new Date().toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }) +
      "</span>";
  }

  renderFolders();
  updateCounts();
  render();

  document.getElementById("quickInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") quickAdd();
  });

  document.getElementById("searchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    render();
  });

  document.addEventListener("keydown", handleShortcuts);

  document.getElementById("todoModal").addEventListener("click", (e) => {
    if (e.target.id === "todoModal") closeTodoModal();
  });

  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    if (document.getElementById("todoModal").classList.contains("open")) {
      return;
    }

    data = loadData();
    renderFolders();
    updateCounts();
    render();
  });

  window.addEventListener("popstate", () => {
    if (document.getElementById("confirmModal").classList.contains("open")) {
      dismissConfirm(false, true);
      return;
    }

    if (document.getElementById("promptModal").classList.contains("open")) {
      dismissPrompt(null, true);
      return;
    }

    if (!anyModalOpen()) return;

    hideModals();
    modalEntryPushed = false;
    restoreModalFocus();
  });

  document
    .getElementById("todoModal")
    .addEventListener("keydown", trapModalTab);

  document.getElementById("todoModal").addEventListener("keydown", (e) => {
    if (
      e.key === "Enter" &&
      e.target.tagName !== "TEXTAREA" &&
      e.target.tagName !== "BUTTON"
    ) {
      e.preventDefault();
      saveTodo();
    }
  });

  document.getElementById("todoTitle").addEventListener("input", (e) => {
    e.target.classList.remove("input-error");
  });

  document.getElementById("helpModal").addEventListener("click", (e) => {
    if (e.target.id === "helpModal") closeHelp();
  });

  document
    .getElementById("helpModal")
    .addEventListener("keydown", trapModalTab);

  document.getElementById("confirmModal").addEventListener("click", (e) => {
    if (e.target.id === "confirmModal") dismissConfirm(false);
  });

  document
    .getElementById("confirmModal")
    .addEventListener("keydown", trapModalTab);

  document.getElementById("promptModal").addEventListener("click", (e) => {
    if (e.target.id === "promptModal") dismissPrompt(null);
  });

  document
    .getElementById("promptModal")
    .addEventListener("keydown", trapModalTab);

  document.getElementById("promptModal").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
      e.preventDefault();
      submitPrompt();
    }
  });

  document.getElementById("promptInput").addEventListener("input", (e) => {
    e.target.classList.remove("input-error");
  });
}

/* =========================================
       VIEWS
    ========================================= */

function syncActive() {
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === currentView);
  });
  document.querySelectorAll("[data-folder]").forEach((item) => {
    item.classList.toggle(
      "active",
      currentView === "folder:" + item.dataset.folder,
    );
  });
}

function changeView(view) {
  currentView = view;
  searchQuery = "";
  document.getElementById("searchInput").value = "";
  syncActive();
  renderFolders();
  render();
}

function getViewTodos() {
  let todos = [...data.todos];

  if (currentView === "today") {
    const today = todayString();

    todos = todos.filter((todo) => todo.due === today && !todo.completed);
  }

  if (currentView === "upcoming") {
    const today = todayString();

    todos = todos.filter(
      (todo) => todo.due && todo.due > today && !todo.completed,
    );
  }

  if (currentView === "completed") {
    todos = todos.filter((todo) => todo.completed);
  }

  if (currentView.startsWith("folder:")) {
    const folderId = currentView.replace("folder:", "");

    todos = todos.filter(
      (todo) => todo.folderId === folderId && !todo.completed,
    );
  }

  if (currentView === "inbox") {
    todos = todos.filter((todo) => !todo.completed);
  }

  if (searchQuery) {
    todos = todos.filter(
      (todo) =>
        todo.title.toLowerCase().includes(searchQuery) ||
        (todo.description || "").toLowerCase().includes(searchQuery),
    );
  }

  todos.sort((a, b) => {
    if (a.completed !== b.completed) {
      return Number(a.completed) - Number(b.completed);
    }

    if (a.due && b.due) {
      return a.due.localeCompare(b.due);
    }

    if (a.due) return -1;
    if (b.due) return 1;

    return b.createdAt - a.createdAt;
  });

  return todos;
}

function render() {
  const todos = getViewTodos();

  const titles = {
    inbox: ["Inbox", "Your active todos"],
    today: ["Today", "Everything due today"],
    upcoming: ["Upcoming", "Todos coming up"],
    completed: ["Completed", "Things you've finished"],
  };

  let title = titles[currentView]?.[0];
  let subtitle = titles[currentView]?.[1];

  if (currentView.startsWith("folder:")) {
    const id = currentView.replace("folder:", "");
    const folder = data.folders.find((f) => f.id === id);

    title = folder ? folder.name : "Folder";
    subtitle = "Todos in this folder";
  }

  if (searchQuery) {
    title = "Search";
    subtitle = `${todos.length} result${todos.length === 1 ? "" : "s"}`;
  }

  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSubtitle").textContent =
    subtitle || `${todos.length} todos`;

  const list = document.getElementById("todoList");

  if (!todos.length) {
    list.innerHTML = emptyState();
    return;
  }

  list.innerHTML = todos.map(todoHTML).join("");
}

/* =========================================
       TODO RENDERING
    ========================================= */

function todoHTML(todo) {
  const priority =
    todo.priority && todo.priority !== "none"
      ? `<span class="pill priority ${todo.priority}"><span class="pdot"></span>${capitalize(todo.priority)}</span>`
      : "";

  let due = "";
  if (todo.due) {
    const overdue = !todo.completed && todo.due < todayString();
    due = `<span class="pill due ${overdue ? "overdue" : ""}">${ICON_CAL}<span>${overdue ? "Overdue · " : ""}${formatDate(todo.due)}</span></span>`;
  }

  let folderTag = "";
  if (todo.folderId) {
    const f = data.folders.find((x) => x.id === todo.folderId);
    if (f) {
      folderTag = `<span class="pill folder-tag"><span class="fdot" style="background:${folderColor(f.id)}"></span><span>${escapeHTML(f.name)}</span></span>`;
    }
  }

  const description = todo.description
    ? `<div class="todo-description">
              ${escapeHTML(todo.description)}
             </div>`
    : "";

  return `
        <article class="todo ${todo.completed ? "completed" : ""}">
          <button
            class="checkbox"
            aria-label="${todo.completed ? "Mark incomplete" : "Complete todo"}"
            onclick="toggleTodo('${todo.id}')"
          >${ICON_CHECK}</button>

          <div class="todo-main">
            <input
              class="todo-title"
              value="${escapeAttr(todo.title)}"
              onchange="updateTitle('${todo.id}', this.value)"
              aria-label="Todo title"
            />
            ${description}
          </div>

          <div class="todo-meta">
            ${priority}
            ${folderTag}
            ${due}
            <div class="todo-actions">
              <button
                class="todo-action"
                onclick="editTodo('${todo.id}')"
                title="Edit"
                aria-label="Edit todo"
              >${ICON_PENCIL}</button>

              <button
                class="todo-action delete"
                onclick="deleteTodo('${todo.id}')"
                title="Delete"
                aria-label="Delete todo"
              >${ICON_TRASH}</button>
            </div>
          </div>
        </article>
      `;
}

function emptyState() {
  const messages = {
    inbox: ["All caught up", "No active todos. Press <kbd>N</kbd> to add one."],
    today: [
      "Nothing due today",
      "Clear schedule. Press <kbd>N</kbd> to plan something.",
    ],
    upcoming: ["No upcoming todos", "Add a due date to plan ahead."],
    completed: ["Nothing completed yet", "Finished todos will appear here."],
  };

  const msg = messages[currentView] || [
    "No todos here",
    "Press <kbd>N</kbd> to add your first todo.",
  ];

  return `
        <div class="empty">
          <div class="empty-art" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>
          </div>
          <div class="empty-title">${msg[0]}</div>
          <div class="empty-text">${msg[1]}</div>
          <button class="empty-cta" onclick="openTodoModal()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            New todo
          </button>
        </div>
      `;
}

/* =========================================
       TODO ACTIONS
    ========================================= */

function quickAdd() {
  const input = document.getElementById("quickInput");
  const title = input.value.trim();

  if (!title) return;

  data.todos.unshift({
    id: uid(),
    title,
    description: "",
    completed: false,
    due: "",
    priority: "none",
    folderId: getCurrentFolderId(),
    createdAt: Date.now(),
  });

  saveData();

  input.value = "";

  updateCounts();
  renderFolders();
  render();

  toast("Todo added");
}

function toggleTodo(id) {
  const todo = data.todos.find((t) => t.id === id);

  if (!todo) return;

  todo.completed = !todo.completed;

  saveData();
  updateCounts();
  renderFolders();
  render();

  toast(todo.completed ? "Todo completed" : "Todo reopened");
}

function updateTitle(id, value) {
  const todo = data.todos.find((t) => t.id === id);

  if (!todo) return;

  value = value.trim();

  if (!value) {
    deleteTodo(id);
    return;
  }

  todo.title = value;

  saveData();
  render();
}

function deleteTodo(id) {
  const todo = data.todos.find((t) => t.id === id);

  if (!todo) return;

  askConfirm({
    title: "Delete todo?",
    message: `"${todo.title}" will be permanently deleted.`,
    confirmText: "Delete",
  }).then((ok) => {
    if (!ok) return;
    if (!data.todos.some((t) => t.id === id)) return;

    data.todos = data.todos.filter((t) => t.id !== id);

    saveData();
    updateCounts();
    renderFolders();
    render();

    toast("Todo deleted");
  });
}

/* =========================================
       MODAL
    ========================================= */

function getCurrentFolderId() {
  if (!currentView.startsWith("folder:")) return "";
  const folderId = currentView.replace("folder:", "");
  return data.folders.some((f) => f.id === folderId) ? folderId : "";
}

function openTodoModal(id = null) {
  const todo = id ? data.todos.find((t) => t.id === id) : null;

  if (id && !todo) return;

  const helpWasOpen = document
    .getElementById("helpModal")
    .classList.contains("open");

  hideModals();
  cancelPendingOverlays();

  const modal = document.getElementById("todoModal");

  document.getElementById("editId").value = id || "";
  populateFolderSelect();

  if (todo) {
    document.getElementById("modalTitle").textContent = "Edit Todo";
    document.getElementById("todoTitle").value = todo.title;
    document.getElementById("todoDescription").value = todo.description || "";
    document.getElementById("todoDue").value = todo.due || "";
    document.getElementById("todoPriority").value = todo.priority || "none";
    document.getElementById("todoFolder").value = todo.folderId || "";
  } else {
    document.getElementById("modalTitle").textContent = "New Todo";
    document.getElementById("todoTitle").value = "";
    document.getElementById("todoDescription").value = "";
    document.getElementById("todoDue").value = "";
    document.getElementById("todoPriority").value = "none";
    document.getElementById("todoFolder").value = getCurrentFolderId();
  }

  pushModalEntry();
  modal.classList.add("open");

  if (!helpWasOpen) {
    lastFocused = document.activeElement;
  }

  setTimeout(() => {
    document.getElementById("todoTitle").focus();
  }, 50);
}

function closeTodoModal() {
  if (!document.getElementById("todoModal").classList.contains("open")) {
    return;
  }

  hideModals();
  restoreModalFocus();
  popModalEntry();
}

let lastFocused = null;
let modalEntryPushed = false;

function anyModalOpen() {
  return document.querySelector(".modal-backdrop.open") !== null;
}

function pushModalEntry() {
  if (modalEntryPushed) return;

  try {
    history.pushState({ modal: true }, "");
    modalEntryPushed = true;
  } catch {
    // History unavailable (e.g. restricted webview): modals still
    // work, system back just navigates normally.
  }
}

function hideModals() {
  document
    .querySelectorAll(".modal-backdrop.open")
    .forEach((m) => m.classList.remove("open"));
}

function restoreModalFocus() {
  if (lastFocused && document.contains(lastFocused)) {
    lastFocused.focus();
  }

  lastFocused = null;
}

function popModalEntry() {
  if (!modalEntryPushed) return;

  modalEntryPushed = false;
  history.back();
}

function trapModalTab(e) {
  if (e.key !== "Tab") return;

  const modal = e.currentTarget;

  if (!modal || !modal.classList.contains("open")) return;

  const items = [
    ...modal.querySelectorAll("input, textarea, select, button"),
  ].filter((el) => !el.disabled && el.type !== "hidden");

  if (!items.length) return;

  const first = items[0];
  const last = items[items.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function editTodo(id) {
  openTodoModal(id);
}

function openHelp() {
  if (document.getElementById("todoModal").classList.contains("open")) {
    return;
  }

  const modal = document.getElementById("helpModal");

  if (modal.classList.contains("open")) return;

  hideModals();
  cancelPendingOverlays();

  lastFocused = document.activeElement;
  pushModalEntry();
  modal.classList.add("open");
}

function closeHelp() {
  if (!document.getElementById("helpModal").classList.contains("open")) {
    return;
  }

  hideModals();
  restoreModalFocus();
  popModalEntry();
}

let confirmState = null;
let promptState = null;

function askConfirm({ title, message, confirmText = "Delete" }) {
  return new Promise((resolve) => {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    document.getElementById("confirmOk").textContent = confirmText;

    const ownsEntry = !anyModalOpen();
    confirmState = { resolve, ownsEntry };

    if (ownsEntry) {
      lastFocused = document.activeElement;
      pushModalEntry();
    }

    document.getElementById("confirmModal").classList.add("open");
    document.getElementById("confirmCancel").focus();
  });
}

function dismissConfirm(value, fromPop = false) {
  const modal = document.getElementById("confirmModal");

  if (!modal.classList.contains("open")) return;

  modal.classList.remove("open");

  const st = confirmState;
  confirmState = null;

  if (fromPop) {
    modalEntryPushed = false;
  } else if (st && st.ownsEntry) {
    modalEntryPushed = false;
    history.back();
  }

  restoreModalFocus();

  if (st) st.resolve(value);
}

function askPrompt({ title, message, placeholder = "", confirmText = "Save" }) {
  return new Promise((resolve) => {
    document.getElementById("promptTitle").textContent = title;
    document.getElementById("promptMessage").textContent = message;

    const input = document.getElementById("promptInput");
    input.value = "";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", title);
    input.classList.remove("input-error");

    document.getElementById("promptOk").textContent = confirmText;

    const ownsEntry = !anyModalOpen();
    promptState = { resolve, ownsEntry };

    if (ownsEntry) {
      lastFocused = document.activeElement;
      pushModalEntry();
    }

    document.getElementById("promptModal").classList.add("open");

    setTimeout(() => {
      document.getElementById("promptInput").focus();
    }, 50);
  });
}

function submitPrompt() {
  if (!promptState) return;

  const input = document.getElementById("promptInput");
  const value = input.value.trim();

  if (!value) {
    input.classList.add("input-error");
    input.focus();
    return;
  }

  dismissPrompt(value);
}

function dismissPrompt(value, fromPop = false) {
  const modal = document.getElementById("promptModal");

  if (!modal.classList.contains("open")) return;

  modal.classList.remove("open");

  const st = promptState;
  promptState = null;

  if (fromPop) {
    modalEntryPushed = false;
  } else if (st && st.ownsEntry) {
    modalEntryPushed = false;
    history.back();
  }

  restoreModalFocus();

  if (st) st.resolve(value);
}

function cancelPendingOverlays() {
  if (confirmState) {
    const st = confirmState;
    confirmState = null;
    st.resolve(false);
  }

  if (promptState) {
    const st = promptState;
    promptState = null;
    st.resolve(null);
  }
}

function saveTodo() {
  const id = document.getElementById("editId").value;
  const titleInput = document.getElementById("todoTitle");

  const title = titleInput.value.trim();

  if (!title) {
    titleInput.classList.add("input-error");
    titleInput.focus();
    toast("Enter a title to save", "error");
    return;
  }

  titleInput.classList.remove("input-error");

  const selectedFolderId = document.getElementById("todoFolder").value;

  const todoData = {
    title,
    description: document.getElementById("todoDescription").value.trim(),
    due: document.getElementById("todoDue").value,
    priority: document.getElementById("todoPriority").value,
    folderId: data.folders.some((f) => f.id === selectedFolderId)
      ? selectedFolderId
      : "",
  };

  if (id) {
    const todo = data.todos.find((t) => t.id === id);

    if (todo) {
      Object.assign(todo, todoData);
      toast("Todo updated");
    }
  } else {
    data.todos.unshift({
      id: uid(),
      ...todoData,
      completed: false,
      createdAt: Date.now(),
    });

    toast("Todo created");
  }

  saveData();
  updateCounts();
  renderFolders();
  render();
  closeTodoModal();
}

function populateFolderSelect() {
  const select = document.getElementById("todoFolder");

  select.innerHTML =
    `<option value="">No folder</option>` +
    data.folders
      .map(
        (folder) =>
          `<option value="${escapeAttr(folder.id)}">
              ${escapeHTML(folder.name)}
            </option>`,
      )
      .join("");
}

/* =========================================
       FOLDERS
    ========================================= */

function renderFolders() {
  const container = document.getElementById("folderList");

  container.innerHTML = data.folders
    .map((folder) => {
      const count = data.todos.filter(
        (t) => t.folderId === folder.id && !t.completed,
      ).length;

      return `
        <button
            class="nav-item ${currentView === "folder:" + folder.id ? "active" : ""}"
            data-folder="${escapeAttr(folder.id)}"
            onclick="changeFolder('${folder.id}')"
          >
            <span class="nav-icon">${ICON_FOLDER}</span>
            <span class="folder-dot" style="background:${folderColor(folder.id)}"></span>
            <span class="folder-name">${escapeHTML(folder.name)}</span>
            <span class="nav-count"${count ? "" : " hidden"}>
              ${count || ""}
            </span>
            <span
              class="folder-delete"
              role="button"
              tabindex="0"
              title="Delete folder"
              aria-label="Delete ${escapeAttr(folder.name)}"
              onclick="event.stopPropagation();deleteFolder('${folder.id}')"
              onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();deleteFolder('${folder.id}')}"
            >${ICON_TRASH}</span>
          </button>
      `;
    })
    .join("");

  const hint = document.getElementById("folderHint");
  if (hint)
    hint.textContent = data.folders.length ? data.folders.length + "" : "";

  const mobile = document.getElementById("mobileFolderList");
  if (mobile) {
    mobile.innerHTML = data.folders
      .map(
        (f) =>
          `<button class="m-chip ${currentView === "folder:" + f.id ? "active" : ""}" data-folder="${escapeAttr(f.id)}" onclick="changeFolder('${f.id}')">` +
          `<span class="folder-dot" style="background:${folderColor(f.id)}"></span>${escapeHTML(f.name)}</button>`,
      )
      .join("");
  }

  syncActive();
}

function changeFolder(id) {
  currentView = "folder:" + id;
  searchQuery = "";
  const s = document.getElementById("searchInput");
  if (s) s.value = "";
  renderFolders();
  render();
}

function addFolder() {
  askPrompt({
    title: "New folder",
    message: "Give your folder a name.",
    placeholder: "e.g. Reading list",
    confirmText: "Create folder",
  }).then((cleanName) => {
    if (cleanName === null) return;

    if (
      data.folders.some((f) => f.name.toLowerCase() === cleanName.toLowerCase())
    ) {
      toast("That folder already exists", "error");
      return;
    }

    data.folders.push({
      id: uid(),
      name: cleanName,
    });

    saveData();
    renderFolders();
    populateFolderSelect();

    toast("Folder created");
  });
}

function deleteFolder(id) {
  const folder = data.folders.find((f) => f.id === id);

  if (!folder) return;

  askConfirm({
    title: "Delete folder?",
    message: `"${folder.name}" will be removed. Its todos will stay in your inbox.`,
    confirmText: "Delete",
  }).then((ok) => {
    if (!ok) return;
    if (!data.folders.some((f) => f.id === id)) return;

    data.todos.forEach((todo) => {
      if (todo.folderId === id) {
        todo.folderId = "";
      }
    });

    data.folders = data.folders.filter((f) => f.id !== id);

    if (currentView === "folder:" + id) {
      currentView = "inbox";
    }

    saveData();

    renderFolders();
    syncFolderSelect();
    updateCounts();
    render();

    toast("Folder deleted");
  });
}

function syncFolderSelect() {
  const modal = document.getElementById("todoModal");
  const select = document.getElementById("todoFolder");

  if (!modal.classList.contains("open") || !select) return;

  const keep = select.value;
  populateFolderSelect();
  select.value = data.folders.some((f) => f.id === keep) ? keep : "";
}

/* =========================================
       COUNTS
    ========================================= */

function updateCounts() {
  const today = todayString();

  let activeCount = 0;
  let completedCount = 0;
  let todayCount = 0;

  for (const t of data.todos) {
    if (t.completed) {
      completedCount++;
    } else {
      activeCount++;
      if (t.due === today) todayCount++;
    }
  }

  setCount("inboxCount", activeCount);
  setCount("completedCount", completedCount);
  setCount("todayCount", todayCount);

  const total = data.todos.length;
  const pct = total ? Math.round((completedCount / total) * 100) : 0;
  const bar = document.getElementById("progressBar");
  const txt = document.getElementById("progressText");
  if (bar) bar.style.width = pct + "%";
  if (txt) txt.textContent = completedCount + " / " + total;
}

function setCount(id, count) {
  const el = document.getElementById(id);

  if (!el) return;

  el.textContent = count || "";
  el.hidden = !count;
}

/* =========================================
       KEYBOARD SHORTCUTS
    ========================================= */

function handleShortcuts(e) {
  const active = document.activeElement;
  const typing =
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT");

  const overlayOpen =
    document.getElementById("confirmModal").classList.contains("open") ||
    document.getElementById("promptModal").classList.contains("open");

  if (overlayOpen && e.key !== "Escape") return;

  if (e.key === "/" && !typing) {
    e.preventDefault();
    focusSearch();
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    focusSearch();
  }

  if (e.key.toLowerCase() === "n" && !typing) {
    e.preventDefault();
    openTodoModal();
  }

  if (e.key === "?" && !typing) {
    e.preventDefault();
    openHelp();
  }

  if (e.key === "Escape") {
    const confirmOpen = document
      .getElementById("confirmModal")
      .classList.contains("open");
    const promptOpen = document
      .getElementById("promptModal")
      .classList.contains("open");
    const helpOpen = document
      .getElementById("helpModal")
      .classList.contains("open");
    const todoOpen = document
      .getElementById("todoModal")
      .classList.contains("open");

    if (confirmOpen) {
      dismissConfirm(false);
    } else if (promptOpen) {
      dismissPrompt(null);
    } else if (helpOpen) {
      closeHelp();
    } else if (todoOpen) {
      closeTodoModal();
    } else if (
      document.activeElement === document.getElementById("searchInput")
    ) {
      document.activeElement.blur();
    }
  }
}

function focusSearch() {
  const search = document.getElementById("searchInput");

  if (!search) return;

  search.focus();
  search.select();
}

/* =========================================
       HELPERS
    ========================================= */

function todayString() {
  const now = new Date();

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function formatDate(dateString) {
  const date = new Date(dateString + "T00:00:00");

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHTML(value);
}

let toastTimer;

function toast(message, type = "success") {
  const element = document.getElementById("toast");
  const text = document.getElementById("toastText");
  const icon = document.getElementById("toastIcon");

  if (text) text.textContent = message;
  else element.textContent = message;
  element.classList.remove("success", "error");
  element.classList.add(type === "error" ? "error" : "success");
  if (icon) icon.innerHTML = type === "error" ? ICON_ALERT : ICON_CHECK;
  element.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    element.classList.remove("show");
  }, 1800);
}

/* =========================================
       START
    ========================================= */

init();

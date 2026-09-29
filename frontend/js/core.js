// Core: safe templates, MAX Bridge, API client, UI helpers, router

// ---------- Templates (every interpolated value is escaped unless wrapped in raw()) ----------

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function raw(markup) {
  return { __raw: String(markup) };
}

function renderValue(value) {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (typeof value === "object" && "__raw" in value) return value.__raw;
  return esc(value);
}

function html(strings, ...values) {
  let out = "";
  strings.forEach((part, i) => {
    out += part;
    if (i < values.length) out += renderValue(values[i]);
  });
  return raw(out);
}

function mount(target, template) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  el.innerHTML = renderValue(template);
  return el;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// ---------- MAX Bridge (all calls are safe outside MAX) ----------

const Bridge = {
  get app() {
    return window.WebApp || null;
  },
  // Launched from the bot inside MAX with signed initData
  get inMax() {
    return Boolean(this.app && this.app.initData);
  },
  get platform() {
    return (this.app && this.app.platform) || "";
  },
  get isMobile() {
    if (this.platform) return this.platform === "ios" || this.platform === "android";
    return window.matchMedia("(pointer: coarse)").matches;
  },
  get startParam() {
    const unsafe = this.app && this.app.initDataUnsafe;
    return (unsafe && unsafe.start_param) || "";
  },
  get userName() {
    const user = this.app && this.app.initDataUnsafe && this.app.initDataUnsafe.user;
    if (!user) return "";
    return [user.first_name, user.last_name].filter(Boolean).join(" ");
  },
  call(fn) {
    if (!this.inMax) return null;
    try {
      const result = fn(this.app);
      if (result && typeof result.catch === "function") result.catch(() => {});
      return result;
    } catch (e) {
      console.warn("MAX Bridge call failed:", e);
      return null;
    }
  },
  ready() {
    this.call((app) => app.ready());
  },
  // Back to the bot chat: close the mini-app in MAX, or leave the page opened by a bot link
  close() {
    if (this.inMax) {
      this.call((app) => app.close());
      return;
    }
    const username = (typeof App !== "undefined" && App.me && App.me.bot_username) || "";
    window.close();
    if (username) setTimeout(() => this.openBot(username), 150);
  },
  haptic(kind) {
    if (!this.isMobile) return;
    this.call((app) =>
      kind === "success" || kind === "error" || kind === "warning"
        ? app.HapticFeedback.notificationOccurred(kind)
        : app.HapticFeedback.impactOccurred(kind || "light")
    );
  },
  confirmClosing(enabled) {
    this.call((app) => (enabled ? app.enableClosingConfirmation() : app.disableClosingConfirmation()));
  },
  _backHandler: null,
  backButton(visible, handler) {
    if (!this.inMax) return;
    this.call((app) => {
      if (this._backHandler) app.BackButton.offClick(this._backHandler);
      this._backHandler = null;
      if (visible) {
        this._backHandler = handler;
        app.BackButton.onClick(handler);
        app.BackButton.show();
      } else {
        app.BackButton.hide();
      }
    });
  },
  // Must be called from a click handler (MAX requires a user gesture)
  async download(url, fileName) {
    const absolute = new URL(url, window.location.origin).href;
    if (this.inMax && absolute.startsWith("https://")) {
      try {
        await this.app.downloadFile(absolute, fileName);
        return;
      } catch (e) {
        console.warn("downloadFile failed, opening link:", e);
      }
    }
    window.open(absolute, "_blank");
  },
  async scanQR() {
    if (!this.inMax) throw new Error("Сканер QR работает в приложении MAX");
    const result = await this.app.openCodeReader(false);
    return typeof result === "string" ? result : JSON.stringify(result || {});
  },
  async shareToMax(text, link) {
    if (this.inMax && this.app.shareMaxContent) {
      await this.app.shareMaxContent({ text, link });
      return true;
    }
    return false;
  },
  openBot(username) {
    const link = `https://max.ru/${username}`;
    if (this.inMax) this.call((app) => app.openMaxLink(link));
    else window.location.href = link;
  },
};

// ---------- API client ----------

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const Auth = {
  token: "",
  startParam: "",
  // initData inside MAX; otherwise a signed token from the bot link (?t=...&p=...)
  init() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t");
    if (token) {
      sessionStorage.setItem("auth_token", token);
      sessionStorage.setItem("start_param", params.get("p") || "");
      // Keep the token out of the address bar and history
      window.history.replaceState(null, "", window.location.pathname);
    }
    this.token = sessionStorage.getItem("auth_token") || "";
    this.startParam = Bridge.startParam || sessionStorage.getItem("start_param") || "";
  },
  headers() {
    if (Bridge.inMax) return { "X-Max-Init-Data": Bridge.app.initData };
    if (this.token) return { "X-Auth-Token": this.token, "X-Start-Param": this.startParam };
    return {};
  },
};

async function api(method, path, body) {
  const options = { method, headers: { ...Auth.headers() } };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, options);
  } catch (e) {
    throw new ApiError("Нет связи с сервером. Проверьте интернет", 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    let message = "Что-то пошло не так. Попробуйте ещё раз";
    if (data && typeof data.detail === "string") message = data.detail;
    else if (res.status === 422) message = "Проверьте заполненные поля";
    throw new ApiError(message, res.status);
  }
  return data;
}

async function uploadPhoto(file) {
  const form = new FormData();
  form.append("file", file);
  const data = await api("POST", "/api/upload", form);
  return data.url;
}

// ---------- UI helpers ----------

function clearToasts() {
  document.querySelectorAll("#toasts .toast").forEach((t) => t.remove());
}

// One toast at a time: a new one replaces the previous
function toast(message, { type = "info", action = null, duration = 3200 } = {}) {
  const root = document.getElementById("toasts");
  clearToasts();
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  mount(el, html`<span>${message}</span>${action ? html`<button type="button" class="toast-action">${action.label}</button>` : ""}`);
  if (action) {
    el.querySelector(".toast-action").addEventListener("click", () => {
      el.remove();
      action.fn();
    });
  }
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, action ? duration + 2500 : duration);
}

function toastError(error, retry) {
  const message = error instanceof ApiError ? error.message : "Что-то пошло не так. Попробуйте ещё раз";
  if (!(error instanceof ApiError)) console.error(error);
  Bridge.haptic("error");
  toast(message, { type: "error", action: retry ? { label: "Повторить", fn: retry } : null });
}

// Run an async action with the button disabled and a spinner; errors become toasts with retry
async function busy(button, fn) {
  if (button && button.disabled) return undefined;
  if (button) {
    button.disabled = true;
    button.classList.add("is-busy");
  }
  try {
    return await fn();
  } catch (e) {
    toastError(e, () => busy(button, fn));
    return undefined;
  } finally {
    // Restore even if the screen changed meanwhile: the same element may be reused by a follow-up action
    if (button) {
      button.disabled = false;
      button.classList.remove("is-busy");
    }
  }
}

// Bottom sheet; resolves with the chosen action value (or null when dismissed)
function sheet(content, actions = []) {
  clearToasts();
  return new Promise((resolve) => {
    const root = document.getElementById("sheet-root");
    const overlay = document.createElement("div");
    overlay.className = "sheet-overlay";
    mount(
      overlay,
      html`<div class="sheet" role="dialog">
        <div class="sheet-handle"></div>
        <div class="sheet-body">${content}</div>
        <div class="sheet-actions">
          ${actions.map(
            (a, i) => html`<button type="button" class="btn ${a.kind ? "btn-" + a.kind : "btn-secondary"}" data-sheet="${i}">${a.label}</button>`
          )}
        </div>
      </div>`
    );
    const close = (value) => {
      overlay.classList.remove("show");
      overlay.classList.add("closing");
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener("sheet:close", onForceClose);
      resolve(value);
    };
    const onForceClose = () => close(null);
    document.addEventListener("sheet:close", onForceClose);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
      const btn = e.target.closest("[data-sheet]");
      if (btn) {
        const action = actions[Number(btn.dataset.sheet)];
        const value = action.value !== undefined ? action.value : true;
        if (action.validate && !action.validate(overlay)) return;
        close(action.read ? action.read(overlay) : value);
      }
    });
    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
  });
}

function confirmSheet(title, text, okLabel, kind = "primary") {
  return sheet(html`<h3>${title}</h3>${text ? html`<p class="muted">${text}</p>` : ""}`, [
    { label: okLabel, kind, value: true },
    { label: "Отмена", value: false },
  ]);
}

// Two groups of photos ("было / стало", "как сейчас / как должно быть"); tap shows the whole group
function photoPair(first, firstCaption, second, secondCaption) {
  const groups = [
    [first, firstCaption],
    [second, secondCaption],
  ]
    .map(([urls, caption]) => [(Array.isArray(urls) ? urls : [urls]).filter(Boolean), caption])
    .filter(([urls]) => urls.length);
  return html`<div class="photo-pair">
    ${groups.map(
      ([urls, caption]) => html`<button type="button" class="photo-thumb" data-act="photo" data-srcs="${JSON.stringify(urls)}" data-caption="${caption}">
        <img src="${urls[0]}" alt="" loading="lazy"><span>${caption}</span>
        ${urls.length > 1 ? html`<em class="photo-count">+${urls.length - 1}</em>` : ""}
      </button>`
    )}
  </div>`;
}

// Photo viewer: every photo of a group, one under another
function showPhotos(urls, caption) {
  sheet(
    html`<p class="muted">${caption}${urls.length > 1 ? ` · ${urls.length} фото` : ""}</p>
      ${urls.map((u) => html`<img class="photo-full" src="${u}" alt="">`)}`,
    [{ label: "Закрыть", value: null }]
  );
}

// "camera" opens the camera on phones (one shot); "gallery" and desktop allow several files at once.
// Must run inside a click handler.
function pickFiles(source = "camera") {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (source === "camera" && Bridge.isMobile) input.setAttribute("capture", "environment");
    else input.multiple = true;
    input.style.display = "none";
    const done = (files) => {
      resolve(files);
      input.remove();
    };
    input.addEventListener("change", () => done(Array.from(input.files || [])));
    input.addEventListener("cancel", () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

const MAX_PHOTOS = 10;
// What the server accepts; files with an unknown type are left for the server to check
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Drop files that are not photos right when they are picked, and say which ones
function acceptedPhotos(files) {
  const bad = files.filter((file) => file.type && !PHOTO_TYPES.includes(file.type));
  if (bad.length) {
    const names = bad.map((file) => `«${file.name}»`).join(", ");
    toast(`${names}: это не фото. Подойдёт JPG, PNG или WEBP`, { type: "error", duration: 5000 });
  }
  return files.filter((file) => !bad.includes(file));
}

// Photos for one answer: the camera first, then a sheet to shoot more, add from the gallery or remove.
// Resolves with uploaded URLs, or null when cancelled. Must start inside a click handler.
async function collectPhotos({ title, note = "", confirm = "Готово" }) {
  const picked = await pickFiles("camera");
  if (!picked.length) return null;
  clearToasts();
  const first = acceptedPhotos(picked);
  if (!first.length) return null;
  return new Promise((resolve) => {
    const shots = [];
    const overlay = document.createElement("div");
    overlay.className = "sheet-overlay";

    const add = (files) => {
      files.slice(0, MAX_PHOTOS - shots.length).forEach((file) => shots.push({ file, preview: URL.createObjectURL(file) }));
      render();
    };
    const finish = (value) => {
      document.removeEventListener("sheet:close", onForceClose);
      overlay.classList.remove("show");
      overlay.classList.add("closing");
      setTimeout(() => overlay.remove(), 200);
      shots.forEach((shot) => URL.revokeObjectURL(shot.preview));
      resolve(value);
    };
    const onForceClose = () => finish(null);

    const render = () => {
      const more = shots.length < MAX_PHOTOS;
      mount(
        overlay,
        html`<div class="sheet" role="dialog">
          <div class="sheet-handle"></div>
          <div class="sheet-body">
            <h3>${title}</h3>
            ${note ? html`<p class="muted small">${note}</p>` : ""}
            <div class="shots">
              ${shots.map(
                (shot, i) => html`<div class="shot">
                  <img src="${shot.preview}" alt="">
                  <button type="button" class="shot-remove" data-cp="remove" data-index="${i}" aria-label="Убрать фото">✕</button>
                </div>`
              )}
            </div>
            ${more
              ? html`<div class="${Bridge.isMobile ? "row-buttons" : "stack"}">
                  <button type="button" class="btn btn-secondary" data-cp="camera">${Bridge.isMobile ? html`<i class="ico" data-i="camera" aria-hidden="true"></i> Ещё фото` : html`<i class="ico" data-i="paperclip" aria-hidden="true"></i> Добавить фото`}</button>
                  ${Bridge.isMobile ? html`<button type="button" class="btn btn-secondary" data-cp="gallery"><i class="ico" data-i="image" aria-hidden="true"></i> Из галереи</button>` : ""}
                </div>`
              : html`<p class="muted small">Можно прикрепить до ${MAX_PHOTOS} фото.</p>`}
          </div>
          <div class="sheet-actions">
            <button type="button" class="btn btn-primary" data-cp="done" ${raw(shots.length ? "" : "disabled")}>${confirm} · ${shots.length} фото</button>
            <button type="button" class="btn btn-secondary" data-cp="cancel">Отмена</button>
          </div>
        </div>`
      );
    };

    overlay.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-cp]");
      if (!btn) return;
      const act = btn.dataset.cp;
      if (act === "remove") {
        const [shot] = shots.splice(Number(btn.dataset.index), 1);
        URL.revokeObjectURL(shot.preview);
        render();
      } else if (act === "camera" || act === "gallery") {
        add(acceptedPhotos(await pickFiles(act)));
      } else if (act === "cancel") {
        finish(null);
      } else if (act === "done") {
        const urls = await busy(btn, () => Promise.all(shots.map((shot) => uploadPhoto(shot.file))));
        if (urls) finish(urls);
      }
    });

    document.addEventListener("sheet:close", onForceClose);
    add(first);
    document.getElementById("sheet-root").appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
  });
}

// "исправление" → "Сфотографировать исправление" on phones, "Прикрепить фото исправления" on desktop
const PHOTO_OF = { исправление: "исправления", результат: "результата", выполнение: "выполнения" };

function photoLabel(action) {
  return Bridge.isMobile
    ? html`<i class="ico" data-i="camera" aria-hidden="true"></i> Сфотографировать ${action}`
    : html`<i class="ico" data-i="paperclip" aria-hidden="true"></i> Прикрепить фото ${PHOTO_OF[action] || action}`;
}

// ---------- Router ----------

const Screens = {};
const Actions = {};

const Router = {
  stack: [],
  get current() {
    return this.stack[this.stack.length - 1] || null;
  },
  // base: open the screen on top of a fresh stack with that screen underneath (e.g. the cabinet)
  async go(name, params = {}, { replace = false, reset = false, base = null } = {}) {
    const prev = this.current;
    if (prev && Screens[prev.name].leave) Screens[prev.name].leave();
    if (base) this.stack = [{ name: base, params: {} }];
    else if (reset) this.stack = [];
    else if (replace) this.stack.pop();
    this.stack.push({ name, params });
    await this.render();
  },
  async back() {
    if (this.stack.length < 2) return;
    const prev = this.stack.pop();
    if (Screens[prev.name].leave) Screens[prev.name].leave();
    await this.render();
  },
  // Re-render in place: the current content stays until fresh data arrives (no skeleton flash)
  refreshing: false,
  async refresh() {
    this.refreshing = true;
    try {
      await this.render({ keepScroll: true });
    } finally {
      this.refreshing = false;
    }
  },
  async render({ keepScroll = false } = {}) {
    const entry = this.current;
    const canGoBack = this.stack.length > 1;
    Bridge.backButton(canGoBack, () => this.back());
    document.body.classList.toggle("has-back", canGoBack && !(Bridge.inMax && Bridge.isMobile));
    document.dispatchEvent(new Event("sheet:close"));
    const scroll = window.scrollY;
    try {
      await Screens[entry.name].render(entry.params);
    } catch (e) {
      if (this.refreshing) {
        toastError(e, () => this.refresh());
        return;
      }
      if (!(e instanceof ApiError)) console.error(e);
      mount("#app", screen("", errorState(e, () => this.render()), { back: canGoBack }));
    }
    window.scrollTo(0, keepScroll ? scroll : 0);
  },
};

// ---------- Designs: alternative looks to show the team; without one the app looks as usual ----------

// <html data-design> comes from ?design= or this device's last choice (index.html).
// A design registers its own view functions, actions and screens; use() swaps them in
// and puts the originals back when another design is chosen, so switching needs no reload.
const Design = {
  name: "",
  all: {},
  saved: [],
  register(name, title, parts) {
    this.all[name] = { title, parts };
  },
  use(name) {
    this.saved.forEach(([target, key, value]) => {
      target[key] = value;
    });
    this.saved = [];
    const design = this.all[name];
    this.name = design ? name : "";
    if (design) {
      const { globals = {}, actions = {}, screens = {} } = design.parts;
      [
        [window, globals],
        [Actions, actions],
        [Screens, screens],
      ].forEach(([target, parts]) => {
        Object.entries(parts).forEach(([key, value]) => {
          this.saved.push([target, key, target[key]]);
          target[key] = value;
        });
      });
      document.documentElement.dataset.design = name;
    } else {
      delete document.documentElement.dataset.design;
    }
  },
  choose(name) {
    try {
      localStorage.setItem("design", name);
    } catch (e) {
      // Private mode: the choice lasts until the app is closed
    }
    this.use(name);
    Router.render({ keepScroll: true });
  },
};

// Delegated clicks: <button data-act="name" data-id="...">
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const fn = Actions[el.dataset.act];
  if (fn) {
    e.preventDefault();
    fn(el, e);
  }
});

Actions.back = () => Router.back();
Actions.photo = (el) => showPhotos(el.dataset.srcs ? JSON.parse(el.dataset.srcs) : [el.dataset.src], el.dataset.caption);
Actions.toggle = (el) => {
  const target = document.getElementById(el.dataset.target);
  if (target) {
    target.hidden = !target.hidden;
    el.classList.toggle("open", !target.hidden);
  }
};

Actions.closeApp = () => Bridge.close();

function chatButton() {
  return html`<button type="button" class="btn btn-secondary chat-btn" data-act="closeApp"><i class="ico" data-i="chat" aria-hidden="true"></i> Вернуться в чат с ботом</button>`;
}

// Owner's switch between the cabinet and their own shift (the "I work shifts too" role)
function roleTabs(active) {
  const me = typeof App !== "undefined" && App.me;
  if (!me || !me.owner || !me.owner.setup_done) return "";
  return html`<nav class="role-tabs" aria-label="Роль">
    <button type="button" class="${active === "home" ? "active" : ""}" data-act="roleHome"><i class="ico" data-i="store" aria-hidden="true"></i> Кабинет</button>
    <button type="button" class="${active === "shift" ? "active" : ""}" data-act="roleShift"><i class="ico" data-i="user" aria-hidden="true"></i> Моя смена</button>
  </nav>`;
}

Actions.roleHome = (el) => {
  if (!el.classList.contains("active")) Router.go("home", {}, { reset: true });
};

// Without the employee role yet: pick a position and turn it on in one step
Actions.roleShift = async (el) => {
  if (el.classList.contains("active")) return;
  if (App.me.employee) {
    await Router.go("shift", {}, { reset: true });
    return;
  }
  const state = App.ownerState || (await busy(el, () => api("GET", "/api/owner/state")));
  if (!state) return;
  const name = state.owner_name || Bridge.userName || App.me.user.name || "";
  const choice = await sheet(
    html`<h3>Работаю на смене</h3>
      <p class="muted">Вы будете отмечать смены и видеть все задачи смены и все нарушения по ним — можно взять любое, кто бы за него ни отвечал.</p>
      <label class="field"><span>Как вас подписывать</span><input id="roleName" type="text" maxlength="120" value="${name}" placeholder="Имя и фамилия"></label>`,
    [
      { label: "Включить", kind: "primary", read: (root) => ({ name: root.querySelector("#roleName").value.trim() }) },
      { label: "Отмена", value: null },
    ]
  );
  if (!choice) return;
  await setShiftRole(el, true, choice.name);
};

async function setShiftRole(el, works, name) {
  await busy(el, async () => {
    App.ownerState = await api("PUT", "/api/owner/shift-role", { works, name: name || null });
    App.me = await api("GET", "/api/me");
    toast(works ? "Вы на смене ✓ Видны все задачи" : "Роль сотрудника выключена", { type: "success" });
    await Router.go(works ? "shift" : "home", {}, { reset: true });
  });
}

// Screen skeleton while data loads
function skeleton(lines = 3) {
  return html`<div class="skeleton-screen">
    <div class="skeleton skeleton-title"></div>
    ${Array.from({ length: lines }, () => html`<div class="skeleton skeleton-card"></div>`)}
  </div>`;
}

function screen(title, body, { back = true, action = null } = {}) {
  return html`<header class="topbar">
      ${back ? html`<button type="button" class="topbar-back" data-act="back" aria-label="Назад">‹</button>` : ""}
      <h1>${title}</h1>
      ${action || ""}
    </header>
    <main class="screen">${body}</main>`;
}

// Error state with a retry button instead of a dead end
function errorState(error, retry) {
  Actions.retryScreen = retry;
  return html`<div class="empty">
    <div class="empty-icon"><i class="ico" data-i="warning" aria-hidden="true"></i></div>
    <p>${error instanceof ApiError ? error.message : "Не удалось загрузить данные"}</p>
    <button type="button" class="btn btn-primary" data-act="retryScreen">Повторить</button>
  </div>`;
}

// Load screen data with a skeleton and a retryable error state; title may depend on the data
async function loadScreen(title, loader, render, opts = {}) {
  const titleOf = (data) => (typeof title === "function" ? title(data) : title);
  if (!Router.refreshing) mount("#app", screen(typeof title === "function" ? "" : title, skeleton(), { ...opts, action: null }));
  try {
    const data = await loader();
    mount("#app", screen(titleOf(data), render(data), opts));
    return data;
  } catch (e) {
    mount("#app", screen(typeof title === "function" ? "" : title, errorState(e, () => Router.refresh()), opts));
    return null;
  }
}

// ---------- Checklist (shared JSON with the backend) ----------

const Checklist = {
  items: [],
  byId: {},
  async load() {
    if (this.items.length) return;
    const res = await fetch("checklists.json");
    this.items = await res.json();
    this.items.forEach((item) => {
      this.byId[item.id] = item;
    });
  },
};

// Audit route through the premises
const SECTION_ORDER = [
  "Документы и производственный контроль",
  "Приёмка и хранение продукции",
  "Холодильники и сроки годности",
  "Кухня и технологический процесс",
  "Мытьё посуды и инвентаря",
  "Раздача, зал и доставка",
  "Персонал и личная гигиена",
  "Уборка и дезинфицирующие средства",
  "Помещения и инженерные системы",
  "Отходы, насекомые и грызуны",
];

// Short names of the route sections, where a whole name does not fit
const SECTION_SHORT = {
  "Документы и производственный контроль": "Документы",
  "Приёмка и хранение продукции": "Приёмка",
  "Холодильники и сроки годности": "Холодильники",
  "Кухня и технологический процесс": "Кухня",
  "Мытьё посуды и инвентаря": "Мойка",
  "Раздача, зал и доставка": "Раздача и зал",
  "Персонал и личная гигиена": "Персонал",
  "Уборка и дезинфицирующие средства": "Уборка",
  "Помещения и инженерные системы": "Помещения",
  "Отходы, насекомые и грызуны": "Отходы",
};

// Zones of shift duties in the same order as the route
const ZONE_ORDER = ["Документы", "Склад", "Холодильники", "Кухня", "Мойка", "Зал", "Персонал", "Помещения", "Отходы"];

// Friendly labels for conditional checklist items ("applies_to")
const FEATURE_LABELS = {
  "Используется фритюр": "Фритюр",
  "Продажа на вынос или доставка": "Еда на вынос или доставка",
  "Есть кофемашина, автомат напитков или вендинг": "Кофемашина или автомат напитков",
  "Готовятся холодные блюда, салаты, десерты или проводится порционирование": "Холодные блюда, салаты, десерты",
  "Нет посудомоечной машины": "Моем посуду вручную (нет посудомоечной машины)",
  "Используются пищевые добавки": "Пищевые добавки по рецептурам",
  "Заведение без цехового деления, работающее на полуфабрикатах": "Работаем на полуфабрикатах без цехового деления",
  "Обработка сырья и изготовление полуфабрикатов в одном цехе": "Сырьё и полуфабрикаты — в одном цехе",
};

// Legal basis block, collapsed; fines live only here
function basisBlock(item, id) {
  if (!item) return "";
  const fines = item.fines || {};
  return html`<button type="button" class="link-toggle" data-act="toggle" data-target="${id}">Основание</button>
    <div class="basis" id="${id}" hidden>
      ${item.basis ? html`<p>${item.basis}</p>` : ""}
      ${item.checklist_ref ? html`<p>${item.checklist_ref}</p>` : ""}
      ${item.article
        ? html`<p class="muted">Ответственность: ${item.article}${fines.legal_entity ? html`; юрлицо — ${fines.legal_entity}, ИП — ${fines.ip}` : ""}</p>`
        : ""}
    </div>`;
}

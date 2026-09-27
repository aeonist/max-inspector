// Entry point: who is the user, and which screen to open

const App = { me: null, ownerState: null, invite: null };

// First screen for someone without a role yet
Screens.landing = {
  async render() {
    mount(
      "#app",
      html`<main class="screen landing">
        <div class="logo">✓</div>
        <h1>МАХ-Инспектор</h1>
        <p class="lead">Порядок к проверке Роспотребнадзора: аудит по официальному проверочному листу и задачи смене с фото.</p>
        <div class="stack">
          <button type="button" class="next-step" data-act="becomeOwner">
            <span class="next-num">🏪</span>
            <span><strong>Я владелец или управляющий</strong><span class="muted">Настроить заведение и пройти аудит</span></span>
          </button>
          <button type="button" class="next-step" data-act="becomeStaff">
            <span class="next-num">👩‍🍳</span>
            <span><strong>Я сотрудник</strong><span class="muted">Подключиться к команде по QR-коду</span></span>
          </button>
        </div>
        <button type="button" class="btn-link" data-act="tryDemo">Посмотреть на демо-кафе</button>
        <p class="muted small">Демо — заполненное заведение с тестовыми данными: можно сразу пройти цикл «нарушение → исправление → принято». Удалить его можно в настройках.</p>
      </main>`
    );
  },
};

Actions.tryDemo = (el) =>
  busy(el, async () => {
    await api("POST", "/api/facility/demo");
    App.me = await api("GET", "/api/me");
    toast("Демо-кафе готово: загляните в «Ждут вашей проверки»", { type: "success", duration: 5000 });
    await Router.go("home", {}, { reset: true });
  });

Actions.becomeOwner = (el) =>
  busy(el, async () => {
    await api("POST", "/api/facility");
    App.me = await api("GET", "/api/me");
    Setup.draft = null;
    await Router.go("setup", { step: 1 }, { reset: true });
  });

Actions.becomeStaff = () => Router.go("scan");

// Opened outside the bot (no initData, no signed link)
async function renderOpenFromBot() {
  let username = "";
  try {
    username = (await (await fetch("/api/bot")).json()).username || "";
  } catch (e) {
    username = "";
  }
  Actions.openBot = () => Bridge.openBot(username);
  mount(
    "#app",
    html`<main class="screen landing">
      <div class="logo">✓</div>
      <h1>МАХ-Инспектор</h1>
      <p class="lead">Откройте приложение из чата с ботом в MAX — так мы узнаем, что это вы.</p>
      ${username ? html`<button type="button" class="btn btn-primary" data-act="openBot">Открыть чат с ботом</button>` : ""}
    </main>`
  );
}

function route(param) {
  const me = App.me;
  const opts = { reset: true };
  if (param.startsWith("inv_")) return Router.go("join", { token: param.slice(4) }, opts);
  if (param.startsWith("join_")) return Router.go("legacyJoin", {}, opts);
  if (param === "scan" && !me.employee) return Router.go("scan", {}, opts);
  if (param.startsWith("defect_") && me.employee) return Router.go("shift", { focus: Number(param.slice(7)) }, opts);
  if ((param === "shift" || param === "checkin") && me.employee) return Router.go("shift", {}, opts);
  if (me.owner) {
    if (!me.owner.setup_done) return Router.go("setup", { step: 1 }, opts);
    return Router.go("home", {}, opts);
  }
  if (me.employee) return Router.go("shift", {}, opts);
  return Router.go("landing", {}, opts);
}

async function boot() {
  Bridge.ready();
  Auth.init();
  document.body.classList.toggle("is-mobile", Bridge.isMobile);
  if (!Bridge.inMax && !Auth.token) {
    await renderOpenFromBot();
    return;
  }
  mount("#app", skeleton(3));
  try {
    [App.me] = await Promise.all([api("GET", "/api/me"), Checklist.load()]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await renderOpenFromBot();
    } else {
      mount("#app", html`<main class="screen">${errorState(e, boot)}</main>`);
    }
    return;
  }
  await route(App.me.start_param || Auth.startParam || "");
}

window.addEventListener("DOMContentLoaded", boot);

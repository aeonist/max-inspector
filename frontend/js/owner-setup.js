// Owner setup wizard: 3 steps + "Готово"

const PRESET_POSITIONS = ["Повар", "Бариста", "Официант", "Кассир", "Уборщик", "Администратор"];
const DEFAULT_POSITIONS = ["Повар", "Официант", "Уборщик"];
// Who does the duties of a missing position by default, in genitive for "Задачи повара"
const ROLE_GENITIVE = { "Повар": "повара", "Официант": "официанта", "Уборщик": "уборщика" };

const Setup = {
  draft: null,
  editing: false,

  start(state, editing) {
    const staff = state.staff.filter((s) => !s.is_owner);
    this.editing = editing;
    this.draft = {
      name: state.setup_done || state.name !== "Моё заведение" ? state.name : "",
      address: state.address || "",
      qr_checkin: Boolean(state.qr_checkin),
      positions: state.positions && state.positions.length ? [...state.positions] : [...DEFAULT_POSITIONS],
      features: [...(state.features || [])],
      assignments: { ...(state.assignments || {}) },
      custom_duties: (state.custom_duties || []).map((d) => ({ question: d.question, position: d.position })),
      existing_staff: staff,
      new_staff: [],
      owner_works_shift: Boolean(state.owner_works_shift),
      owner_name: state.owner_name || Bridge.userName || (App.me && App.me.user.name) || "",
      showDuties: false,
    };
  },

  shiftItems() {
    return Checklist.items.filter((i) => (i.task_type || "shift") === "shift");
  },

  applies(item) {
    return !item.applies_to || this.draft.features.includes(item.applies_to);
  },

  // Assigned position, falling back to the checklist default or the first position
  positionFor(item) {
    const d = this.draft;
    const chosen = d.assignments[String(item.id)];
    if (d.positions.includes(chosen)) return chosen;
    if (d.positions.includes(item.default_role)) return item.default_role;
    return d.positions[0];
  },

  payload() {
    const d = this.draft;
    const assignments = {};
    this.shiftItems().forEach((item) => {
      assignments[String(item.id)] = this.positionFor(item);
    });
    return {
      name: d.name.trim(),
      address: d.address.trim() || null,
      qr_checkin: d.qr_checkin,
      positions: d.positions,
      features: d.features,
      assignments,
      custom_duties: d.custom_duties,
      new_staff: d.new_staff,
      owner_works_shift: d.owner_works_shift,
      owner_name: d.owner_name.trim() || null,
    };
  },
};

function stepHeader(step) {
  return html`<div class="steps">
    ${[1, 2, 3].map((n) => html`<span class="step ${n <= step ? "on" : ""}"></span>`)}
  </div>
  <p class="muted small">Шаг ${step} из 3</p>`;
}

function chip(label, selected, act, attrs = "") {
  return html`<button type="button" class="chip ${selected ? "selected" : ""}" data-act="${act}" data-value="${label}" ${raw(attrs)}>${label}</button>`;
}

Screens.setup = {
  async render({ step = 1 }) {
    if (!Setup.draft) {
      const state = await api("GET", "/api/owner/state");
      Setup.start(state, state.setup_done);
    }
    const title = Setup.editing ? "Настройки заведения" : "Настройка заведения";
    const body = step === 1 ? setupStep1() : step === 2 ? setupStep2() : setupStep3();
    mount("#app", screen(title, html`${stepHeader(step)}${body}`, { back: Router.stack.length > 1 }));
  },
};

// Step 1: the place
function setupStep1() {
  const d = Setup.draft;
  return html`<section class="card">
      <h2>Заведение</h2>
      <label class="field">
        <span>Название</span>
        <input id="fName" type="text" maxlength="120" placeholder="Кофейня «Зерно»" value="${d.name}">
      </label>
      <label class="field">
        <span>Адрес <em class="muted">— по желанию, попадёт в акт аудита</em></span>
        <input id="fAddress" type="text" maxlength="300" placeholder="Казань, ул. Баумана, 1" value="${d.address}">
      </label>
    </section>
    <section class="card">
      <label class="switch-row">
        <span>
          <strong>Начало смены по QR на рабочем месте</strong>
          <span class="muted small">Повесьте QR на кухне: сотрудник открывает смену, сканируя его в MAX, — из дома не отметиться. QR распечатаете после настройки. В веб-версии MAX сканера может не быть.</span>
        </span>
        <input id="fQr" type="checkbox" class="switch" ${raw(d.qr_checkin ? "checked" : "")}>
      </label>
    </section>
    ${Setup.editing
      ? ""
      : html`<p class="center"><button type="button" class="btn-link" data-act="tryDemo">Сначала посмотреть на демо-кафе</button></p>`}
    <div class="bottom-bar"><button type="button" class="btn btn-primary" data-act="setupNext1">Далее</button></div>`;
}

Actions.setupNext1 = () => {
  const d = Setup.draft;
  d.name = document.getElementById("fName").value;
  d.address = document.getElementById("fAddress").value;
  d.qr_checkin = document.getElementById("fQr").checked;
  if (!d.name.trim()) {
    toast("Как называется заведение?", { type: "error" });
    document.getElementById("fName").focus();
    return;
  }
  Router.go("setup", { step: 2 });
};

// Step 2: positions and team
function setupStep2() {
  const d = Setup.draft;
  const allPositions = [...PRESET_POSITIONS, ...d.positions.filter((p) => !PRESET_POSITIONS.includes(p))];
  const people = [
    ...d.existing_staff.map((s) => ({ ...s, existing: true })),
    ...d.new_staff.map((s, i) => ({ ...s, index: i })),
  ];
  return html`<section class="card">
      <h2>Должности</h2>
      <p class="muted small">Отметьте, кто у вас работает. По должностям распределятся задачи смены.</p>
      <div class="chips">
        ${allPositions.map((p) => chip(p, d.positions.includes(p), "togglePosition"))}
        <button type="button" class="chip chip-add" data-act="addPosition">+ Своя</button>
      </div>
    </section>

    <section class="card">
      <h2>Команда</h2>
      ${people.length
        ? html`<ul class="list">
            ${people.map(
              (p) => html`<li class="list-row">
                <span><strong>${p.full_name}</strong><span class="muted"> · ${p.position}</span></span>
                ${p.existing
                  ? html`<span class="badge ${p.linked ? "badge-ok" : ""}">${p.linked ? "в MAX" : "не в MAX"}</span>`
                  : html`<button type="button" class="icon-btn" data-act="removeNewStaff" data-index="${p.index}" aria-label="Убрать">✕</button>`}
              </li>`
            )}
          </ul>`
        : html`<p class="muted small">Добавьте сотрудников — после настройки отправите каждому личное приглашение в MAX.</p>`}
      <div class="add-person">
        <input id="fStaffName" type="text" maxlength="120" placeholder="Имя и фамилия">
        <div class="chips chips-small" id="staffPosChips">
          ${d.positions.map((p, i) => chip(p, i === 0, "pickStaffPosition"))}
        </div>
        <button type="button" class="btn btn-secondary" data-act="addNewStaff">Добавить в команду</button>
      </div>
    </section>

    <section class="card">
      <label class="switch-row">
        <span>
          <strong>Я тоже работаю на смене</strong>
          <span class="muted small">Отмечайте смены и берите любые задачи смены и нарушения — кто бы за них ни отвечал.</span>
        </span>
        <input id="fOwnerShift" type="checkbox" class="switch" ${raw(d.owner_works_shift ? "checked" : "")}>
      </label>
      <div id="ownerShiftBox" ${raw(d.owner_works_shift ? "" : "hidden")}>
        <label class="field">
          <span>Как вас подписывать</span>
          <input id="fOwnerName" type="text" maxlength="120" value="${d.owner_name}">
        </label>
      </div>
    </section>
    <div class="bottom-bar"><button type="button" class="btn btn-primary" data-act="setupNext2">Далее</button></div>`;
}

function readStep2() {
  const d = Setup.draft;
  const nameInput = document.getElementById("fOwnerName");
  if (nameInput) d.owner_name = nameInput.value;
}

Actions.togglePosition = (el) => {
  readStep2();
  const d = Setup.draft;
  const p = el.dataset.value;
  if (d.positions.includes(p)) {
    if (d.new_staff.some((s) => s.position === p)) {
      toast(`В команде есть «${p}». Сначала уберите его из команды`, { type: "error" });
      return;
    }
    if (d.existing_staff.some((s) => s.position === p)) {
      toast(`В команде есть «${p}». Сначала поменяйте ему должность в настройках`, { type: "error" });
      return;
    }
    if (d.positions.length === 1) {
      toast("Нужна хотя бы одна должность", { type: "error" });
      return;
    }
    d.positions = d.positions.filter((x) => x !== p);
  } else {
    d.positions.push(p);
  }
  Router.refresh();
};

Actions.addPosition = async () => {
  readStep2();
  const value = await sheet(
    html`<h3>Своя должность</h3><input id="newPosition" type="text" maxlength="60" placeholder="Например, Пекарь">`,
    [
      { label: "Добавить", kind: "primary", read: (root) => root.querySelector("#newPosition").value.trim() },
      { label: "Отмена", value: null },
    ]
  );
  if (value === "") toast("Введите название должности", { type: "error" });
  if (value) {
    const d = Setup.draft;
    if (!d.positions.includes(value)) d.positions.push(value);
    Router.refresh();
  }
};

Actions.pickStaffPosition = (el) => {
  document.querySelectorAll("#staffPosChips .chip").forEach((c) => c.classList.toggle("selected", c === el));
};

Actions.addNewStaff = () => {
  readStep2();
  const input = document.getElementById("fStaffName");
  const name = input.value.trim();
  const chipEl = document.querySelector("#staffPosChips .chip.selected");
  if (!name) {
    toast("Введите имя сотрудника", { type: "error" });
    input.focus();
    return;
  }
  Setup.draft.new_staff.push({ full_name: name, position: chipEl ? chipEl.dataset.value : Setup.draft.positions[0] });
  Router.refresh().then(() => document.getElementById("fStaffName").focus());
};

// Enter in the name field adds the person, as on a desktop form
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "fStaffName") {
    e.preventDefault();
    Actions.addNewStaff();
  }
});

Actions.removeNewStaff = (el) => {
  readStep2();
  Setup.draft.new_staff.splice(Number(el.dataset.index), 1);
  Router.refresh();
};

// Native checkbox: handled on change (delegated clicks call preventDefault)
document.addEventListener("change", (e) => {
  if (e.target.id !== "fOwnerShift" || !Setup.draft) return;
  Setup.draft.owner_works_shift = e.target.checked;
  document.getElementById("ownerShiftBox").hidden = !e.target.checked;
});

Actions.setupNext2 = () => {
  readStep2();
  const d = Setup.draft;
  if (d.owner_works_shift && !d.owner_name.trim()) {
    toast("Как вас подписывать в команде?", { type: "error" });
    document.getElementById("fOwnerName").focus();
    return;
  }
  Router.go("setup", { step: 3 });
};

// Step 3: what the place has, and who does which duty
function setupStep3() {
  const d = Setup.draft;
  const features = Object.keys(FEATURE_LABELS).filter((f) => Checklist.items.some((i) => i.applies_to === f));
  const duties = Setup.shiftItems().filter((i) => Setup.applies(i));
  const counts = {};
  duties.forEach((i) => {
    const p = Setup.positionFor(i);
    counts[p] = (counts[p] || 0) + 1;
  });
  d.custom_duties.forEach((c) => {
    counts[c.position] = (counts[c.position] || 0) + 1;
  });
  // Duties of positions this place does not have, grouped by the missing role
  const orphanGroups = {};
  duties
    .filter((i) => i.default_role && !d.positions.includes(i.default_role) && !d.positions.includes(d.assignments[String(i.id)]))
    .forEach((i) => {
      orphanGroups[i.default_role] = (orphanGroups[i.default_role] || 0) + 1;
    });

  const zones = {};
  duties.forEach((i) => {
    (zones[i.zone || i.section] = zones[i.zone || i.section] || []).push(i);
  });

  return html`<section class="card">
      <h2>Что у вас есть?</h2>
      <p class="muted small">Лишние вопросы уберём из аудита и задач смены.</p>
      <div class="checks">
        ${features.map(
          (f) => html`<label class="check-row">
            <input type="checkbox" data-feature="${f}" ${raw(d.features.includes(f) ? "checked" : "")}>
            <span>${FEATURE_LABELS[f]}</span>
          </label>`
        )}
      </div>
    </section>

    <section class="card">
      <h2>Обязанности смены</h2>
      <p>Распределили автоматически:</p>
      <ul class="list">
        ${d.positions.map(
          (p) => html`<li class="list-row"><span>${p}</span><strong>${counts[p] || 0} ${plural(counts[p] || 0, "задача", "задачи", "задач")}</strong></li>`
        )}
      </ul>
      ${Object.entries(orphanGroups).map(
        ([role, n]) => html`<div class="notice">
          <p>Задачи ${ROLE_GENITIVE[role] || role.toLowerCase()} (${n}) — у вас нет такой должности. Кто их делает?</p>
          <select data-orphan="${role}">
            ${d.positions.map((p) => html`<option value="${p}" ${raw(p === d.positions[0] ? "selected" : "")}>${p}</option>`)}
          </select>
        </div>`
      )}
      <button type="button" class="link-toggle ${d.showDuties ? "open" : ""}" data-act="toggleDuties">Посмотреть и изменить</button>
      <div id="dutyList" ${raw(d.showDuties ? "" : "hidden")}>
        ${Object.entries(zones).map(
          ([zone, items]) => html`<h3 class="zone">${zone}</h3>
            ${items.map(
              (i) => html`<div class="duty-row">
                <p>${i.question}</p>
                <select data-assign="${i.id}">
                  ${d.positions.map((p) => html`<option value="${p}" ${raw(p === Setup.positionFor(i) ? "selected" : "")}>${p}</option>`)}
                </select>
              </div>`
            )}`
        )}
      </div>
    </section>

    <section class="card">
      <h2>Свои задачи</h2>
      <p class="muted small">Например, «Протереть витрину после закрытия». Попадут в задачи смены.</p>
      ${d.custom_duties.length
        ? html`<ul class="list">
            ${d.custom_duties.map(
              (c, i) => html`<li class="list-row">
                <span>${c.question}<span class="muted"> · ${c.position}</span></span>
                <button type="button" class="icon-btn" data-act="removeCustomDuty" data-index="${i}" aria-label="Убрать">✕</button>
              </li>`
            )}
          </ul>`
        : ""}
      <button type="button" class="btn btn-secondary" data-act="addCustomDuty">+ Добавить задачу</button>
    </section>
    <div class="bottom-bar"><button type="button" class="btn btn-primary" data-act="setupFinish">${Setup.editing ? "Сохранить" : "Готово"}</button></div>`;
}

// Keep step 3 inputs in the draft as they change
document.addEventListener("change", (e) => {
  if (!Setup.draft) return;
  const t = e.target;
  if (t.dataset.feature) {
    const d = Setup.draft;
    d.features = t.checked ? [...new Set([...d.features, t.dataset.feature])] : d.features.filter((f) => f !== t.dataset.feature);
    Router.refresh();
  } else if (t.dataset.assign) {
    Setup.draft.assignments[t.dataset.assign] = t.value;
    Router.refresh();
  } else if (t.dataset.orphan) {
    Setup.shiftItems()
      .filter((i) => i.default_role === t.dataset.orphan)
      .forEach((i) => {
        Setup.draft.assignments[String(i.id)] = t.value;
      });
    Router.refresh();
  }
});

Actions.toggleDuties = () => {
  Setup.draft.showDuties = !Setup.draft.showDuties;
  Router.refresh();
};

Actions.addCustomDuty = async () => {
  const d = Setup.draft;
  const value = await sheet(
    html`<h3>Своя задача смены</h3>
      <input id="customQuestion" type="text" maxlength="200" placeholder="Протереть витрину после закрытия">
      <p class="muted small">Кто делает:</p>
      <select id="customPosition">${d.positions.map((p) => html`<option value="${p}">${p}</option>`)}</select>`,
    [
      {
        label: "Добавить",
        kind: "primary",
        read: (root) => ({
          question: root.querySelector("#customQuestion").value.trim(),
          position: root.querySelector("#customPosition").value,
        }),
      },
      { label: "Отмена", value: null },
    ]
  );
  if (value && !value.question) toast("Опишите задачу", { type: "error" });
  if (value && value.question) {
    d.custom_duties.push(value);
    Router.refresh();
  }
};

Actions.removeCustomDuty = (el) => {
  Setup.draft.custom_duties.splice(Number(el.dataset.index), 1);
  Router.refresh();
};

Actions.setupFinish = (el) =>
  busy(el, async () => {
    const editing = Setup.editing;
    const state = await api("PUT", "/api/owner/setup", Setup.payload());
    App.ownerState = state;
    // Roles changed (setup done, maybe "I work shifts too")
    App.me = await api("GET", "/api/me");
    Setup.draft = null;
    Bridge.haptic("success");
    if (editing) {
      toast("Сохранено ✓", { type: "success" });
      await Router.go("home", {}, { reset: true });
    } else {
      await Router.go("setupDone", {}, { reset: true });
    }
  });

Screens.setupDone = {
  async render() {
    const state = App.ownerState || (await api("GET", "/api/owner/state"));
    mount(
      "#app",
      html`<main class="screen done-screen">
        <div class="done-icon"><i class="ico" data-i="sparkles" aria-hidden="true"></i></div>
        <h1>Готово!</h1>
        <p class="lead">«${state.name}» настроено. Осталось два шага:</p>
        ${state.qr_checkin
          ? html`<div class="notice">
              <p><i class="ico" data-i="camera" aria-hidden="true"></i> Распечатайте QR «Начало смены» и повесьте на рабочем месте — по нему сотрудники будут открывать смену.</p>
              <button type="button" class="btn btn-small btn-secondary" data-act="downloadCheckin">Скачать QR (PDF)</button>
            </div>`
          : ""}
        <button type="button" class="next-step" data-act="goInvite">
          <span class="next-num">1</span>
          <span><strong>Пригласите команду</strong><span class="muted">Каждому — личная ссылка в MAX</span></span>
        </button>
        <button type="button" class="next-step" data-act="goAudit">
          <span class="next-num">2</span>
          <span><strong>Пройдите внутренний аудит</strong><span class="muted">${Checklist.items.length} ${plural(Checklist.items.length, "вопрос", "вопроса", "вопросов")} инспектора, около 20 минут, можно по частям</span></span>
        </button>
        <button type="button" class="btn btn-link" data-act="goHome">В кабинет</button>
      </main>`
    );
  },
};

// Audit and invite always sit on top of the cabinet, so "back" leads there
Actions.goInvite = () => Router.go("team", {}, { base: "home" });
Actions.goAudit = () => Router.go("audit", {}, { base: "home" });
Actions.goHome = () => Router.go("home", {}, { reset: true });

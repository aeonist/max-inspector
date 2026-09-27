// Owner cabinet: readiness, fixes to review, own tasks, shift now; invite and settings

const DEFECT_STATUS = {
  open: "Назначено",
  returned: "Возвращено на доработку",
  fixed: "Ждёт вашей проверки",
};

Screens.home = {
  async render() {
    await loadScreen(
      (state) => state.name,
      async () => {
        await Checklist.load();
        const state = await api("GET", "/api/owner/state");
        App.ownerState = state;
        return state;
      },
      (state) => homeView(state),
      {
        back: false,
        action: html`<button type="button" class="icon-btn" data-act="goSettings" aria-label="Настройки">⚙</button>`,
      }
    );
  },
};

function homeView(state) {
  const s = state.summary;
  const review = state.defects.filter((d) => d.status === "fixed");
  const mine = state.defects.filter((d) => d.to_owner && d.status !== "fixed");
  const team = state.defects.filter((d) => !d.to_owner && d.status !== "fixed");

  let auditButton = "Начать аудит";
  if (s.started && s.answered < s.total) auditButton = "Продолжить аудит";
  else if (s.answered === s.total) auditButton = "Итоги аудита";

  return html`${roleTabs("home")}
    ${state.geo_required && !state.has_coords
      ? html`<div class="notice">
          <p>📍 Отметьте заведение на карте — тогда смены будут открываться только на месте.</p>
          <button type="button" class="btn btn-small btn-secondary" data-act="requestGeo">Отправить кнопку в чат</button>
        </div>`
      : ""}

    <section class="card center">
      ${readinessRing(s)}
      ${readinessTodo(s, review.length, mine.length, team.length)}
      <button type="button" class="btn btn-primary" data-act="${s.answered === s.total ? "goAuditSummary" : "goAudit"}">${auditButton}</button>
    </section>

    ${review.length
      ? html`<section class="section" id="sec-review">
          <h2>Ждут вашей проверки <span class="count">${review.length}</span></h2>
          ${review.map((d) => reviewCard(d))}
        </section>`
      : ""}

    ${mine.length
      ? html`<section class="section" id="sec-mine">
          <h2>Ваши задачи <span class="count">${mine.length}</span></h2>
          ${mine.map((d) => ownerTaskCard(d))}
        </section>`
      : ""}

    ${team.length
      ? html`<section class="section" id="sec-team">
          <h2>Нарушения у команды <span class="count">${team.length}</span></h2>
          <ul class="list card">
            ${team.map(
              (d) => html`<li>
                <button type="button" class="list-row row-button" data-act="teamDefect" data-id="${d.id}">
                  <span><strong>${d.title}</strong><span class="muted small block">${d.assigned_position} · ${DEFECT_STATUS[d.status]}${d.return_reason ? html` (${d.return_reason})` : ""}</span></span>
                  <span class="chevron">›</span>
                </button>
              </li>`
            )}
          </ul>
        </section>`
      : ""}

    ${shiftNowSection(state)}

    <section class="section">
      <h2>Документы и команда</h2>
      <div class="tiles">
        <button type="button" class="tile" data-act="goInvite"><span class="tile-icon">🔗</span>QR для сотрудников</button>
        <button type="button" class="tile" data-act="downloadAct"><span class="tile-icon">📄</span>Акт аудита (PDF)</button>
      </div>
    </section>
    ${chatButton()}`;
}

// What exactly stands between the facility and "ready for inspection", each row leads there
function readinessTodo(s, review, mine, team) {
  const left = s.total - s.answered;
  const rows = [];
  if (review) rows.push({ icon: "🔍", text: `Проверить исправления: ${review}`, target: "sec-review" });
  if (mine) rows.push({ icon: "📋", text: `Ваши задачи: ${mine}`, target: "sec-mine" });
  if (team) rows.push({ icon: "👥", text: `Нарушения у команды: ${team}`, target: "sec-team" });
  if (left) rows.push({ icon: "❓", text: `Не проверено вопросов: ${left} из ${s.total}`, act: "goAudit" });
  if (!rows.length && !s.ready) rows.push({ icon: "📊", text: `Индекс ${s.index}% — для готовности нужно от 90%`, act: "goAuditSummary" });

  if (!rows.length) return html`<p class="muted small">Аудит пройден, нарушений нет. Соблюдается ${s.compliant} из ${s.applicable}.</p>`;
  return html`<div class="todo">
    <p class="todo-title">Что сделать для готовности:</p>
    ${rows.map(
      (r) => html`<button type="button" class="todo-row" data-act="${r.act || "scrollToSection"}" data-target="${r.target || ""}">
        <span class="todo-icon">${r.icon}</span><span class="todo-text">${r.text}</span><span class="chevron">›</span>
      </button>`
    )}
  </div>`;
}

// The whole team with their shift status, not just a count
function shiftNowSection(state) {
  const people = [...state.staff].sort((a, b) => Number(b.on_shift) - Number(a.on_shift));
  const onShift = people.filter((p) => p.on_shift).length;
  if (!people.length) {
    return html`<section class="section" id="sec-shift">
      <h2>Смена сейчас</h2>
      <div class="card empty-inline">
        <p class="muted">В команде пока никого. Добавьте людей в настройках и отправьте им QR-код.</p>
      </div>
    </section>`;
  }
  return html`<section class="section" id="sec-shift">
    <h2>Смена сейчас <span class="count">${onShift} из ${people.length}</span></h2>
    <ul class="list card">
      ${people.map(
        (p) => html`<li class="person">
          <span><strong>${p.full_name}</strong>${p.is_owner ? " (вы)" : ""}
            <span class="muted small block">${p.position}${p.on_shift ? html` · с ${p.shift_started}${geoNote(p)}` : ""}</span></span>
          ${p.on_shift
            ? html`<span class="person-right"><span class="badge badge-ok">на смене</span><span class="small muted">задачи ${p.tasks_done}/${p.tasks_total}</span></span>`
            : html`<span class="badge">${p.linked ? "не на смене" : "ждёт входа по QR"}</span>`}
        </li>`
      )}
    </ul>
    ${onShift ? "" : html`<p class="muted small">Сотрудники начинают смену кнопкой в чате с ботом.</p>`}
  </section>`;
}

Actions.scrollToSection = (el) => {
  const target = document.getElementById(el.dataset.target);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.remove("flash");
  void target.offsetWidth;
  target.classList.add("flash");
};

Actions.teamDefect = (el) => {
  const d = App.ownerState.defects.find((x) => x.id === Number(el.dataset.id));
  if (!d) return;
  sheet(
    html`<p class="muted small">${d.zone} · ${d.assigned_position} · ${DEFECT_STATUS[d.status]}</p>
      <h3>${d.title}</h3>
      ${d.return_reason ? html`<p class="notice small">↩️ Вернули: ${d.return_reason}</p>` : ""}
      ${photoPair(d.before_photo, "Как сейчас", d.reference_photo, "Как должно быть")}
      ${d.remediation ? html`<p><strong>Что сделать:</strong> ${d.remediation}</p>` : ""}
      <p class="muted small">Задача у должности «${d.assigned_position}». Когда пришлют фото исправления, оно появится в «Ждут вашей проверки».</p>`,
    [{ label: "Закрыть", value: null }]
  );
};

function geoNote(person) {
  if (person.geo_status === "verified") return html` · 📍 на месте`;
  if (person.geo_status === "no_coords") return html` · <span class="warn">место не проверено</span>`;
  return "";
}

function reviewCard(d) {
  return html`<article class="card defect-card">
    <p class="muted small">${d.fixed_by ? html`${d.fixed_by} · ` : ""}${d.fixed_at || ""}</p>
    <h3>${d.title}</h3>
    ${photoPair(d.before_photo, "Было", d.after_photo, "Стало")}
    <div class="row-buttons">
      <button type="button" class="btn btn-primary" data-act="acceptFix" data-id="${d.id}">Принять</button>
      <button type="button" class="btn btn-secondary" data-act="returnFix" data-id="${d.id}">Вернуть</button>
    </div>
  </article>`;
}

function ownerTaskCard(d) {
  const isProblem = d.kind === "problem";
  return html`<article class="card defect-card">
    <p class="muted small">${isProblem ? "Сообщение от сотрудника" : d.zone}${d.status === "returned" ? " · возвращено" : ""}</p>
    <h3>${d.title}</h3>
    ${isProblem && d.comment && d.comment !== d.title ? html`<p>${d.comment}</p>` : ""}
    ${d.remediation ? html`<p><strong>Что сделать:</strong> ${d.remediation}</p>` : ""}
    ${d.before_photo || d.reference_photo ? photoPair(d.before_photo, "Как сейчас", d.reference_photo, "Как должно быть") : ""}
    <div class="row-buttons">
      <button type="button" class="btn btn-secondary" data-act="resolveWithPhoto" data-id="${d.id}">${photoLabel("результат")}</button>
      <button type="button" class="btn btn-secondary" data-act="resolveOwnerTask" data-id="${d.id}">${isProblem ? "Решено" : "Устранено"}</button>
    </div>
  </article>`;
}

Actions.goSettings = () => Router.go("settings");
Actions.goAuditSummary = () => Router.go("auditSummary");

Actions.requestGeo = (el) =>
  busy(el, async () => {
    await api("POST", "/api/owner/geo/request");
    toast("Отправили кнопку в чат. Нажмите её, когда будете в заведении", { type: "success" });
  });

Actions.acceptFix = (el) =>
  busy(el, async () => {
    const res = await api("POST", `/api/owner/defects/${el.dataset.id}/accept`);
    Bridge.haptic("success");
    toast(`Принято ✓ Готовность: ${res.summary.index}%`, { type: "success" });
    await Router.refresh();
  });

Actions.returnFix = async (el) => {
  const reason = await sheet(html`<h3>Почему возвращаете?</h3><p class="muted small">Сотрудник увидит причину в задаче.</p>`, [
    { label: "Не видно на фото", value: "Не видно на фото" },
    { label: "Не устранено", value: "Не устранено" },
    { label: "Нужно переделать", value: "Нужно переделать" },
    { label: "Отмена", value: null },
  ]);
  if (!reason) return;
  await busy(el, async () => {
    await api("POST", `/api/owner/defects/${el.dataset.id}/return`, { reason });
    toast("Вернули сотруднику", { type: "success" });
    await Router.refresh();
  });
};

async function resolveOwnerTask(el, photoUrl) {
  await busy(el, async () => {
    const res = await api("POST", `/api/owner/defects/${el.dataset.id}/resolve`, { photo_url: photoUrl });
    Bridge.haptic("success");
    toast(`Готово ✓ Готовность: ${res.summary.index}%`, { type: "success" });
    await Router.refresh();
  });
}

// Own task closed with an "after" photo (camera opens right from the tap)
Actions.resolveWithPhoto = (el) => {
  pickPhoto().then(async (file) => {
    if (!file) return;
    const photoUrl = await busy(el, () => uploadPhoto(file));
    if (photoUrl) await resolveOwnerTask(el, photoUrl);
  });
};

Actions.resolveOwnerTask = async (el) => {
  const defect = App.ownerState.defects.find((d) => d.id === Number(el.dataset.id));
  const note = defect && defect.item_id ? "Пункт аудита станет «Соблюдается»." : "Задача закроется.";
  if (await confirmSheet("Отметить устранённым?", note, "Да, устранено")) {
    await resolveOwnerTask(el, null);
  }
};

// Invite the team: QR on screen, share to a MAX chat, printable poster
Screens.invite = {
  async render() {
    await loadScreen(
      "Подключить команду",
      () => api("GET", "/api/owner/invite"),
      (invite) => {
        App.invite = invite;
        return html`<section class="card center">
            <div class="qr">${raw(invite.qr_svg)}</div>
            <p>Сотрудник наводит камеру телефона на QR или сканирует его в MAX — и выбирает себя из списка команды.</p>
          </section>
          <div class="stack">
            <button type="button" class="btn btn-primary" data-act="shareInvite">Отправить ссылку в рабочий чат</button>
            <button type="button" class="btn btn-secondary" data-act="copyInvite">Скопировать ссылку</button>
            <button type="button" class="btn btn-secondary" data-act="downloadPoster">🖨 Плакат для кухни (PDF)</button>
          </div>
          <p class="muted small center">В списке будут те, кого вы добавили в команду. Добавить людей можно в настройках.</p>`;
      }
    );
  },
};

Actions.shareInvite = (el) =>
  busy(el, async () => {
    const text = `Подключайтесь к сменам в MAX: откройте ссылку и выберите себя в списке`;
    const shared = await Bridge.shareToMax(text, App.invite.url);
    if (!shared) Actions.copyInvite();
  });

Actions.copyInvite = async () => {
  try {
    await navigator.clipboard.writeText(App.invite.url);
    toast("Ссылка скопирована ✓", { type: "success" });
  } catch (e) {
    sheet(html`<h3>Ссылка-приглашение</h3><input type="text" readonly value="${App.invite.url}">`, [{ label: "Закрыть", value: null }]);
  }
};

Actions.downloadPoster = (el) =>
  busy(el, async () => {
    const file = App.invite.files.poster;
    await Bridge.download(file.url, file.file_name);
  });

// Settings: facility params, team, location, audit restart, legal note
Screens.settings = {
  async render() {
    await loadScreen(
      "Настройки",
      async () => {
        const state = await api("GET", "/api/owner/state");
        App.ownerState = state;
        return state;
      },
      (state) => settingsView(state)
    );
  },
};

function settingsView(state) {
  return html`<section class="card">
      <h2>${state.name}</h2>
      <p class="muted">${state.address || "Адрес не указан"}</p>
      <p class="small">Геопозиция смен: ${state.geo_required ? (state.has_coords ? `включена, радиус ${state.geo_radius_m} м` : "включена, место не отмечено") : "выключена"}</p>
      <div class="stack">
        <button type="button" class="btn btn-secondary" data-act="editSetup">Изменить название, должности и обязанности</button>
        ${state.geo_required ? html`<button type="button" class="btn btn-secondary" data-act="requestGeo">${state.has_coords ? "Обновить место на карте" : "Отметить место на карте"}</button>` : ""}
      </div>
    </section>

    <section class="section">
      <h2>Команда</h2>
      <ul class="list card">
        ${state.staff.map(
          (p) => html`<li class="list-row">
            <span><strong>${p.full_name}</strong>${p.is_owner ? " (вы)" : ""}<span class="muted small block">${p.position} · ${p.linked ? "в MAX" : "ждёт входа по QR"}</span></span>
            ${p.is_owner ? "" : html`<button type="button" class="icon-btn" data-act="staffMenu" data-id="${p.id}" aria-label="Действия">⋯</button>`}
          </li>`
        )}
      </ul>
      <button type="button" class="btn btn-secondary" data-act="addStaff">+ Добавить сотрудника</button>
    </section>

    <section class="section">
      <h2>Аудит</h2>
      <button type="button" class="btn btn-secondary" data-act="restartAudit">Пройти аудит заново</button>
    </section>

    <section class="section">
      <button type="button" class="btn btn-danger" data-act="deleteFacility">Удалить заведение и начать заново</button>
    </section>

    <section class="section">
      <button type="button" class="link-toggle" data-act="toggle" data-target="legalNote">Справка: на чём основан аудит</button>
      <div id="legalNote" class="card basis" hidden>
        <p>Вопросы аудита — это проверочный лист Роспотребнадзора для предприятий общественного питания (приложение № 2 к приказу от 24.12.2021 № 808). Основания сверены с СанПиН 2.3/2.4.3590-20 в редакции 2024 года.</p>
        <p>Акт аудита — документ для внутреннего контроля. Он не заменяет проверку и не регистрируется в контрольном органе. Его ценность в том, что вы заранее проходите ровно тот лист, по которому придёт инспектор, и устраняете нарушения до проверки.</p>
      </div>
    </section>`;
}

Actions.deleteFacility = async (el) => {
  const ok = await confirmSheet(
    `Удалить «${App.ownerState.name}»?`,
    "Вы перестанете быть владельцем, а заведение пропадёт из кабинета. Сотрудники больше не будут получать задачи. После этого можно создать новое заведение.",
    "Удалить",
    "danger"
  );
  if (!ok) return;
  await busy(el, async () => {
    await api("DELETE", "/api/owner/facility");
    App.me = await api("GET", "/api/me");
    App.ownerState = null;
    toast("Заведение удалено", { type: "success" });
    await Router.go("landing", {}, { reset: true });
  });
};

Actions.editSetup = async () => {
  Setup.start(App.ownerState, true);
  await Router.go("setup", { step: 1 });
};

Actions.addStaff = async () => {
  const state = App.ownerState;
  const person = await sheet(
    html`<h3>Новый сотрудник</h3>
      <input id="newStaffName" type="text" maxlength="120" placeholder="Имя и фамилия">
      <select id="newStaffPosition">${state.positions.map((p) => html`<option value="${p}">${p}</option>`)}</select>`,
    [
      {
        label: "Добавить",
        kind: "primary",
        read: (root) => ({
          full_name: root.querySelector("#newStaffName").value.trim(),
          position: root.querySelector("#newStaffPosition").value,
        }),
      },
      { label: "Отмена", value: null },
    ]
  );
  if (!person || !person.full_name) return;
  try {
    await api("POST", "/api/owner/staff", person);
    toast(`${person.full_name} в команде. Пусть отсканирует QR`, { type: "success" });
    await Router.refresh();
  } catch (e) {
    toastError(e);
  }
};

Actions.staffMenu = async (el) => {
  const person = App.ownerState.staff.find((p) => p.id === Number(el.dataset.id));
  const actions = [{ label: "Сменить должность", value: "position" }];
  if (person.linked) actions.push({ label: "Отвязать аккаунт MAX", value: "unlink" });
  actions.push({ label: "Убрать из команды", kind: "danger", value: "remove" }, { label: "Отмена", value: null });
  const choice = await sheet(html`<h3>${person.full_name}</h3><p class="muted">${person.position}</p>`, actions);
  try {
    if (choice === "position") {
      const position = await sheet(
        html`<h3>Новая должность</h3>`,
        [...App.ownerState.positions.map((p) => ({ label: p, value: p })), { label: "Отмена", value: null }]
      );
      if (!position) return;
      await api("PATCH", `/api/owner/staff/${person.id}`, { position });
      toast("Должность изменена ✓", { type: "success" });
    } else if (choice === "unlink") {
      if (!(await confirmSheet("Отвязать аккаунт?", "Сотрудник сможет заново выбрать себя по QR — например, с нового телефона.", "Отвязать"))) return;
      await api("POST", `/api/owner/staff/${person.id}/unlink`);
      toast("Аккаунт отвязан", { type: "success" });
    } else if (choice === "remove") {
      if (!(await confirmSheet(`Убрать ${person.full_name}?`, "История смен и исправлений сохранится.", "Убрать", "danger"))) return;
      await api("DELETE", `/api/owner/staff/${person.id}`);
      toast("Сотрудник убран из команды", { type: "success" });
    } else {
      return;
    }
    await Router.refresh();
  } catch (e) {
    toastError(e);
  }
};

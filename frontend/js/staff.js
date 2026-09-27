// Staff: join by invite, QR scan, "Моя смена"

const Staff = { shift: null, problemPhotos: [], zone: "all" };

// ---------- Join ----------

Screens.join = {
  async render({ token }) {
    await loadScreen(
      "Приглашение",
      () => api("GET", `/api/invite/${encodeURIComponent(token)}`),
      (info) => joinView(info, token),
      { back: Router.stack.length > 1 }
    );
  },
};

function joinView(info, token) {
  if (info.is_owner) {
    return html`<div class="empty">
      <div class="empty-icon">🔗</div>
      <p>Это личное приглашение для сотрудника ${info.full_name}. Перешлите его ему.</p>
      <button type="button" class="btn btn-primary" data-act="goHome">В кабинет</button>
    </div>`;
  }
  if (info.other_facility) {
    return html`<div class="empty">
      <div class="empty-icon">ℹ️</div>
      <p>Вы уже подключены к «${info.other_facility}». Чтобы перейти в «${info.facility_name}», попросите прежнего руководителя отвязать ваш аккаунт.</p>
    </div>`;
  }
  return html`<div class="empty">
    <div class="empty-icon">👋</div>
    <p class="lead">Приглашение в команду «${info.facility_name}»</p>
    <h2>Вы — ${info.full_name}, ${info.position}?</h2>
    <button type="button" class="btn btn-primary" data-act="acceptInvite" data-token="${token}">Да, это я</button>
    <p class="muted small">Если это не вы — закройте приглашение и сообщите руководителю.</p>
  </div>`;
}

Actions.acceptInvite = (el) =>
  busy(el, async () => {
    const res = await api("POST", `/api/invite/${encodeURIComponent(el.dataset.token)}`);
    App.me = await api("GET", "/api/me");
    Bridge.haptic("success");
    await Router.go("joined", res, { reset: true });
  });

// Links of the first version: one link for the whole team
Screens.legacyJoin = {
  async render() {
    mount(
      "#app",
      screen(
        "Приглашение",
        html`<div class="empty">
          <div class="empty-icon">🔗</div>
          <p>Эта ссылка больше не работает: теперь у каждого сотрудника личное приглашение. Попросите руководителя прислать его.</p>
          ${chatButton()}
        </div>`,
        { back: false }
      )
    );
  },
};

Screens.joined = {
  async render(res) {
    mount(
      "#app",
      html`<main class="screen done-screen">
        <div class="done-icon">👋</div>
        <h1>Вы в команде!</h1>
        <p class="lead">«${res.facility_name}» · ${res.full_name}, ${res.position}</p>
        <p>Смена начинается в чате с ботом: нажмите «Начать смену» на месте. Задачи и нарушения будут приходить туда же.</p>
        <button type="button" class="btn btn-primary" data-act="closeApp">Перейти в чат</button>
        <button type="button" class="btn-link" data-act="goShiftReset">Посмотреть задачи смены</button>
      </main>`
    );
  },
};

Actions.goShiftReset = () => Router.go("shift", {}, { reset: true });

// ---------- QR scan (MAX openCodeReader) ----------

Screens.scan = {
  async render() {
    mount(
      "#app",
      screen(
        "Подключение",
        html`<div class="empty">
          <div class="empty-icon">📷</div>
          <p>Попросите руководителя прислать вам личное приглашение в MAX — или отсканируйте QR с экрана его телефона.</p>
          ${Bridge.inMax
            ? html`<button type="button" class="btn btn-primary" data-act="scanInvite">Сканировать QR</button>`
            : html`<p class="muted small">Наведите камеру телефона на QR-код — откроется чат с ботом.</p>`}
        </div>`,
        { back: Router.stack.length > 1 }
      )
    );
  },
};

Actions.scanInvite = (el) =>
  busy(el, async () => {
    let value;
    try {
      value = await Bridge.scanQR();
    } catch (e) {
      throw new ApiError("Не получилось отсканировать. Попробуйте ещё раз", 0);
    }
    const match = value.match(/inv_([\w-]+)/);
    if (!match) throw new ApiError("Это не приглашение МАХ-Инспектора. Попросите руководителя показать ваш QR", 0);
    await Router.go("join", { token: match[1] });
  });

// ---------- My shift ----------

Screens.shift = {
  async render({ focus } = {}) {
    const data = await loadScreen(
      "Моя смена",
      async () => {
        await Checklist.load();
        return api("GET", "/api/shift");
      },
      (shift) => {
        Staff.shift = shift;
        return shiftView(shift);
      },
      { back: Router.stack.length > 1 }
    );
    if (data && focus) {
      const card = document.getElementById(`defect-${focus}`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("highlight");
      }
    }
  },
};

function shiftView(data) {
  const shift = data.shift;
  const urgent = data.defects.filter((d) => d.status !== "fixed");
  const onReview = data.defects.filter((d) => d.status === "fixed");
  const isOwner = data.employee.is_owner;
  const zoneNames = [...new Set(data.duties.map((d) => d.zone))];
  if (!zoneNames.includes(Staff.zone)) Staff.zone = "all";
  const visible = data.duties.filter((d) => Staff.zone === "all" || d.zone === Staff.zone);
  const zones = {};
  visible.forEach((d) => {
    (zones[d.zone] = zones[d.zone] || []).push(d);
  });
  const done = data.duties.filter((d) => d.done).length;
  const zoneCount = (zone) => {
    const list = data.duties.filter((d) => zone === "all" || d.zone === zone);
    return `${list.filter((d) => d.done).length}/${list.length}`;
  };

  return html`${roleTabs("shift")}
    <section class="card">
      <p class="muted small">${data.facility.name}</p>
      <h2>${data.employee.full_name}<span class="muted"> · ${isOwner ? "все задачи смены" : data.employee.position}</span></h2>
      ${isOwner ? html`<button type="button" class="btn-link small" data-act="ownerRoleMenu">Выйти из роли сотрудника</button>` : ""}
      ${shift
        ? html`<p class="status status-green">Смена с ${shift.started}${shift.geo_status === "verified" ? " · 📍 на месте" : ""}${shift.geo_status === "no_coords" ? " · место не проверено" : ""}</p>`
        : html`<p class="status status-gray">Смена не начата</p>
          ${data.facility.geo_required
            ? html`<p class="muted small">Начните смену в чате с ботом: кнопка «Начать смену — я на месте» работает, когда вы в заведении.</p>
              <button type="button" class="btn btn-primary" data-act="closeApp">Перейти в чат</button>`
            : html`<button type="button" class="btn btn-primary" data-act="startShift">Начать смену</button>`}`}
    </section>

    ${urgent.length
      ? html`<section class="section">
          <h2 class="urgent-title">🔴 Срочно <span class="count">${urgent.length}</span></h2>
          ${urgent.map((d) => urgentCard(d))}
        </section>`
      : ""}

    ${onReview.length
      ? html`<section class="section">
          <h2>На проверке у руководителя <span class="count">${onReview.length}</span></h2>
          ${onReview.map(
            (d) => html`<article class="card defect-card" id="defect-${d.id}">
              <h3>${d.title}</h3>
              ${photoPair(d.before_photos, "Было", d.after_photos, "Стало")}
              <p class="muted small">⏳ Руководитель проверит фото и примет исправление</p>
            </article>`
          )}
        </section>`
      : ""}

    <section class="section">
      <h2>Задачи смены <span class="count">${done}/${data.duties.length}</span></h2>
      ${data.duties.length
        ? html`<div class="bar"><div class="bar-fill" style="width:${data.duties.length ? Math.round((done / data.duties.length) * 100) : 0}%"></div></div>
          ${shift ? "" : html`<p class="muted small">Отмечать задачи можно после начала смены.</p>`}
          ${zoneNames.length > 1
            ? html`<div class="chips chips-small zone-filter">
                <button type="button" class="chip ${Staff.zone === "all" ? "selected" : ""}" data-act="filterZone" data-zone="all">Все · ${zoneCount("all")}</button>
                ${zoneNames.map(
                  (z) => html`<button type="button" class="chip ${Staff.zone === z ? "selected" : ""}" data-act="filterZone" data-zone="${z}">${z} · ${zoneCount(z)}</button>`
                )}
              </div>`
            : ""}
          ${Object.entries(zones).map(
            ([zone, duties]) => html`<h3 class="zone">${zone}</h3>
              <ul class="task-list card">
                ${duties.map(
                  (d) => html`<li class="task ${d.done ? "done" : ""}">
                    <button type="button" class="task-check" data-act="toggleTask" data-id="${d.id}" data-done="${d.done ? "1" : ""}" ${raw(shift ? "" : "disabled")}
                      aria-label="${d.done ? "Снять отметку" : "Отметить выполненной"}">${d.done ? "✓" : ""}</button>
                    <span class="task-text">${d.question}${d.photos.length ? html` <span class="muted small">📷 ${d.photos.length}</span>` : ""}${isOwner && d.position
                      ? html`<span class="muted small block">${d.position}</span>`
                      : ""}</span>
                    <button type="button" class="icon-btn" data-act="taskMenu" data-id="${d.id}" aria-label="Подробнее">⋯</button>
                  </li>`
                )}
              </ul>`
          )}`
        : html`<p class="muted">${isOwner ? "Задач смены пока нет. Их можно добавить в настройках." : "На вашу должность задач нет. Руководитель может добавить их в настройках."}</p>`}
    </section>

    <div class="stack">
      <button type="button" class="btn btn-secondary" data-act="reportProblem">📣 Сообщить о проблеме</button>
      ${shift ? html`<button type="button" class="btn btn-secondary" data-act="endShift">Завершить смену</button>` : ""}
      ${chatButton()}
    </div>`;
}

// Show the duties of one zone (kitchen, storage...) or all of them
Actions.filterZone = (el) => {
  Staff.zone = el.dataset.zone;
  mount("#app", screen("Моя смена", shiftView(Staff.shift), { back: Router.stack.length > 1 }));
};

// Owner in the employee role: turn it off
Actions.ownerRoleMenu = async (el) => {
  const ok = await confirmSheet(
    "Выйти из роли сотрудника?",
    "Смена закроется, а задачи смены пропадут из вашего меню. Включить роль снова можно вкладкой «Моя смена».",
    "Выйти",
    "danger"
  );
  if (ok) await setShiftRole(el, false, null);
};

function urgentCard(d) {
  return html`<article class="card defect-card urgent" id="defect-${d.id}">
    ${d.status === "returned" ? html`<p class="notice small">↩️ Вернули: ${d.return_reason}</p>` : ""}
    <p class="muted small">${d.zone}</p>
    <h3>${d.title}</h3>
    ${photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть")}
    ${!d.reference_photo && d.photo_hint ? html`<p class="small"><strong>Как должно быть:</strong> ${d.photo_hint}</p>` : ""}
    ${d.remediation ? html`<p><strong>Что сделать:</strong> ${d.remediation}</p>` : ""}
    ${basisBlock(Checklist.byId[d.item_id], "dbasis-" + d.id)}
    <button type="button" class="btn btn-primary" data-act="fixDefect" data-id="${d.id}">${photoLabel("исправление")}</button>
  </article>`;
}

Actions.startShift = (el) =>
  busy(el, async () => {
    await api("POST", "/api/shift/start");
    Bridge.haptic("success");
    toast("Смена начата ✓", { type: "success" });
    await Router.refresh();
  });

// "After" photos go to the owner as before/after for review
Actions.fixDefect = async (el) => {
  const photos = await collectPhotos({
    title: "Исправление",
    note: "Покажите, как стало. Руководитель сравнит с фото «было».",
    confirm: "Отправить на проверку",
  });
  if (!photos) return;
  await busy(el, async () => {
    await api("POST", `/api/defects/${el.dataset.id}/fix`, { photos });
    Bridge.haptic("success");
    toast("Отправлено руководителю на проверку ✓", { type: "success" });
    await Router.refresh();
  });
};

Actions.toggleTask = (el) => {
  const done = !el.dataset.done;
  // Optimistic update; rolled back by the refresh on error
  el.closest(".task").classList.toggle("done", done);
  el.textContent = done ? "✓" : "";
  el.dataset.done = done ? "1" : "";
  if (done) Bridge.haptic("light");
  api("POST", `/api/shift/tasks/${el.dataset.id}`, { done })
    .then(() => {
      const duty = Staff.shift.duties.find((d) => d.id === Number(el.dataset.id));
      if (duty) duty.done = done;
      updateTaskCounters();
    })
    .catch((e) => {
      toastError(e, () => Actions.toggleTask(el));
      Router.refresh();
    });
};

function updateTaskCounters() {
  const duties = Staff.shift.duties;
  const done = duties.filter((d) => d.done).length;
  const section = document.querySelector(".task-list") && document.querySelector(".task-list").closest(".section");
  if (!section) return;
  section.querySelector(".count").textContent = `${done}/${duties.length}`;
  section.querySelector(".bar-fill").style.width = `${Math.round((done / duties.length) * 100)}%`;
}

Actions.taskMenu = (el) => {
  const duty = Staff.shift.duties.find((d) => d.id === Number(el.dataset.id));
  const item = Checklist.byId[duty.id];
  sheet(
    html`<h3>${duty.question}</h3>
      ${duty.norm ? html`<p>${duty.norm}</p>` : ""}
      ${duty.photo_hint ? html`<p class="muted small">Что показать на фото: ${duty.photo_hint}</p>` : ""}
      ${item && item.reference_photo
        ? html`<button type="button" class="example ok wide" data-act="photo" data-src="/${item.reference_photo}" data-caption="Так правильно">
            <img src="/${item.reference_photo}" alt=""><span>✓ Так правильно</span></button>`
        : ""}
      ${duty.photos.length
        ? html`<button type="button" class="inline-link" data-act="photo" data-srcs="${JSON.stringify(duty.photos)}" data-caption="Фото выполнения">📷 Фото прикреплено: ${duty.photos.length}</button>`
        : ""}
      ${Staff.shift.shift
        ? html`<button type="button" class="btn btn-secondary" data-act="taskPhoto" data-id="${duty.id}">${photoLabel("выполнение")}</button>`
        : ""}`,
    [{ label: "Закрыть", value: null }]
  );
};

// Optional photo proof of a duty; marks it done
Actions.taskPhoto = async (el) => {
  const id = Number(el.dataset.id);
  const photos = await collectPhotos({ title: "Фото выполнения", confirm: "Прикрепить" });
  if (!photos) return;
  document.dispatchEvent(new Event("sheet:close"));
  try {
    await api("POST", `/api/shift/tasks/${id}`, { done: true, photos });
    toast("Фото прикреплено, задача выполнена ✓", { type: "success" });
    await Router.refresh();
  } catch (e) {
    toastError(e);
  }
};

Actions.endShift = (el) =>
  busy(el, async () => {
    let res = await api("POST", "/api/shift/end", { force: false });
    if (!res.closed) {
      const ok = await confirmSheet(
        `Осталось ${res.left} ${plural(res.left, "задача", "задачи", "задач")}`,
        "Всё равно завершить смену?",
        "Завершить",
        "danger"
      );
      if (!ok) return;
      res = await api("POST", "/api/shift/end", { force: true });
    }
    const s = res.stats;
    Bridge.haptic("success");
    toast(`Смена завершена. Выполнено ${s.done} из ${s.total}${s.fixed ? `, исправлено нарушений: ${s.fixed}` : ""}`, {
      type: "success",
      duration: 5000,
    });
    await Router.refresh();
  });

Actions.reportProblem = async () => {
  Staff.problemPhotos = [];
  const text = await sheet(
    html`<h3>Сообщить о проблеме</h3>
      <p class="muted small">Например: сломался холодильник, закончилось дезсредство. Сообщение уйдёт руководителю.</p>
      <textarea id="problemText" rows="3" maxlength="500" placeholder="Что случилось?"></textarea>
      <button type="button" class="btn btn-secondary" id="problemPhotoBtn" data-act="problemPhoto">${photoLabel("")}</button>`,
    [
      {
        label: "Отправить",
        kind: "primary",
        validate: (root) => {
          const ok = root.querySelector("#problemText").value.trim().length >= 3;
          if (!ok) toast("Опишите проблему парой слов", { type: "error" });
          return ok;
        },
        read: (root) => root.querySelector("#problemText").value.trim(),
      },
      { label: "Отмена", value: null },
    ]
  );
  if (!text) return;
  try {
    await api("POST", "/api/problems", { text, photos: Staff.problemPhotos });
    toast("Отправлено руководителю ✓", { type: "success" });
  } catch (e) {
    toastError(e);
  }
};

Actions.problemPhoto = async (el) => {
  const photos = await collectPhotos({ title: "Фото проблемы", confirm: "Прикрепить" });
  if (photos) {
    Staff.problemPhotos = photos;
    el.textContent = `📷 Фото прикреплено: ${photos.length} ✓`;
  }
};

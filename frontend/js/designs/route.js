// Design «Маршрут»: the café as the route an inspector walks, from documents to waste.
// Readiness is a line map: each stretch is coloured by what was found there, and violations
// hang off their station as branches. The audit walks down the same line, and a cook's shift
// is the line of their zones with every duty as a stop.

(function () {
  const STATE_WORDS = {
    ok: "нарушений нет",
    bad: "есть нарушения",
    review: "исправлено, ждёт проверки",
    todo: "не пройдено",
  };

  function defectSection(d) {
    const item = d.item_id && Checklist.byId[d.item_id];
    return item ? item.section : null;
  }

  // Every station of the walk: how much of it is checked and what is wrong there
  function stations(defects, countsOf) {
    return SECTION_ORDER.map((name) => {
      const counts = countsOf(name);
      const here = defects.filter((d) => defectSection(d) === name);
      const review = here.filter((d) => d.status === "fixed");
      const open = here.filter((d) => d.status !== "fixed");
      let state = "ok";
      if (open.length) state = "bad";
      else if (review.length) state = "review";
      else if (counts.answered < counts.total) state = "todo";
      return { name, short: SECTION_SHORT[name] || name, total: counts.total, answered: counts.answered, state, review, open };
    });
  }

  function summaryCounts(summary) {
    return (name) => (summary.sections || []).find((s) => s.name === name) || { total: 0, answered: 0 };
  }

  function lead(s) {
    if (!s.started) return "Обход ещё не начат. Станции идут в том порядке, в каком заведение обходит инспектор.";
    if (s.ready) return `Готово к проверке: соблюдено ${s.index} %, открытых нарушений нет.`;
    const label = s.index >= 70 ? "Почти готово" : "Есть что исправить";
    return `${label}: соблюдено ${s.index} %. Для готовности нужно от 90 % и ни одного открытого нарушения.`;
  }

  function legend() {
    return html`<ul class="r-legend" aria-hidden="true">
      ${["ok", "bad", "review", "todo"].map((state) => html`<li><i class="r-leg r-${state}"></i>${STATE_WORDS[state]}</li>`)}
    </ul>`;
  }

  function station(st, act, extra = "") {
    return html`<button type="button" class="r-station" data-act="${act}" data-section="${st.name}"
      aria-label="${st.name}: ${STATE_WORDS[st.state]}, пройдено ${st.answered} из ${st.total}">
      <span class="r-dot" aria-hidden="true"></span>
      <span class="r-name">${st.short}</span>
      <span class="r-meta">${st.answered} из ${st.total}</span>${extra}
    </button>`;
  }

  // ---------- Cabinet ----------

  function settingsButton() {
    return html`<button type="button" class="icon-btn" data-act="goSettings" aria-label="Настройки"><i class="ico" data-i="gear" aria-hidden="true"></i></button>`;
  }

  async function renderHome() {
    await loadScreen(
      (state) => state.name,
      async () => {
        await Checklist.load();
        const state = await api("GET", "/api/owner/state");
        App.ownerState = state;
        return state;
      },
      (state) => homeView(state),
      { back: false, action: settingsButton() }
    );
  }

  function homeView(state) {
    const s = state.summary;
    const list = stations(state.defects, summaryCounts(s));
    const stop = list.find((st) => st.answered < st.total);
    // Messages from staff are not tied to a station
    const loose = state.defects.filter((d) => !defectSection(d));

    return html`${roleTabs("home")}
      <section class="r-head">
        <h2 class="r-title">Маршрут проверки</h2>
        <p class="r-lead">${lead(s)}</p>
        ${legend()}
      </section>

      ${loose.length
        ? html`<section class="section r-loose" id="sec-mine">
            <h2>Сообщения сотрудников <span class="count">${loose.length}</span></h2>
            ${loose.map((d) => (d.status === "fixed" ? reviewBranch(d) : ownBranch(d)))}
          </section>`
        : ""}

      <ol class="r-route">
        ${list.map(
          (st) => html`<li class="r-stop r-${st.state}${st === stop ? " r-here" : ""}">
            ${station(st, "rSection")}
            ${st.review.map((d) => reviewBranch(d))}
            ${st.open.filter((d) => d.to_owner).map((d) => ownBranch(d))}
            ${st.open.filter((d) => !d.to_owner).map((d) => teamBranch(d))}
            ${st === stop
              ? html`<div class="r-branch r-continue">
                  <p>${s.started ? `Здесь обход остановился: пройдено ${st.answered} из ${st.total}.` : "Обход начинается здесь."}</p>
                  <button type="button" class="btn btn-primary" data-act="rSection" data-section="${st.name}">${s.started ? "Продолжить обход" : "Начать обход"}</button>
                </div>`
              : ""}
          </li>`
        )}
      </ol>
      ${stop ? "" : html`<button type="button" class="btn btn-primary" data-act="goAuditSummary">Итоги аудита</button>`}

      ${shiftNowSection(state)}

      <section class="section">
        <h2>Документы и команда</h2>
        <div class="tiles">
          <button type="button" class="tile" data-act="goInvite"><span class="tile-icon"><i class="ico" data-i="users" aria-hidden="true"></i></span>Команда и приглашения</button>
          <button type="button" class="tile" data-act="downloadAct"><span class="tile-icon"><i class="ico" data-i="file" aria-hidden="true"></i></span>Акт аудита (PDF)</button>
        </div>
      </section>
      ${chatButton()}`;
  }

  // A fix waiting for the owner, hanging off the station where the violation was found
  function reviewBranch(d) {
    return html`<article class="r-branch r-branch-review" id="defect-${d.id}">
      <p class="r-kind">Исправлено, проверьте</p>
      <h3>${d.title}</h3>
      ${photoPair(d.before_photos, "Было", d.after_photos, "Стало")}
      <p class="r-by">Исполнитель: ${d.fixed_by || d.assigned_position || "не указан"}${d.fixed_at ? `, ${d.fixed_at}` : ""}</p>
      <div class="row-buttons">
        <button type="button" class="btn btn-primary" data-act="acceptFix" data-id="${d.id}">Принять</button>
        <button type="button" class="btn btn-secondary" data-act="returnFix" data-id="${d.id}">Вернуть</button>
      </div>
    </article>`;
  }

  function ownBranch(d) {
    const isProblem = d.kind === "problem";
    return html`<article class="r-branch r-branch-bad" id="defect-${d.id}">
      <p class="r-kind">${isProblem ? "Сообщение от сотрудника" : "Ваша задача"}${d.status === "returned" ? ", возвращено" : ""}</p>
      <h3>${d.title}</h3>
      ${isProblem && d.comment && d.comment !== d.title ? html`<p>${d.comment}</p>` : ""}
      ${d.remediation ? html`<p class="r-todo-text">${d.remediation}</p>` : ""}
      ${d.before_photos.length || d.reference_photo ? photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть") : ""}
      ${isProblem
        ? html`<div class="row-buttons">
            <button type="button" class="btn btn-secondary" data-act="resolveWithPhoto" data-id="${d.id}">${photoLabel("результат")}</button>
            <button type="button" class="btn btn-secondary" data-act="resolveOwnerTask" data-id="${d.id}">Решено</button>
          </div>`
        : html`<button type="button" class="btn btn-secondary" data-act="resolveWithPhoto" data-id="${d.id}">${photoLabel("результат")}</button>`}
    </article>`;
  }

  function teamBranch(d) {
    return html`<button type="button" class="r-branch r-branch-team" data-act="teamDefect" data-id="${d.id}">
      <span class="r-kind">${d.assigned_position}: ${DEFECT_STATUS[d.status].toLowerCase()}</span>
      <span class="r-branch-title">${d.title}</span>
      ${d.return_reason ? html`<span class="r-by">Вернули: ${d.return_reason.toLowerCase()}</span>` : ""}
    </button>`;
  }

  // ---------- Audit: walking down the line ----------

  function questionState(id, defects) {
    const defect = defects.find((d) => d.item_id === id);
    if (defect) return defect.status === "fixed" ? "review" : "bad";
    const answer = Audit.answers[String(id)];
    if (!answer) return "todo";
    return { compliant: "ok", violation: "bad", na: "na" }[answer.status] || "todo";
  }

  const ANSWERS = [
    ["compliant", "ok", "answerOk", "Соблюдается"],
    ["violation", "bad", "answerViolation", "Нарушение"],
    ["na", "na", "answerNa", "Не применимо"],
  ];

  function renderAuditItem(id) {
    const item = Checklist.byId[id];
    const answer = Audit.answers[String(id)];
    const status = answer ? answer.status : "";
    const defects = App.ownerState.defects || [];
    const list = stations(defects, (name) => Audit.sectionStats(name));
    const ids = Audit.order.filter((x) => Checklist.byId[x].section === item.section);
    const answeredAll = Object.keys(Audit.answers).length;
    const prev = Audit.prev(id);
    const next = Audit.next(id);

    const current = html`<li class="r-q r-q-current r-q-${questionState(id, defects)}">
      <article class="card question-card r-card">
        <p class="r-qhead">${SECTION_SHORT[item.section] || item.section}, вопрос ${ids.indexOf(id) + 1} из ${ids.length}</p>
        <h2 class="question">${item.question}</h2>
        ${item.norm ? html`<p>${item.norm}</p>` : ""}
        ${item.applies_to ? html`<p class="muted small">Применимо, если: ${item.applies_to.toLowerCase()}.</p>` : ""}
        ${examplePhotos(item)}
        ${basisBlock(item, "basis-" + id)}
        ${auditAnswerNote(id)}
      </article>
      <div class="answer-bar r-answers" role="group" aria-label="Ответ">
        ${ANSWERS.map(
          ([value, tone, act, label]) => html`<button type="button" class="answer r-answer r-answer-${tone} ${value === status ? "active" : ""}" data-act="${act}" data-id="${id}">
            <span class="r-adot" aria-hidden="true"></span>${label}
          </button>`
        )}
      </div>
      <p class="answer-hint muted small">${auditHint()}</p>
      <div class="row-between audit-nav">
        ${prev ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${prev}">‹ Предыдущий</button>` : html`<span></span>`}
        ${next ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${next}">Пропустить ›</button>` : html`<button type="button" class="btn-link" data-act="auditDone">К итогам ›</button>`}
      </div>
    </li>`;

    mount(
      "#app",
      html`<header class="topbar">
          <button type="button" class="topbar-back" data-act="auditExit" aria-label="Выйти из аудита">‹</button>
          <h1>Аудит</h1>
          <span class="saved" id="savedMark" hidden>Сохранено ✓</span>
          <button type="button" class="topbar-action" data-act="auditSections">Разделы</button>
        </header>
        <main class="screen audit-screen r-audit">
          <p class="r-audit-sum">Пройдено ${answeredAll} из ${Audit.order.length}. Нажмите на станцию или вопрос, чтобы перейти к нему.</p>
          <ol class="r-route r-route-audit">
            ${list.map((st) =>
              st.name === item.section
                ? html`<li class="r-stop r-${st.state} r-open">
                    ${station(st, "rJump")}
                    <ol class="r-questions">
                      ${ids.map((qid) =>
                        qid === id
                          ? current
                          : html`<li class="r-q r-q-${questionState(qid, defects)}">
                              <button type="button" class="r-qrow" data-act="auditGo" data-id="${qid}">
                                <span class="r-qdot" aria-hidden="true"></span><span class="r-qtext">${Checklist.byId[qid].question}</span>
                              </button>
                            </li>`
                      )}
                    </ol>
                  </li>`
                : html`<li class="r-stop r-${st.state}">${station(st, "rJump")}</li>`
            )}
          </ol>
        </main>`
    );
    Router.current.params.itemId = id;
    // After the render the router scrolls to the top: bring the current question up instead,
    // with the question before it still in view
    requestAnimationFrame(() => {
      const card = document.querySelector(".r-q-current");
      if (!card) return;
      const before = card.previousElementSibling || card.closest(".r-stop").querySelector(".r-station");
      const top = (before || card).getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 60));
    });
  }

  function jumpToSection(el) {
    const id = Audit.firstInSection(el.dataset.section);
    if (id) renderAuditItem(id);
  }

  // Audit results: the whole line in one strip
  function readinessRing(summary) {
    const defects = (App.ownerState && App.ownerState.defects) || [];
    const list = stations(defects, summaryCounts(summary));
    return html`<div class="r-strip" aria-hidden="true">
        ${list.map((st) => html`<span class="r-strip-stop r-${st.state}"><i></i><span>${st.short}</span></span>`)}
      </div>
      <p class="r-lead">${lead(summary)}</p>`;
  }

  // ---------- Shift: the cook's zones as a line, every duty a stop ----------

  let shiftData = null;
  const expanded = new Map();

  function zoneRank(zone) {
    const i = ZONE_ORDER.indexOf(zone);
    return i === -1 ? ZONE_ORDER.length : i;
  }

  function shiftView(data) {
    if (data !== shiftData) {
      shiftData = data;
      expanded.clear();
    }
    const shift = data.shift;
    const isOwner = data.employee.is_owner;
    const zones = [...new Set([...data.defects.map((d) => d.zone), ...data.duties.map((d) => d.zone)])].sort((a, b) => zoneRank(a) - zoneRank(b));
    const done = data.duties.filter((d) => d.done).length;

    return html`${roleTabs("shift")}
      <section class="r-head r-shift-head">
        <h2 class="r-title">${data.employee.full_name}</h2>
        <p class="r-lead">${isOwner ? "Все задачи смены" : data.employee.position}${shift ? `, смена с ${shift.started}${shift.checkin === "qr" ? " по QR" : ""}` : ""}</p>
        ${isOwner ? html`<button type="button" class="btn-link small" data-act="ownerRoleMenu">Выйти из роли сотрудника</button>` : ""}
        ${shift ? "" : html`<p class="r-lead">Смена ещё не начата.</p>${shiftStart(data)}`}
        ${data.duties.length ? html`<p class="r-shift-count">Выполнено <strong>${done} из ${data.duties.length}</strong></p>` : ""}
      </section>

      ${zones.length
        ? html`<ol class="r-route r-route-shift">${zones.map((zone) => zoneStop(zone, data))}</ol>`
        : html`<p class="muted">${isOwner ? "Задач смены пока нет. Их можно добавить в настройках." : "На вашу должность задач нет. Руководитель может добавить их в настройках."}</p>`}

      ${shiftFooter(shift)}`;
  }

  function zoneState(zone, data) {
    const left = data.duties.filter((d) => d.zone === zone && !d.done).length;
    if (data.defects.some((d) => d.zone === zone && d.status !== "fixed")) return "bad";
    if (data.defects.some((d) => d.zone === zone && d.status === "fixed")) return "review";
    return left ? "todo" : "ok";
  }

  function zoneStop(zone, data) {
    const duties = data.duties.filter((d) => d.zone === zone);
    const urgent = data.defects.filter((d) => d.zone === zone && d.status !== "fixed");
    const review = data.defects.filter((d) => d.zone === zone && d.status === "fixed");
    const left = duties.filter((d) => !d.done).length;
    const open = expanded.has(zone) ? expanded.get(zone) : left > 0;
    return html`<li class="r-stop r-${zoneState(zone, data)}" data-zone="${zone}">
      <button type="button" class="r-station" data-act="rZone" data-zone="${zone}" aria-expanded="${open ? "true" : "false"}">
        <span class="r-dot" aria-hidden="true"></span>
        <span class="r-name">${zone}</span>
        <span class="r-meta">${duties.length ? `${duties.length - left} из ${duties.length}` : ""}</span>
      </button>
      ${urgent.map((d) => urgentBranch(d))}
      ${review.map(
        (d) => html`<article class="r-branch r-branch-review defect-card" id="defect-${d.id}">
          <p class="r-kind">Ждёт проверки руководителя</p>
          <h3>${d.title}</h3>
          ${photoPair(d.before_photos, "Было", d.after_photos, "Стало")}
        </article>`
      )}
      ${open && duties.length
        ? html`<ul class="task-list r-tasks">
            ${duties.map(
              (d) => html`<li class="task r-task ${d.done ? "done" : ""}">
                <button type="button" class="task-check r-check" data-act="toggleTask" data-id="${d.id}" data-done="${d.done ? "1" : ""}" ${raw(data.shift ? "" : "disabled")}
                  aria-label="${d.done ? "Снять отметку" : "Отметить выполненной"}">${taskMark(d.done)}</button>
                <button type="button" class="r-task-text" data-act="taskMenu" data-id="${d.id}">${d.question}${d.photos.length
                  ? html` <span class="muted small"><i class="ico" data-i="camera" aria-hidden="true"></i> ${d.photos.length}</span>`
                  : ""}${data.employee.is_owner && d.position ? html`<span class="muted small block">${d.position}</span>` : ""}</button>
              </li>`
            )}
          </ul>`
        : ""}
    </li>`;
  }

  function urgentBranch(d) {
    return html`<article class="r-branch r-branch-bad defect-card urgent" id="defect-${d.id}">
      <p class="r-kind">${d.status === "returned" ? `Вернули: ${d.return_reason.toLowerCase()}` : "Нарушение, исправьте"}</p>
      <h3>${d.title}</h3>
      ${photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть")}
      ${!d.reference_photo && d.photo_hint ? html`<p class="small"><strong>Как должно быть:</strong> ${d.photo_hint}</p>` : ""}
      ${d.remediation ? html`<p class="r-todo-text">${d.remediation}</p>` : ""}
      ${basisBlock(Checklist.byId[d.item_id], "dbasis-" + d.id)}
      <button type="button" class="btn btn-primary" data-act="fixDefect" data-id="${d.id}">${photoLabel("исправление")}</button>
    </article>`;
  }

  function toggleZone(el) {
    expanded.set(el.dataset.zone, el.getAttribute("aria-expanded") !== "true");
    mount("#app", screen("Моя смена", shiftView(Staff.shift), { back: Router.stack.length > 1 }));
  }

  // A ticked duty repaints its station in place, without redrawing the line under the finger
  function updateTaskCounters() {
    const data = Staff.shift;
    document.querySelectorAll(".r-route-shift .r-stop[data-zone]").forEach((stop) => {
      const duties = data.duties.filter((d) => d.zone === stop.dataset.zone);
      const left = duties.filter((d) => !d.done).length;
      const meta = stop.querySelector(".r-meta");
      if (meta && duties.length) meta.textContent = `${duties.length - left} из ${duties.length}`;
      stop.classList.remove("r-ok", "r-todo", "r-bad", "r-review");
      stop.classList.add(`r-${zoneState(stop.dataset.zone, data)}`);
    });
    const count = document.querySelector(".r-shift-count strong");
    if (count) count.textContent = `${data.duties.filter((d) => d.done).length} из ${data.duties.length}`;
  }

  Design.register("route", "Маршрут", {
    globals: { renderAuditItem, shiftView, updateTaskCounters, readinessRing },
    actions: {
      rSection: (el) => Router.go("audit", { section: el.dataset.section }, { base: "home" }),
      rJump: jumpToSection,
      rZone: toggleZone,
    },
    screens: { home: { render: renderHome } },
  });
})();

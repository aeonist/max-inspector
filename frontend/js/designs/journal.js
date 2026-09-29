// Design «Журнал»: the app as the paper forms the inspector checks.
// Readiness is the filled-in checklist form on squared paper, a square per question, with the totals
// and the conclusion typeset under it. The audit ticks the form's own «Да / Нет / Неприменимо» columns,
// staff mark the shift journal with the time of each duty, and a fix comes to the owner as an act to accept.

(function () {
  const CELL_WORDS = {
    compliant: "да",
    violation: "нет, нарушение",
    review: "исправлено, ждёт проверки",
    na: "неприменимо",
    empty: "не отмечено",
  };

  // One question on the form: answered, crossed out, or circled while its fix waits for the owner
  function cellState(id, answers, open, review) {
    if (review.has(id)) return "review";
    if (open.has(id)) return "violation";
    const answer = answers[String(id)];
    return answer ? answer.status : "empty";
  }

  function defectSets(defects) {
    return {
      review: new Set(defects.filter((d) => d.status === "fixed").map((d) => d.item_id)),
      open: new Set(defects.filter((d) => d.status !== "fixed" && d.item_id).map((d) => d.item_id)),
    };
  }

  function cells(section, answers, sets, { act = "", current = null }) {
    const items = Checklist.items.filter((item) => item.section === section);
    const name = SECTION_SHORT[section] || section;
    return items.map((item, i) => {
      const state = cellState(item.id, answers, sets.open, sets.review);
      const label = `${name}, вопрос ${i + 1}: ${CELL_WORDS[state]}`;
      return act
        ? html`<button type="button" class="j-cell${item.id === current ? " current" : ""}" data-s="${state}" data-act="${act}" data-id="${item.id}" aria-label="${label}"></button>`
        : html`<i class="j-cell" data-s="${state}"></i>`;
    });
  }

  // The checklist form: a row of squares per section, in the order of the walk through the premises
  function formGrid(answers, defects, { act, current = null, sections = SECTION_ORDER, labels = true }) {
    const sets = defectSets(defects);
    return html`<div class="j-grid${labels ? "" : " j-grid-bare"}">
      ${sections.map(
        (section) => html`<div class="j-grid-row">
          ${labels ? html`<span class="j-grid-label">${SECTION_SHORT[section] || section}</span>` : ""}
          <span class="j-cells">${cells(section, answers, sets, { act, current })}</span>
        </div>`
      )}
    </div>`;
  }

  function legend() {
    return html`<ul class="j-legend" aria-hidden="true">
      ${["compliant", "violation", "review", "na", "empty"].map(
        (state) => html`<li><i class="j-cell" data-s="${state}"></i>${CELL_WORDS[state]}</li>`
      )}
    </ul>`;
  }

  // What is missing before an inspection, in the words of the rule: 90 % and no open violations
  function missing(s) {
    const parts = [];
    if (s.unresolved) parts.push(`устранить ${s.unresolved} ${plural(s.unresolved, "нарушение", "нарушения", "нарушений")}`);
    if (s.index < 90) parts.push("довести соблюдение до 90\u00a0%");
    return parts.join(" и ");
  }

  // The totals under the form, set like the last lines of a printed act
  function verdict(s) {
    let conclusion = "Аудит не начат";
    let tone = "";
    let note = "Отметьте вопросы проверочного листа по разделам, начиная с документов.";
    if (s.started && s.ready) {
      conclusion = "Готово к проверке";
      tone = "ok";
      note = "Соблюдено от 90\u00a0% требований, открытых нарушений нет.";
    } else if (s.started) {
      conclusion = "Не готово к проверке";
      tone = "bad";
      note = `Осталось ${missing(s)}.`;
    }
    return html`<div class="j-verdict">
      <dl class="j-totals">
        <div><dt>Соблюдено требований</dt><dd>${s.index}\u00a0%</dd></div>
        <div><dt>Нарушений не устранено</dt><dd>${s.unresolved}</dd></div>
        <div class="j-conclusion ${tone}"><dt>Заключение</dt><dd>${conclusion}</dd></div>
      </dl>
      <p class="j-pencil">${note}</p>
    </div>`;
  }

  function settingsButton() {
    return html`<button type="button" class="icon-btn" data-act="goSettings" aria-label="Настройки"><i class="ico" data-i="gear" aria-hidden="true"></i></button>`;
  }

  // ---------- Cabinet ----------

  async function renderHome() {
    await loadScreen(
      ({ state }) => state.name,
      async () => {
        await Checklist.load();
        const [state, audit] = await Promise.all([api("GET", "/api/owner/state"), api("GET", "/api/owner/audit")]);
        App.ownerState = state;
        return { state, answers: audit.answers };
      },
      ({ state, answers }) => homeView(state, answers),
      { back: false, action: settingsButton() }
    );
  }

  function homeView(state, answers) {
    const s = state.summary;
    const review = state.defects.filter((d) => d.status === "fixed");
    const mine = state.defects.filter((d) => d.to_owner && d.status !== "fixed");
    const team = state.defects.filter((d) => !d.to_owner && d.status !== "fixed");
    const left = s.total - s.answered;
    let auditButton = "Начать аудит";
    if (s.started && left) auditButton = "Продолжить аудит";
    else if (!left) auditButton = "Итоги аудита";

    return html`${roleTabs("home")}
      <section class="j-form">
        <h2 class="j-title">Проверочный лист</h2>
        <p class="j-pencil">Отмечено ${s.answered} из ${s.total} вопросов. Клетка открывает вопрос.</p>
        ${formGrid(answers, state.defects, { act: "journalCell" })}
        ${legend()}
      </section>

      <section class="j-result">
        ${verdict(s)}
        <button type="button" class="btn btn-primary" data-act="${left ? "goAudit" : "goAuditSummary"}">${auditButton}</button>
      </section>

      ${review.length
        ? html`<section class="section" id="sec-review">
            <h2>Ждут вашей проверки <span class="count">${review.length}</span></h2>
            ${review.map((d) => actCard(d))}
          </section>`
        : ""}

      ${mine.length
        ? html`<section class="section" id="sec-mine">
            <h2>Ваши задачи <span class="count">${mine.length}</span></h2>
            ${mine.map((d) => ownTask(d))}
          </section>`
        : ""}

      ${team.length
        ? html`<section class="section" id="sec-team">
            <h2>Нарушения у команды <span class="count">${team.length}</span></h2>
            <div class="j-table">
              ${team.map(
                (d) => html`<button type="button" class="j-tr" data-act="teamDefect" data-id="${d.id}">
                  <span class="j-td-main">${d.title}</span>
                  <span class="j-td-side">${d.assigned_position}<small class="${d.status === "returned" ? "j-red" : ""}">${d.status === "returned" ? "вернули на доработку" : "ждёт исправления"}</small></span>
                </button>`
              )}
            </div>
          </section>`
        : ""}

      ${shiftNowSection(state)}

      <section class="section">
        <h2>Документы и команда</h2>
        <div class="j-table">
          <button type="button" class="j-tr j-tr-link" data-act="goInvite"><span class="j-td-main">Команда и приглашения</span></button>
          <button type="button" class="j-tr j-tr-link" data-act="downloadAct"><span class="j-td-main">Акт аудита (PDF)</span></button>
        </div>
      </section>
      ${chatButton()}`;
  }

  // "Мария Петрова, повар": who did the fix, with the position when it adds something
  function doneBy(d) {
    if (!d.fixed_by) return d.assigned_position || "не указан";
    return d.assigned_position ? `${d.fixed_by}, ${d.assigned_position.toLowerCase()}` : d.fixed_by;
  }

  // A fix to review, as an act with both photos pasted in
  function actCard(d) {
    return html`<article class="j-sheet j-act" id="defect-${d.id}">
      <p class="j-sheet-head"><span>${d.zone}</span>${d.fixed_at ? html`<span>исправлено ${d.fixed_at}</span>` : ""}</p>
      <h3>${d.title}</h3>
      ${photoPair(d.before_photos, "Было", d.after_photos, "Стало")}
      <p class="j-line"><span>Исполнитель</span>${doneBy(d)}</p>
      <div class="row-buttons">
        <button type="button" class="btn btn-primary" data-act="acceptFix" data-id="${d.id}">Принять</button>
        <button type="button" class="btn btn-secondary" data-act="returnFix" data-id="${d.id}">Вернуть</button>
      </div>
    </article>`;
  }

  function ownTask(d) {
    const isProblem = d.kind === "problem";
    return html`<article class="j-sheet" id="defect-${d.id}">
      <p class="j-sheet-head"><span>${isProblem ? "Сообщение от сотрудника" : d.zone}</span>${d.status === "returned"
        ? html`<span class="j-red">вернули на доработку</span>`
        : d.created_at ? html`<span>${d.created_at}</span>` : ""}</p>
      <h3>${d.title}</h3>
      ${isProblem && d.comment && d.comment !== d.title ? html`<p>${d.comment}</p>` : ""}
      ${d.remediation ? html`<p class="j-line"><span>Что сделать</span>${d.remediation}</p>` : ""}
      ${d.before_photos.length || d.reference_photo ? photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть") : ""}
      ${isProblem
        ? html`<div class="row-buttons">
            <button type="button" class="btn btn-secondary" data-act="resolveWithPhoto" data-id="${d.id}">${photoLabel("результат")}</button>
            <button type="button" class="btn btn-secondary" data-act="resolveOwnerTask" data-id="${d.id}">Решено</button>
          </div>`
        : html`<button type="button" class="btn btn-secondary" data-act="resolveWithPhoto" data-id="${d.id}">${photoLabel("результат")}</button>`}
    </article>`;
  }

  // A team violation as the task the staff member got
  function teamDefect(el) {
    const d = App.ownerState.defects.find((x) => x.id === Number(el.dataset.id));
    if (!d) return;
    sheet(
      html`<div class="j-order-sheet">
        <p class="j-sheet-head"><span>${d.zone}</span>${d.created_at ? html`<span>${d.created_at}</span>` : ""}</p>
        <h3>${d.title}</h3>
        <p class="j-line"><span>Исправляет</span>${d.assigned_position}</p>
        <p class="j-line"><span>Сейчас</span>${DesignCommon.defectStatus[d.status]}</p>
        ${d.return_reason ? html`<p class="j-line j-line-red"><span>Вернули</span>${d.return_reason}</p>` : ""}
        ${d.remediation ? html`<p class="j-line"><span>Что сделать</span>${d.remediation}</p>` : ""}
        ${photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть")}
        <p class="j-pencil">Когда сотрудник пришлёт фото исправления, акт появится в разделе «Ждут вашей проверки».</p>
      </div>`,
      [{ label: "Закрыть", value: null }]
    );
  }

  // Accepting a fix: the act gets its acceptance line, then the cabinet refreshes
  function acceptFix(el) {
    return busy(el, async () => {
      const res = await api("POST", `/api/owner/defects/${el.dataset.id}/accept`);
      Bridge.haptic("success");
      await markAccepted(el.closest(".j-act"));
      toast(`Исправление принято. Соблюдено требований: ${res.summary.index}\u00a0%`, { type: "success" });
      await Router.refresh();
    });
  }

  function markAccepted(card) {
    const buttons = card && card.querySelector(".row-buttons");
    if (!buttons) return Promise.resolve();
    const line = document.createElement("p");
    line.className = "j-line j-accepted";
    mount(line, html`<span>Принято</span>вами сегодня в ${DesignCommon.nowTime()}`);
    buttons.replaceWith(line);
    const quick = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return new Promise((resolve) => setTimeout(resolve, quick ? 300 : 900));
  }

  // Sections as the rows of the same form: a tap opens the section at its first unmarked question
  function auditSections() {
    const current = Router.current.params.itemId;
    const currentSection = current && Checklist.byId[current] ? Checklist.byId[current].section : "";
    const sets = defectSets(App.ownerState.defects || []);
    sheet(
      html`<h3>Разделы проверочного листа</h3>
        <p class="j-pencil">Разделы идут в порядке обхода заведения. Начать можно с любого.</p>
        <div class="j-grid j-grid-pick">
          ${SECTION_ORDER.map((section) => {
            const st = Audit.sectionStats(section);
            return html`<button type="button" class="j-grid-row${section === currentSection ? " current" : ""}" data-act="openSection" data-section="${section}">
              <span class="j-grid-label">${SECTION_SHORT[section] || section}</span>
              <span class="j-cells">${cells(section, Audit.answers, sets, {})}</span>
              <span class="j-grid-count">${st.answered} из ${st.total}</span>
            </button>`;
          })}
        </div>`,
      [{ label: "Закрыть", value: null }]
    );
  }

  // ---------- Audit ----------

  const ANSWERS = [
    ["compliant", "answerOk", "Да", "соблюдается"],
    ["violation", "answerViolation", "Нет", "нарушение"],
    ["na", "answerNa", "Неприменимо", ""],
  ];

  function renderAuditItem(id) {
    const item = Checklist.byId[id];
    const answer = Audit.answers[String(id)];
    const status = answer ? answer.status : "";
    const total = Audit.order.length;
    const answeredAll = Object.keys(Audit.answers).length;
    const inSection = Checklist.items.filter((i) => i.section === item.section);
    const official = (item.checklist_ref || "").match(/вопр\.\s*(\d+)/);
    const prev = Audit.prev(id);
    const next = Audit.next(id);

    mount(
      "#app",
      html`<header class="topbar">
          <button type="button" class="topbar-back" data-act="auditExit" aria-label="Выйти из аудита">‹</button>
          <h1>Аудит</h1>
          <span class="saved" id="savedMark" hidden>Сохранено</span>
          <button type="button" class="topbar-action" data-act="auditSections">Разделы</button>
        </header>
        <main class="screen audit-screen j-audit">
          <section class="j-audit-head">
            <h2 class="j-title">${item.section}</h2>
            ${formGrid(Audit.answers, App.ownerState.defects || [], { act: "auditGo", current: id, sections: [item.section], labels: false })}
            <p class="j-pencil">Вопрос ${inSection.indexOf(item) + 1} из ${inSection.length} в разделе. Всего отмечено ${answeredAll} из ${total}.</p>
          </section>

          <article class="j-sheet j-question question-card">
            ${official ? html`<p class="j-sheet-head"><span>Вопрос ${official[1]} проверочного листа</span></p>` : ""}
            <h2 class="question">${item.question}</h2>
            ${item.norm ? html`<p class="j-norm">${item.norm}</p>` : ""}
            ${item.applies_to ? html`<p class="j-pencil">Применимо, если: ${item.applies_to.toLowerCase()}.</p>` : ""}
            ${examplePhotos(item)}
            ${basisBlock(item, "basis-" + id)}
            ${auditAnswerNote(id)}
          </article>

          <div class="answer-bar j-answers" role="group" aria-label="Ответ">
            ${ANSWERS.map(
              ([value, act, label, note]) => html`<button type="button" class="answer j-answer ${value === status ? "active" : ""}" data-s="${value}" data-act="${act}" data-id="${id}">
                <span class="j-answer-label">${label}${note ? html`<small>${note}</small>` : ""}</span>
                <span class="j-answer-box" aria-hidden="true"></span>
              </button>`
            )}
          </div>
          <p class="answer-hint j-pencil">${compliantPhotoRequired()
            ? "К «Да» и к «Нет» нужно фото: так настроено в правилах работы. Фото к «Да» станет образцом для сотрудников."
            : "К «Нет» нужно фото нарушения. К «Да» фото по желанию: оно станет образцом для сотрудников."}</p>
          <div class="row-between audit-nav">
            ${prev ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${prev}">Предыдущий</button>` : html`<span></span>`}
            ${next
              ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${next}">Пропустить</button>`
              : html`<button type="button" class="btn-link" data-act="auditDone">К итогам</button>`}
          </div>
        </main>`
    );
    Router.current.params.itemId = id;
  }

  // ---------- Shift journal ----------

  function today() {
    const text = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Moscow" });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // The mark column of the journal: an empty box, or a tick with the time the duty was done
  function taskMark(done, time) {
    if (!done) return html`<span class="j-box" aria-hidden="true"></span>`;
    return html`<span class="j-tick" aria-hidden="true"></span><span class="j-time">${time || DesignCommon.nowTime()}</span>`;
  }

  function zoneRank(zone) {
    const i = ZONE_ORDER.indexOf(zone);
    return i === -1 ? ZONE_ORDER.length : i;
  }

  function shiftView(data) {
    const shift = data.shift;
    const urgent = data.defects.filter((d) => d.status !== "fixed");
    const onReview = data.defects.filter((d) => d.status === "fixed");
    const isOwner = data.employee.is_owner;
    const zoneNames = [...new Set(data.duties.map((d) => d.zone))].sort((a, b) => zoneRank(a) - zoneRank(b));
    if (!zoneNames.includes(Staff.zone)) Staff.zone = "all";
    const visible = zoneNames.filter((z) => Staff.zone === "all" || z === Staff.zone);
    const done = data.duties.filter((d) => d.done).length;
    const zoneCount = (zone) => {
      const list = data.duties.filter((d) => zone === "all" || d.zone === zone);
      return `${list.filter((d) => d.done).length} из ${list.length}`;
    };
    let row = 0;

    return html`${roleTabs("shift")}
      <section class="j-shift-head">
        <h2 class="j-title">Журнал смены</h2>
        <p class="j-date">${today()}</p>
        <p class="j-line"><span>Сотрудник</span>${data.employee.full_name}, ${isOwner ? "все задачи смены" : data.employee.position.toLowerCase()}</p>
        ${shift
          ? html`<p class="j-line"><span>Смена</span>открыта в ${shift.started}${shift.checkin === "qr" ? " по QR-коду на месте" : ""}</p>`
          : html`<p class="j-line"><span>Смена</span>ещё не открыта</p>${shiftStart(data)}`}
        ${isOwner ? html`<button type="button" class="btn-link small" data-act="ownerRoleMenu">Выйти из роли сотрудника</button>` : ""}
      </section>

      ${urgent.length
        ? html`<section class="section j-orders">
            <h2>Нужно исправить <span class="count">${urgent.length}</span></h2>
            ${urgent.map((d) => orderCard(d))}
          </section>`
        : ""}

      ${onReview.length
        ? html`<section class="section">
            <h2>Ждёт проверки руководителя <span class="count">${onReview.length}</span></h2>
            ${onReview.map(
              (d) => html`<article class="j-sheet defect-card" id="defect-${d.id}">
                <p class="j-sheet-head"><span>${d.zone}</span>${d.fixed_at ? html`<span>отправлено ${d.fixed_at}</span>` : ""}</p>
                <h3>${d.title}</h3>
                ${photoPair(d.before_photos, "Было", d.after_photos, "Стало")}
                <p class="j-pencil">Руководитель сравнит фото и примет исправление или вернёт его с причиной.</p>
              </article>`
            )}
          </section>`
        : ""}

      <section class="section j-log">
        <h2>Задачи смены <span class="count">${done} из ${data.duties.length}</span></h2>
        ${data.duties.length
          ? html`${shift ? "" : html`<p class="j-pencil">Отмечать задачи можно после начала смены.</p>`}
            ${zoneNames.length > 1
              ? html`<div class="chips chips-small zone-filter">
                  <button type="button" class="chip ${Staff.zone === "all" ? "selected" : ""}" data-act="filterZone" data-zone="all">Все <span class="j-chip-n">${zoneCount("all")}</span></button>
                  ${zoneNames.map(
                    (z) => html`<button type="button" class="chip ${Staff.zone === z ? "selected" : ""}" data-act="filterZone" data-zone="${z}">${z} <span class="j-chip-n">${zoneCount(z)}</span></button>`
                  )}
                </div>`
              : ""}
            <ol class="task-list j-rows">
              <li class="j-rows-head" aria-hidden="true"><span>№</span><span>Задача</span><span>Отметка</span></li>
              ${visible.map(
                (zone) => html`<li class="j-rows-zone">${zone}</li>
                  ${data.duties
                    .filter((d) => d.zone === zone)
                    .map((d) => {
                      row += 1;
                      return html`<li class="task j-row ${d.done ? "done" : ""}">
                        <span class="j-row-n">${row}</span>
                        <button type="button" class="j-row-text" data-act="taskMenu" data-id="${d.id}">${d.question}${d.photos.length
                          ? html`<span class="j-pencil block"><i class="ico" data-i="camera" aria-hidden="true"></i> Фото: ${d.photos.length}</span>`
                          : ""}${isOwner && d.position ? html`<span class="j-pencil block">${d.position}</span>` : ""}</button>
                        <button type="button" class="task-check j-mark" data-act="toggleTask" data-id="${d.id}" data-done="${d.done ? "1" : ""}" ${raw(shift ? "" : "disabled")}
                          aria-label="${d.done ? "Снять отметку" : "Отметить выполненной"}">${taskMark(d.done, d.done_at)}</button>
                      </li>`;
                    })}`
              )}
            </ol>`
          : html`<p class="j-pencil">${isOwner ? "Задач смены пока нет. Их можно добавить в настройках." : "На вашу должность задач нет. Руководитель может добавить их в настройках."}</p>`}
      </section>

      ${shiftFooter(shift)}`;
  }

  // An open violation for the shift, ruled in red
  function orderCard(d) {
    return html`<article class="j-sheet j-order defect-card urgent" id="defect-${d.id}">
      <p class="j-sheet-head"><span>${d.zone}</span>${d.created_at ? html`<span>${d.created_at}</span>` : ""}</p>
      ${d.status === "returned" ? html`<p class="j-line j-line-red"><span>Вернули</span>${d.return_reason}</p>` : ""}
      <h3>${d.title}</h3>
      ${photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть")}
      ${!d.reference_photo && d.photo_hint ? html`<p class="j-line"><span>Как должно быть</span>${d.photo_hint}</p>` : ""}
      ${d.remediation ? html`<p class="j-line"><span>Что сделать</span>${d.remediation}</p>` : ""}
      ${basisBlock(Checklist.byId[d.item_id], "dbasis-" + d.id)}
      <button type="button" class="btn btn-primary" data-act="fixDefect" data-id="${d.id}">${photoLabel("исправление")}</button>
    </article>`;
  }

  // After a tick is saved: remember its time for the next redraw, and recount
  function updateTaskCounters() {
    const duties = Staff.shift.duties;
    duties.forEach((d) => {
      if (d.done && !d.done_at) d.done_at = DesignCommon.nowTime();
      if (!d.done) d.done_at = null;
    });
    const count = document.querySelector(".j-log .count");
    if (count) count.textContent = `${duties.filter((d) => d.done).length} из ${duties.length}`;
  }

  // Audit results: the same totals as in the cabinet
  function readinessRing(summary) {
    return verdict(summary);
  }

  Design.register("journal", "Журнал", {
    globals: { ...DesignCommon.globals, renderAuditItem, shiftView, taskMark, updateTaskCounters, readinessRing },
    actions: {
      ...DesignCommon.actions,
      teamDefect,
      acceptFix,
      auditSections,
      journalCell: (el) => Router.go("audit", { itemId: Number(el.dataset.id) }, { base: "home" }),
    },
    screens: { home: { render: renderHome } },
  });
})();

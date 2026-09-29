// Design «Журнал»: the app as the paper forms the inspector checks.
// Readiness is the filled-in checklist form on squared paper, a square per question.
// The audit ticks the form's own «Да / Нет / Неприменимо» columns, staff sign the shift journal,
// and a fix comes to the owner as an act to sign.

(function () {
  const CELL_WORDS = {
    compliant: "да",
    violation: "нет, нарушение",
    review: "исправлено, ждёт подписи",
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

  // The checklist form: a row of squares per section, in the order of the walk through the premises
  function formGrid(answers, defects, { act, current = null, sections = SECTION_ORDER, labels = true }) {
    const review = new Set(defects.filter((d) => d.status === "fixed").map((d) => d.item_id));
    const open = new Set(defects.filter((d) => d.status !== "fixed" && d.item_id).map((d) => d.item_id));
    return html`<div class="j-grid${labels ? "" : " j-grid-bare"}">
      ${sections.map((section) => {
        const items = Checklist.items.filter((item) => item.section === section);
        const name = SECTION_SHORT[section] || section;
        return html`<div class="j-grid-row">
          ${labels ? html`<span class="j-grid-label">${name}</span>` : ""}
          <span class="j-cells">
            ${items.map((item, i) => {
              const state = cellState(item.id, answers, open, review);
              return html`<button type="button" class="j-cell${item.id === current ? " current" : ""}" data-s="${state}" data-act="${act}" data-id="${item.id}"
                aria-label="${name}, вопрос ${i + 1}: ${CELL_WORDS[state] || state}"></button>`;
            })}
          </span>
        </div>`;
      })}
    </div>`;
  }

  function legend() {
    return html`<ul class="j-legend" aria-hidden="true">
      ${["compliant", "violation", "review", "na", "empty"].map(
        (state) => html`<li><i class="j-cell" data-s="${state}"></i>${CELL_WORDS[state]}</li>`
      )}
    </ul>`;
  }

  // The verdict as a rubber stamp, with the numbers written into the form's blanks
  function verdict(s) {
    let tone = "pencil";
    let label = "Аудит не начат";
    if (s.started) {
      if (s.ready) {
        tone = "violet";
        label = "Готово к проверке";
      } else if (s.index >= 70) {
        tone = "violet";
        label = "Почти готово";
      } else {
        tone = "red";
        label = "Есть что исправить";
      }
    }
    return html`<div class="j-verdict">
      <p class="j-blank"><span>Соблюдено требований</span><span class="j-hand">${s.index} %</span></p>
      <p class="j-blank"><span>Нарушений не устранено</span><span class="j-hand">${s.unresolved}</span></p>
      <span class="j-stamp j-stamp-${tone}">${label}</span>
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
        <p class="j-pencil">Отмечено ${s.answered} из ${s.total}. Нажмите на клетку, чтобы открыть вопрос.</p>
        ${formGrid(answers, state.defects, { act: "journalCell" })}
        ${legend()}
      </section>

      <section class="j-result">
        ${verdict(s)}
        <p class="j-pencil">Готово к проверке, когда соблюдено от 90 % требований и нет открытых нарушений.</p>
        <button type="button" class="btn btn-primary" data-act="${left ? "goAudit" : "goAuditSummary"}">${auditButton}</button>
      </section>

      ${review.length
        ? html`<section class="section" id="sec-review">
            <h2>Ждут вашей подписи <span class="count">${review.length}</span></h2>
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
                  <span class="j-td-side">${d.assigned_position}<small>${DEFECT_STATUS[d.status]}${d.return_reason ? html`: ${d.return_reason.toLowerCase()}` : ""}</small></span>
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

  // A fix to review, as an act with both photos pasted in
  function actCard(d) {
    return html`<article class="j-sheet j-act" id="defect-${d.id}">
      <p class="j-sheet-head"><span>Акт устранения № ${d.id}</span><span>${d.fixed_at || ""}</span></p>
      <h3>${d.title}</h3>
      ${photoPair(d.before_photos, "Было", d.after_photos, "Стало")}
      <p class="j-line"><span>Исполнитель</span>${d.fixed_by || d.assigned_position || "не указан"}${d.fixed_by && d.assigned_position ? `, ${d.assigned_position.toLowerCase()}` : ""}</p>
      <div class="row-buttons">
        <button type="button" class="btn btn-primary" data-act="acceptFix" data-id="${d.id}">Принять</button>
        <button type="button" class="btn btn-secondary" data-act="returnFix" data-id="${d.id}">Вернуть</button>
      </div>
    </article>`;
  }

  function ownTask(d) {
    const isProblem = d.kind === "problem";
    return html`<article class="j-sheet" id="defect-${d.id}">
      <p class="j-sheet-head"><span>${isProblem ? "Сообщение от сотрудника" : d.zone}</span><span>${d.status === "returned" ? "возвращено" : d.created_at || ""}</span></p>
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

  // A team violation as the order the staff member got
  function teamDefect(el) {
    const d = App.ownerState.defects.find((x) => x.id === Number(el.dataset.id));
    if (!d) return;
    sheet(
      html`<div class="j-order-sheet">
        <p class="j-sheet-head"><span>Предписание № ${d.id}</span><span>${d.created_at || ""}</span></p>
        <h3>${d.title}</h3>
        <p class="j-line"><span>Зона</span>${d.zone}</p>
        <p class="j-line"><span>Ответственный</span>${d.assigned_position}</p>
        <p class="j-line"><span>Состояние</span>${DEFECT_STATUS[d.status]}</p>
        ${d.return_reason ? html`<p class="j-line j-line-red"><span>Вернули</span>${d.return_reason}</p>` : ""}
        ${photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть")}
        ${d.remediation ? html`<p class="j-line"><span>Что сделать</span>${d.remediation}</p>` : ""}
        <p class="j-pencil">Когда пришлют фото исправления, акт появится в «Ждут вашей подписи».</p>
      </div>`,
      [{ label: "Закрыть", value: null }]
    );
  }

  // Accepting a fix stamps the act before the cabinet refreshes
  function acceptFix(el) {
    return busy(el, async () => {
      const res = await api("POST", `/api/owner/defects/${el.dataset.id}/accept`);
      Bridge.haptic("success");
      await pressStamp(el.closest(".j-act"), "Принято");
      toast(`Принято ✓ Готовность: ${res.summary.index}%`, { type: "success" });
      await Router.refresh();
    });
  }

  function pressStamp(card, text) {
    if (!card) return Promise.resolve();
    const mark = document.createElement("span");
    mark.className = "j-stamp j-stamp-violet j-stamp-press";
    mark.textContent = text;
    card.appendChild(mark);
    const quick = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return new Promise((resolve) => setTimeout(resolve, quick ? 300 : 750));
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
    const position = Audit.order.indexOf(id) + 1;
    const sectionNo = SECTION_ORDER.indexOf(item.section) + 1;
    const official = (item.checklist_ref || "").match(/вопр\.\s*(\d+)/);
    const prev = Audit.prev(id);
    const next = Audit.next(id);

    mount(
      "#app",
      html`<header class="topbar">
          <button type="button" class="topbar-back" data-act="auditExit" aria-label="Выйти из аудита">‹</button>
          <h1>Аудит</h1>
          <span class="saved" id="savedMark" hidden>Сохранено ✓</span>
          <button type="button" class="topbar-action" data-act="auditSections">Разделы</button>
        </header>
        <main class="screen audit-screen j-audit">
          <section class="j-audit-head">
            <h2 class="j-title">${item.section}</h2>
            ${formGrid(Audit.answers, App.ownerState.defects || [], { act: "auditGo", current: id, sections: [item.section], labels: false })}
            <p class="j-pencil">Раздел ${sectionNo} из ${SECTION_ORDER.length}. Всего отмечено ${answeredAll} из ${total}.</p>
          </section>

          <article class="j-sheet j-question question-card">
            <p class="j-sheet-head"><span>Вопрос ${position} из ${total}</span>${official ? html`<span>№ ${official[1]} в проверочном листе</span>` : ""}</p>
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
            ? "«Да» и «Нет» подтверждаются фото — так настроено в правилах работы. Фото к «Да» станет эталоном для сотрудников."
            : "«Нет» — это нарушение, его подтверждают фото. К «Да» фото по желанию, оно станет эталоном для сотрудников."}</p>
          <div class="row-between audit-nav">
            ${prev ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${prev}">‹ Предыдущий</button>` : html`<span></span>`}
            ${next ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${next}">Пропустить ›</button>` : html`<button type="button" class="btn-link" data-act="auditDone">К итогам ›</button>`}
          </div>
        </main>`
    );
    Router.current.params.itemId = id;
  }

  // ---------- Shift journal ----------

  function today() {
    const text = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // "Мария Петрова" signs as "М. Петрова"
  function signature(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] || "";
    return `${parts[0].charAt(0)}. ${parts[parts.length - 1]}`;
  }

  function taskMark(done) {
    if (!done) return html`<span class="j-sign-here">подписать</span>`;
    return html`<span class="j-signature">${signature(Staff.shift && Staff.shift.employee.full_name)}</span>`;
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
      return `${list.filter((d) => d.done).length}/${list.length}`;
    };
    let row = 0;

    return html`${roleTabs("shift")}
      <section class="j-shift-head">
        <h2 class="j-title">Журнал смены</h2>
        <p class="j-date">${today()}</p>
        <p class="j-who">${data.employee.full_name}, ${isOwner ? "все задачи смены" : data.employee.position.toLowerCase()}</p>
        ${isOwner ? html`<button type="button" class="btn-link small" data-act="ownerRoleMenu">Выйти из роли сотрудника</button>` : ""}
        ${shift
          ? html`<span class="j-stamp j-stamp-violet j-stamp-small">Смена открыта ${shift.started}${shift.checkin === "qr" ? ", по QR" : ""}</span>`
          : html`<p class="j-pencil">Смена ещё не открыта.</p>${shiftStart(data)}`}
      </section>

      ${urgent.length
        ? html`<section class="section j-orders">
            <h2>Предписание <span class="count">${urgent.length}</span></h2>
            ${urgent.map((d) => orderCard(d))}
          </section>`
        : ""}

      ${onReview.length
        ? html`<section class="section">
            <h2>На подписи у руководителя <span class="count">${onReview.length}</span></h2>
            ${onReview.map(
              (d) => html`<article class="j-sheet defect-card" id="defect-${d.id}">
                <h3>${d.title}</h3>
                ${photoPair(d.before_photos, "Было", d.after_photos, "Стало")}
                <p class="j-pencil">Руководитель сравнит фото и подпишет акт.</p>
              </article>`
            )}
          </section>`
        : ""}

      <section class="section j-log">
        <h2>Задачи смены <span class="count">${done} из ${data.duties.length}</span></h2>
        ${data.duties.length
          ? html`${shift ? "" : html`<p class="j-pencil">Расписываться за задачи можно после начала смены.</p>`}
            ${zoneNames.length > 1
              ? html`<div class="chips chips-small zone-filter">
                  <button type="button" class="chip ${Staff.zone === "all" ? "selected" : ""}" data-act="filterZone" data-zone="all">Все ${zoneCount("all")}</button>
                  ${zoneNames.map(
                    (z) => html`<button type="button" class="chip ${Staff.zone === z ? "selected" : ""}" data-act="filterZone" data-zone="${z}">${z} ${zoneCount(z)}</button>`
                  )}
                </div>`
              : ""}
            <ol class="task-list j-rows">
              <li class="j-rows-head" aria-hidden="true"><span>№</span><span>Задача</span><span>Подпись</span></li>
              ${visible.map(
                (zone) => html`<li class="j-rows-zone">${zone}</li>
                  ${data.duties
                    .filter((d) => d.zone === zone)
                    .map((d) => {
                      row += 1;
                      return html`<li class="task j-row ${d.done ? "done" : ""}">
                        <span class="j-row-n">${row}</span>
                        <button type="button" class="j-row-text" data-act="taskMenu" data-id="${d.id}">${d.question}${d.photos.length
                          ? html` <span class="j-pencil"><i class="ico" data-i="camera" aria-hidden="true"></i> ${d.photos.length}</span>`
                          : ""}${isOwner && d.position ? html`<span class="j-pencil block">${d.position}</span>` : ""}</button>
                        <button type="button" class="task-check j-sign" data-act="toggleTask" data-id="${d.id}" data-done="${d.done ? "1" : ""}" ${raw(shift ? "" : "disabled")}
                          aria-label="${d.done ? "Снять подпись" : "Расписаться за задачу"}">${taskMark(d.done)}</button>
                      </li>`;
                    })}`
              )}
            </ol>`
          : html`<p class="j-pencil">${isOwner ? "Задач смены пока нет. Их можно добавить в настройках." : "На вашу должность задач нет. Руководитель может добавить их в настройках."}</p>`}
      </section>

      ${shiftFooter(shift)}`;
  }

  // An open violation for the shift, written in red like an inspector's order
  function orderCard(d) {
    return html`<article class="j-sheet j-order defect-card urgent" id="defect-${d.id}">
      <p class="j-sheet-head"><span>${d.zone}</span><span>${d.created_at || ""}</span></p>
      ${d.status === "returned" ? html`<p class="j-line j-line-red"><span>Вернули</span>${d.return_reason}</p>` : ""}
      <h3>${d.title}</h3>
      ${photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть")}
      ${!d.reference_photo && d.photo_hint ? html`<p class="j-line"><span>Как должно быть</span>${d.photo_hint}</p>` : ""}
      ${d.remediation ? html`<p class="j-line"><span>Что сделать</span>${d.remediation}</p>` : ""}
      ${basisBlock(Checklist.byId[d.item_id], "dbasis-" + d.id)}
      <button type="button" class="btn btn-primary" data-act="fixDefect" data-id="${d.id}">${photoLabel("исправление")}</button>
    </article>`;
  }

  function updateTaskCounters() {
    const duties = Staff.shift.duties;
    const count = document.querySelector(".j-log .count");
    if (count) count.textContent = `${duties.filter((d) => d.done).length} из ${duties.length}`;
  }

  // Audit results: the same stamp and blanks as in the cabinet
  function readinessRing(summary) {
    return verdict(summary);
  }

  Design.register("journal", "Журнал", {
    globals: { renderAuditItem, shiftView, taskMark, updateTaskCounters, readinessRing },
    actions: {
      teamDefect,
      acceptFix,
      journalCell: (el) => Router.go("audit", { itemId: Number(el.dataset.id) }, { base: "home" }),
    },
    screens: { home: { render: renderHome } },
  });
})();

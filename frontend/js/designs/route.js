// Design «Маршрут»: the café as the route an inspector walks, from documents to waste.
// Readiness is one line through the ten sections: solid where the walk is done, dashed where it is not,
// and each station's mark carries what is there, a number of things to act on or how far it is walked.
// Violations hang off their station, the audit walks down the same line, and a cook's shift is the line
// of their zones with every duty as a stop.

(function () {
  function defectSection(d) {
    const item = d.item_id && Checklist.byId[d.item_id];
    return item ? item.section : null;
  }

  // Every station of the walk: how far it is walked and what needs attention there
  function stations(defects, countsOf) {
    return SECTION_ORDER.map((name) => {
      const counts = countsOf(name);
      const here = defects.filter((d) => defectSection(d) === name);
      const left = counts.total - counts.answered;
      return {
        name,
        short: SECTION_SHORT[name] || name,
        answered: counts.answered,
        left,
        walked: left === 0,
        review: here.filter((d) => d.status === "fixed"),
        open: here.filter((d) => d.status !== "fixed"),
      };
    });
  }

  function summaryCounts(summary) {
    return (name) => (summary.sections || []).find((s) => s.name === name) || { total: 0, answered: 0 };
  }

  // A station's mark on the line: how many things to act on, or how far it is walked
  function marker({ open, review, walked, started }) {
    const issues = open + review;
    if (issues) return html`<span class="r-mark ${open ? "r-mark-bad" : "r-mark-review"}" aria-hidden="true">${issues}</span>`;
    if (walked) return html`<span class="r-mark r-mark-ok" aria-hidden="true"></span>`;
    return html`<span class="r-mark ${started ? "r-mark-part" : "r-mark-todo"}" aria-hidden="true"></span>`;
  }

  function sectionMarker(st) {
    return marker({ open: st.open.length, review: st.review.length, walked: st.walked, started: st.answered > 0 });
  }

  function countWords(n, one, few, many) {
    return `${n} ${plural(n, one, few, many)}`;
  }

  // What a station says next to its name
  function stationWords(st) {
    const parts = [];
    if (st.open.length) parts.push(countWords(st.open.length, "нарушение", "нарушения", "нарушений"));
    if (st.review.length) parts.push(`${countWords(st.review.length, "исправление", "исправления", "исправлений")} на проверку`);
    if (st.left) parts.push(st.answered ? `осталось ${countWords(st.left, "вопрос", "вопроса", "вопросов")}` : "не пройдено");
    return parts.length ? parts.join(", ") : "без нарушений";
  }

  function station(st, act) {
    return html`<button type="button" class="r-station" data-act="${act}" data-section="${st.name}">
      ${sectionMarker(st)}
      <span class="r-name">${st.short}</span>
      <span class="r-words">${stationWords(st)}</span>
    </button>`;
  }

  // Where readiness stands, with the numbers of the rule: 90 % and nothing left unresolved
  function lead(s) {
    if (!s.started) return "Обход ещё не начат. Разделы идут в том порядке, в каком заведение обходит инспектор.";
    if (s.ready) return `Готово к проверке: соблюдено ${s.index} %, открытых нарушений нет.`;
    const facts = [s.index < 90 ? `соблюдено ${s.index} % при нужных 90` : `соблюдено ${s.index} %`];
    if (s.unresolved) facts.push(`не устранено ${countWords(s.unresolved, "нарушение", "нарушения", "нарушений")}`);
    return `Не готово к проверке: ${facts.join(", ")}.`;
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
    const stop = list.find((st) => !st.walked);
    // Messages from staff are not tied to a station
    const loose = state.defects.filter((d) => !defectSection(d));

    return html`${roleTabs("home")}
      <section class="r-head">
        <h2 class="r-title">Маршрут проверки</h2>
        <p class="r-lead">${lead(s)}</p>
      </section>

      ${loose.length
        ? html`<section class="section r-loose" id="sec-mine">
            <h2>Сообщения сотрудников <span class="count">${loose.length}</span></h2>
            ${loose.map((d) => (d.status === "fixed" ? reviewBranch(d) : ownBranch(d)))}
          </section>`
        : ""}

      <ol class="r-route">
        ${list.map((st) => {
          const here = st === stop;
          const items = [
            ...st.review.map((d) => reviewBranch(d)),
            ...st.open.filter((d) => d.to_owner).map((d) => ownBranch(d)),
            ...st.open.filter((d) => !d.to_owner).map((d) => teamBranch(d)),
          ];
          return html`<li class="r-stop${st.walked ? " r-walked" : ""}${here ? " r-here" : ""}">
            ${station(st, "rSection")}
            ${items.length || here
              ? html`<div class="r-branches">
                  ${items}
                  ${here ? html`<button type="button" class="btn btn-primary r-go" data-act="rSection" data-section="${st.name}">${s.started ? "Продолжить обход" : "Начать обход"}</button>` : ""}
                </div>`
              : ""}
          </li>`;
        })}
      </ol>
      ${stop ? "" : html`<button type="button" class="btn btn-primary" data-act="goAuditSummary">Итоги аудита</button>`}

      ${shiftNowSection(state)}

      <section class="section">
        <h2>Документы и команда</h2>
        <div class="r-links">
          <button type="button" class="r-link" data-act="goInvite"><i class="ico" data-i="users" aria-hidden="true"></i>Команда и приглашения</button>
          <button type="button" class="r-link" data-act="downloadAct"><i class="ico" data-i="file" aria-hidden="true"></i>Акт аудита (PDF)</button>
        </div>
      </section>
      ${chatButton()}`;
  }

  // "Мария Петрова, повар": who did the fix
  function doneBy(d) {
    if (!d.fixed_by) return d.assigned_position || "не указан";
    return d.assigned_position ? `${d.fixed_by}, ${d.assigned_position.toLowerCase()}` : d.fixed_by;
  }

  // A fix waiting for the owner, hanging off the station where the violation was found
  function reviewBranch(d) {
    return html`<article class="r-item" id="defect-${d.id}">
      <h3>${d.title}</h3>
      <p class="r-note">Исполнитель: ${doneBy(d)}${d.fixed_at ? `, ${d.fixed_at}` : ""}.</p>
      ${photoPair(d.before_photos, "Было", d.after_photos, "Стало")}
      <div class="row-buttons">
        <button type="button" class="btn btn-primary" data-act="acceptFix" data-id="${d.id}">Принять</button>
        <button type="button" class="btn btn-secondary" data-act="returnFix" data-id="${d.id}">Вернуть</button>
      </div>
    </article>`;
  }

  function ownBranch(d) {
    const isProblem = d.kind === "problem";
    return html`<article class="r-item" id="defect-${d.id}">
      <h3>${d.title}</h3>
      <p class="r-note">${isProblem ? "Сообщение от сотрудника." : "Исправить нужно вам."}${d.status === "returned" ? " Вернули на доработку." : ""}</p>
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
    return html`<button type="button" class="r-item r-item-team" data-act="teamDefect" data-id="${d.id}">
      <span class="r-item-title">${d.title}</span>
      <span class="r-note">${d.return_reason ? html`<span class="r-bad-text">Вернули: ${d.return_reason.toLowerCase()}.</span> ` : ""}Исправляет ${d.assigned_position.toLowerCase()}.</span>
    </button>`;
  }

  function teamDefect(el) {
    const d = App.ownerState.defects.find((x) => x.id === Number(el.dataset.id));
    if (!d) return;
    const section = defectSection(d);
    DesignCommon.teamDefectSheet(
      d,
      `Когда сотрудник пришлёт фото исправления, оно появится на маршруте у раздела «${SECTION_SHORT[section] || section}» с кнопками «Принять» и «Вернуть».`
    );
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
      <span class="r-qdot" aria-hidden="true"></span>
      <article class="card question-card r-card">
        <p class="r-qhead">Вопрос ${ids.indexOf(id) + 1} из ${ids.length} в разделе</p>
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
        ${prev ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${prev}">Предыдущий</button>` : html`<span></span>`}
        ${next
          ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${next}">Пропустить</button>`
          : html`<button type="button" class="btn-link" data-act="auditDone">К итогам</button>`}
      </div>
    </li>`;

    mount(
      "#app",
      html`<header class="topbar">
          <button type="button" class="topbar-back" data-act="auditExit" aria-label="Выйти из аудита">‹</button>
          <h1>Аудит</h1>
          <span class="saved" id="savedMark" hidden>Сохранено</span>
          <button type="button" class="topbar-action" data-act="auditSections">Разделы</button>
        </header>
        <main class="screen audit-screen r-audit">
          <p class="r-audit-sum">Пройдено ${answeredAll} из ${Audit.order.length}. Раздел или вопрос на линии открывает его.</p>
          <ol class="r-route r-route-audit">
            ${list.map((st) =>
              st.name === item.section
                ? html`<li class="r-stop r-open${st.walked ? " r-walked" : ""}">
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
                : html`<li class="r-stop${st.walked ? " r-walked" : ""}">${station(st, "rJump")}</li>`
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

  // Audit results: the whole line in one row of marks, and the stations named by what they hold
  function readinessRing(summary) {
    const defects = (App.ownerState && App.ownerState.defects) || [];
    const list = stations(defects, summaryCounts(summary));
    const names = (test) => list.filter(test).map((st) => st.short).join(", ");
    const withIssues = names((st) => st.open.length || st.review.length);
    const unwalked = names((st) => !st.walked && !st.open.length && !st.review.length);
    const clean = names((st) => st.walked && !st.open.length && !st.review.length);
    return html`<div class="r-mini" aria-hidden="true">${list.map((st) => html`<span class="r-mini-stop${st.walked ? " r-walked" : ""}">${sectionMarker(st)}</span>`)}</div>
      <p class="r-lead">${lead(summary)}</p>
      <dl class="r-sum">
        ${withIssues ? html`<div><dt>Нарушения</dt><dd>${withIssues}</dd></div>` : ""}
        ${unwalked ? html`<div><dt>Не пройдено</dt><dd>${unwalked}</dd></div>` : ""}
        ${clean ? html`<div><dt>Без нарушений</dt><dd>${clean}</dd></div>` : ""}
      </dl>`;
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
        <p class="r-lead">${isOwner ? "Все задачи смены" : data.employee.position}${shift ? `, смена с ${shift.started}${shift.checkin === "qr" ? " по QR-коду" : ""}` : ""}</p>
        ${isOwner ? html`<button type="button" class="btn-link small" data-act="ownerRoleMenu">Выйти из роли сотрудника</button>` : ""}
        ${shift ? "" : html`<p class="r-lead">Смена ещё не начата.</p>${shiftStart(data)}`}
        ${data.duties.length ? html`<p class="r-shift-count">Выполнено <strong>${done} из ${data.duties.length}</strong></p>` : ""}
      </section>

      ${zones.length
        ? html`<ol class="r-route r-route-shift">${zones.map((zone) => zoneStop(zone, data))}</ol>`
        : html`<p class="muted">${isOwner ? "Задач смены пока нет. Их можно добавить в настройках." : "На вашу должность задач нет. Руководитель может добавить их в настройках."}</p>`}

      ${shiftFooter(shift)}`;
  }

  function zoneFacts(zone, data) {
    const duties = data.duties.filter((d) => d.zone === zone);
    const left = duties.filter((d) => !d.done).length;
    const open = data.defects.filter((d) => d.zone === zone && d.status !== "fixed").length;
    const review = data.defects.filter((d) => d.zone === zone && d.status === "fixed").length;
    return { duties, left, open, review, walked: !left && !open };
  }

  function zoneWords({ duties, left, open, review }) {
    const parts = [];
    if (open) parts.push(`${countWords(open, "нарушение", "нарушения", "нарушений")}, исправьте`);
    if (review) parts.push("исправление у руководителя");
    if (left) parts.push(`осталось ${countWords(left, "задача", "задачи", "задач")}`);
    else if (duties.length) parts.push("всё сделано");
    return parts.join(", ");
  }

  function zoneMarker(facts) {
    return marker({ open: facts.open, review: facts.review, walked: facts.walked, started: facts.duties.length > facts.left });
  }

  function zoneStop(zone, data) {
    const facts = zoneFacts(zone, data);
    const urgent = data.defects.filter((d) => d.zone === zone && d.status !== "fixed");
    const review = data.defects.filter((d) => d.zone === zone && d.status === "fixed");
    const open = expanded.has(zone) ? expanded.get(zone) : facts.left > 0;
    return html`<li class="r-stop${facts.walked ? " r-walked" : ""}" data-zone="${zone}">
      <button type="button" class="r-station r-zone" data-act="rZone" data-zone="${zone}" aria-expanded="${open ? "true" : "false"}">
        ${zoneMarker(facts)}
        <span class="r-name">${zone}</span>
        <span class="r-words">${zoneWords(facts)}</span>
      </button>
      ${urgent.length || review.length
        ? html`<div class="r-branches">
            ${urgent.map((d) => urgentBranch(d))}
            ${review.map(
              (d) => html`<article class="r-item defect-card" id="defect-${d.id}">
                <h3>${d.title}</h3>
                <p class="r-note">Фото исправления у руководителя: он примет его или вернёт с причиной.</p>
                ${photoPair(d.before_photos, "Было", d.after_photos, "Стало")}
              </article>`
            )}
          </div>`
        : ""}
      ${open && facts.duties.length
        ? html`<ul class="task-list r-tasks">
            ${facts.duties.map(
              (d) => html`<li class="task r-task ${d.done ? "done" : ""}">
                <button type="button" class="task-check r-check" data-act="toggleTask" data-id="${d.id}" data-done="${d.done ? "1" : ""}" ${raw(data.shift ? "" : "disabled")}
                  aria-label="${d.done ? "Снять отметку" : "Отметить выполненной"}">${taskMark(d.done)}</button>
                <button type="button" class="r-task-text" data-act="taskMenu" data-id="${d.id}">${d.question}${d.photos.length
                  ? html`<span class="muted small block"><i class="ico" data-i="camera" aria-hidden="true"></i> Фото: ${d.photos.length}</span>`
                  : ""}${data.employee.is_owner && d.position ? html`<span class="muted small block">${d.position}</span>` : ""}</button>
              </li>`
            )}
          </ul>`
        : ""}
    </li>`;
  }

  function urgentBranch(d) {
    return html`<article class="r-item r-item-urgent defect-card urgent" id="defect-${d.id}">
      <h3>${d.title}</h3>
      <p class="r-note">${d.status === "returned"
        ? html`<span class="r-bad-text">Руководитель вернул исправление: ${d.return_reason.toLowerCase()}.</span>`
        : "Нарушение нашли при аудите. Исправьте и сфотографируйте результат."}</p>
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

  // A drawn tick in the stop's circle
  function taskMark(done) {
    return done ? html`<span class="r-tick" aria-hidden="true"></span>` : "";
  }

  // A ticked duty repaints its station in place, without redrawing the line under the finger
  function updateTaskCounters() {
    const data = Staff.shift;
    document.querySelectorAll(".r-route-shift .r-stop[data-zone]").forEach((stop) => {
      const facts = zoneFacts(stop.dataset.zone, data);
      stop.classList.toggle("r-walked", facts.walked);
      const button = stop.querySelector(".r-zone");
      const fresh = mount(document.createElement("span"), zoneMarker(facts)).firstElementChild;
      button.querySelector(".r-mark").replaceWith(fresh);
      button.querySelector(".r-words").textContent = zoneWords(facts);
    });
    const count = document.querySelector(".r-shift-count strong");
    if (count) count.textContent = `${data.duties.filter((d) => d.done).length} из ${data.duties.length}`;
  }

  Design.register("route", "Маршрут", {
    globals: { ...DesignCommon.globals, renderAuditItem, shiftView, taskMark, updateTaskCounters, readinessRing },
    actions: {
      ...DesignCommon.actions,
      teamDefect,
      rSection: (el) => Router.go("audit", { section: el.dataset.section }, { base: "home" }),
      rJump: jumpToSection,
      rZone: toggleZone,
    },
    screens: { home: { render: renderHome } },
  });
})();

// Design «Сейчас»: one thing at a time.
// Every screen opens with the single next step in big words and one big button; the rest waits in
// a short queue. Readiness is counted in steps left, not in percent. A fix is checked by dragging
// one photo over the other, the audit is a photo to compare with, and a cook sees only what is left.

(function () {
  const Now = { focus: "", shiftFocus: "" };

  function steps(n) {
    return `${n} ${plural(n, "шаг", "шага", "шагов")}`;
  }

  function things(n) {
    return `${n} ${plural(n, "дело", "дела", "дел")}`;
  }

  // «Было» under «стало»: drag across the frame to compare the same spot before and after
  function compare(before, after) {
    const first = (before || []).filter(Boolean);
    const second = (after || []).filter(Boolean);
    if (!first.length || !second.length) return photoPair(first, "Было", second, "Стало");
    return html`<div class="n-compare" style="--pos: 50%">
        <img class="n-compare-before" src="${first[0]}" alt="Было" draggable="false">
        <img class="n-compare-after" src="${second[0]}" alt="Стало" draggable="false">
        <span class="n-compare-line" aria-hidden="true"></span>
        <span class="n-compare-tag n-compare-tag-before" aria-hidden="true">Было</span>
        <span class="n-compare-tag n-compare-tag-after" aria-hidden="true">Стало</span>
        <input class="n-compare-range" type="range" min="0" max="100" value="50" aria-label="Сдвиньте, чтобы сравнить «было» и «стало»">
      </div>
      <p class="n-compare-note">Сдвиньте рамку пальцем.
        <button type="button" class="inline-link" data-act="photo" data-srcs="${JSON.stringify(first)}" data-caption="Было">Фото «было»</button>
        и <button type="button" class="inline-link" data-act="photo" data-srcs="${JSON.stringify(second)}" data-caption="Стало">«стало»</button>
        целиком.</p>`;
  }

  // The divider follows the finger; the hidden slider keeps it usable from the keyboard
  let dragging = null;
  function moveDivider(e) {
    const rect = dragging.getBoundingClientRect();
    const pos = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    dragging.style.setProperty("--pos", `${pos}%`);
    dragging.querySelector(".n-compare-range").value = Math.round(pos);
  }
  document.addEventListener("pointerdown", (e) => {
    const frame = e.target.closest && e.target.closest(".n-compare");
    if (!frame) return;
    dragging = frame;
    moveDivider(e);
  });
  document.addEventListener("pointermove", (e) => {
    if (dragging) moveDivider(e);
  });
  ["pointerup", "pointercancel"].forEach((type) =>
    document.addEventListener(type, () => {
      dragging = null;
    })
  );
  document.addEventListener("input", (e) => {
    const range = e.target;
    if (range.classList && range.classList.contains("n-compare-range")) range.parentElement.style.setProperty("--pos", `${range.value}%`);
  });

  function settingsButton() {
    return html`<button type="button" class="icon-btn" data-act="goSettings" aria-label="Настройки"><i class="ico" data-i="gear" aria-hidden="true"></i></button>`;
  }

  // ---------- Cabinet ----------

  // What stands between the café and the inspection, the owner's own steps first
  function ownerSteps(state) {
    const s = state.summary;
    const left = s.total - s.answered;
    const list = [];
    state.defects.filter((d) => d.status === "fixed").forEach((d) => list.push({ key: `review-${d.id}`, kind: "review", d }));
    state.defects.filter((d) => d.to_owner && d.status !== "fixed").forEach((d) => list.push({ key: `mine-${d.id}`, kind: "mine", d }));
    if (left) list.push({ key: "audit", kind: "audit", left });
    else if (!s.ready && !state.defects.length) list.push({ key: "summary", kind: "summary" });
    const waiting = state.defects.filter((d) => !d.to_owner && d.status !== "fixed");
    return { list, waiting };
  }

  function stepTitle(step) {
    if (step.kind === "review") return "Проверьте исправление";
    if (step.kind === "mine") return step.d.kind === "problem" ? "Разберитесь с сообщением" : "Устраните нарушение";
    if (step.kind === "audit") return "Продолжите аудит";
    return "Посмотрите итоги аудита";
  }

  function stepText(step, s) {
    if (step.d) return step.d.title;
    if (step.kind === "audit") {
      const sections = (s.sections || []).filter((x) => x.answered < x.total).map((x) => SECTION_SHORT[x.name] || x.name);
      return `Осталось ${step.left} ${plural(step.left, "вопрос", "вопроса", "вопросов")}: ${sections.join(", ").toLowerCase()}.`;
    }
    return `Соблюдено ${s.index} %, для готовности нужно от 90 %.`;
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
    const { list, waiting } = ownerSteps(state);
    const now = list.find((step) => step.key === Now.focus) || list[0];
    const rest = list.filter((step) => step !== now);
    const total = list.length + waiting.length;

    let headline = "Готово к проверке";
    if (!s.started) headline = "Начните с аудита";
    else if (total) headline = `До готовности ${steps(total)}`;

    return html`${roleTabs("home")}
      <section class="n-head">
        <h2 class="n-headline">${headline}</h2>
        <p class="n-sub">${s.started
          ? html`Соблюдено ${s.index} %, для готовности нужно от 90 % и ни одного открытого нарушения.`
          : html`71 вопрос из официального проверочного листа, по порядку обхода заведения.`}</p>
      </section>

      <section class="n-now" aria-label="Сейчас">
        <p class="n-now-label">Сейчас</p>
        ${now ? nowCard(now, s) : readyCard(s)}
      </section>

      ${rest.length
        ? html`<section class="section n-queue">
            <h2>Потом <span class="count">${rest.length}</span></h2>
            <ol class="n-list">
              ${rest.map(
                (step) => html`<li><button type="button" class="n-item" data-act="nFocus" data-key="${step.key}">
                  <span class="n-item-kind">${stepTitle(step)}</span>
                  <span class="n-item-text">${stepText(step, s)}</span>
                </button></li>`
              )}
            </ol>
          </section>`
        : ""}

      ${waiting.length
        ? html`<section class="section n-queue" id="sec-team">
            <h2>Ждём от команды <span class="count">${waiting.length}</span></h2>
            <ol class="n-list">
              ${waiting.map(
                (d) => html`<li><button type="button" class="n-item n-item-wait" data-act="teamDefect" data-id="${d.id}">
                  <span class="n-item-kind">${d.assigned_position}: ${DEFECT_STATUS[d.status].toLowerCase()}</span>
                  <span class="n-item-text">${d.title}</span>
                </button></li>`
              )}
            </ol>
          </section>`
        : ""}

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

  function nowCard(step, s) {
    const d = step.d;
    if (step.kind === "review") {
      return html`<article class="n-card" id="defect-${d.id}">
        <h3 class="n-title">Проверьте исправление</h3>
        <p class="n-what">${d.title}</p>
        ${compare(d.before_photos, d.after_photos)}
        <p class="n-by">Исполнитель: ${d.fixed_by || d.assigned_position || "не указан"}${d.fixed_at ? `, ${d.fixed_at}` : ""}</p>
        <div class="n-actions">
          <button type="button" class="btn btn-primary" data-act="acceptFix" data-id="${d.id}">Принять</button>
          <button type="button" class="btn btn-secondary" data-act="returnFix" data-id="${d.id}">Вернуть</button>
        </div>
      </article>`;
    }
    if (step.kind === "mine") {
      const isProblem = d.kind === "problem";
      return html`<article class="n-card" id="defect-${d.id}">
        <h3 class="n-title">${stepTitle(step)}</h3>
        <p class="n-what">${d.title}</p>
        ${isProblem && d.comment && d.comment !== d.title ? html`<p>${d.comment}</p>` : ""}
        ${d.before_photos.length || d.reference_photo ? photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть") : ""}
        ${d.remediation ? html`<p class="n-how"><strong>Что сделать:</strong> ${d.remediation}</p>` : ""}
        <div class="n-actions">
          <button type="button" class="btn btn-primary" data-act="resolveWithPhoto" data-id="${d.id}">${photoLabel("результат")}</button>
          ${isProblem ? html`<button type="button" class="btn btn-secondary" data-act="resolveOwnerTask" data-id="${d.id}">Решено</button>` : ""}
        </div>
      </article>`;
    }
    if (step.kind === "audit") {
      return html`<article class="n-card">
        <h3 class="n-title">${s.started ? "Продолжите аудит" : "Пройдите аудит"}</h3>
        <p class="n-what">${stepText(step, s)}</p>
        <div class="n-actions"><button type="button" class="btn btn-primary" data-act="goAudit">${s.started ? "Продолжить аудит" : "Начать аудит"}</button></div>
      </article>`;
    }
    return html`<article class="n-card">
      <h3 class="n-title">Посмотрите итоги аудита</h3>
      <p class="n-what">${stepText(step, s)}</p>
      <div class="n-actions"><button type="button" class="btn btn-primary" data-act="goAuditSummary">Итоги аудита</button></div>
    </article>`;
  }

  function readyCard(s) {
    return html`<article class="n-card">
      <h3 class="n-title">Готово к проверке</h3>
      <p class="n-what">Соблюдено ${s.index} %, открытых нарушений нет. Акт аудита можно распечатать для инспектора.</p>
      <div class="n-actions"><button type="button" class="btn btn-primary" data-act="downloadAct">Акт аудита (PDF)</button></div>
    </article>`;
  }

  // A step from the queue becomes the one on top
  function focusStep(el) {
    Now.focus = el.dataset.key;
    const state = App.ownerState;
    mount("#app", screen(state.name, homeView(state), { back: false, action: settingsButton() }));
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  // Audit results: how many steps are left instead of a ring
  function readinessRing(summary) {
    const label = !summary.started ? "Аудит не начат" : summary.ready ? "Готово к проверке" : summary.index >= 70 ? "Почти готово" : "Есть что исправить";
    return html`<p class="n-headline">${label}</p>
      <div class="n-meter" aria-hidden="true"><span class="n-meter-fill" style="width:${summary.index}%"></span><i class="n-meter-goal"></i></div>
      <p class="n-sub">Соблюдено ${summary.index} %, нужно от 90 %.</p>`;
  }

  // ---------- Audit: the photo first, then the question ----------

  function renderAuditItem(id) {
    const item = Checklist.byId[id];
    const answer = Audit.answers[String(id)];
    const status = answer ? answer.status : "";
    const total = Audit.order.length;
    const answeredAll = Object.keys(Audit.answers).length;
    const position = Audit.order.indexOf(id) + 1;
    const prev = Audit.prev(id);
    const next = Audit.next(id);
    const good = item.reference_photo ? `/${item.reference_photo}` : "";
    const bad = item.violation_example_photo ? `/${item.violation_example_photo}` : "";
    const first = good || bad;

    mount(
      "#app",
      html`<header class="topbar">
          <button type="button" class="topbar-back" data-act="auditExit" aria-label="Выйти из аудита">‹</button>
          <h1>Аудит</h1>
          <span class="saved" id="savedMark" hidden>Сохранено ✓</span>
          <button type="button" class="topbar-action" data-act="auditSections">Разделы</button>
        </header>
        <main class="screen audit-screen n-audit">
          <div class="n-progress">
            <p><strong>${position} из ${total}</strong><span>${SECTION_SHORT[item.section] || item.section}</span></p>
            <div class="n-meter" aria-hidden="true"><span class="n-meter-fill" style="width:${Math.round((answeredAll / total) * 100)}%"></span></div>
          </div>

          ${first
            ? html`<figure class="n-photo">
                <button type="button" class="n-photo-main" data-act="photo" data-src="${first}" data-caption="${good ? "Так правильно" : "Так — нарушение"}">
                  <img src="${first}" alt="">
                </button>
                ${good && bad
                  ? html`<div class="n-switch" role="group" aria-label="Пример">
                      <button type="button" class="n-switch-ok active" data-act="nPhoto" data-src="${good}" data-caption="Так правильно" aria-pressed="true">Так правильно</button>
                      <button type="button" class="n-switch-bad" data-act="nPhoto" data-src="${bad}" data-caption="Так — нарушение" aria-pressed="false">Так нарушение</button>
                    </div>`
                  : html`<figcaption class="n-switch-one">${good ? "Так правильно" : "Так — нарушение"}</figcaption>`}
              </figure>`
            : ""}

          <h2 class="question n-question">${item.question}</h2>
          ${item.norm ? html`<p class="n-norm">${item.norm}</p>` : ""}
          ${item.applies_to ? html`<p class="muted small">Применимо, если: ${item.applies_to.toLowerCase()}.</p>` : ""}
          ${basisBlock(item, "basis-" + id)}
          ${auditAnswerNote(id)}

          <div class="answer-bar n-answers" role="group" aria-label="Ответ">
            <button type="button" class="answer n-yes ${status === "compliant" ? "active" : ""}" data-act="answerOk" data-id="${id}">Да, соблюдается</button>
            <button type="button" class="answer n-no ${status === "violation" ? "active" : ""}" data-act="answerViolation" data-id="${id}">Нет, нарушение</button>
            <button type="button" class="answer n-na ${status === "na" ? "active" : ""}" data-act="answerNa" data-id="${id}">Не применимо</button>
          </div>
          <p class="answer-hint muted small">${auditHint()}</p>
          <div class="row-between audit-nav">
            ${prev ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${prev}">‹ Предыдущий</button>` : html`<span></span>`}
            ${next ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${next}">Пропустить ›</button>` : html`<button type="button" class="btn-link" data-act="auditDone">К итогам ›</button>`}
          </div>
        </main>`
    );
    Router.current.params.itemId = id;
  }

  function switchPhoto(el) {
    const figure = el.closest(".n-photo");
    const main = figure.querySelector(".n-photo-main");
    main.dataset.src = el.dataset.src;
    main.dataset.caption = el.dataset.caption;
    main.querySelector("img").src = el.dataset.src;
    figure.querySelectorAll("[data-act=nPhoto]").forEach((b) => {
      b.classList.toggle("active", b === el);
      b.setAttribute("aria-pressed", b === el ? "true" : "false");
    });
  }

  // ---------- Shift: one thing now, the rest in a short list ----------

  function shiftView(data) {
    const shift = data.shift;
    const isOwner = data.employee.is_owner;
    const urgent = data.defects.filter((d) => d.status !== "fixed");
    const onReview = data.defects.filter((d) => d.status === "fixed");
    const todo = data.duties.filter((d) => !d.done);
    const done = data.duties.filter((d) => d.done);
    const queue = [...urgent.map((d) => ({ key: `defect-${d.id}`, d })), ...todo.map((t) => ({ key: `task-${t.id}`, t }))];
    const now = (shift && queue.find((q) => q.key === Now.shiftFocus)) || queue[0];
    const later = queue.filter((q) => q !== now);

    let headline = "Всё сделано";
    if (!shift) headline = "Смена не начата";
    else if (queue.length) headline = `Осталось ${things(queue.length)}`;

    return html`${roleTabs("shift")}
      <section class="n-head">
        <p class="n-sub">${data.employee.full_name}, ${isOwner ? "все задачи смены" : data.employee.position.toLowerCase()}${shift ? `. Смена с ${shift.started}${shift.checkin === "qr" ? " по QR" : ""}` : ""}</p>
        <h2 class="n-headline n-shift-headline">${headline}</h2>
        ${isOwner ? html`<button type="button" class="btn-link small" data-act="ownerRoleMenu">Выйти из роли сотрудника</button>` : ""}
      </section>

      <section class="n-now" aria-label="Сейчас">
        <p class="n-now-label">Сейчас</p>
        ${!shift
          ? html`<article class="n-card">
              <h3 class="n-title">Начните смену</h3>
              <p class="n-what">${queue.length ? `На смену ${things(queue.length)}. Отмечать их можно после начала смены.` : "Задач на смену пока нет."}</p>
              <div class="n-actions">${shiftStart(data)}</div>
            </article>`
          : now
          ? now.d
            ? fixCard(now.d)
            : taskCard(now.t, isOwner)
          : html`<article class="n-card">
              <h3 class="n-title">Всё сделано</h3>
              <p class="n-what">Задачи смены выполнены${done.length ? `: ${done.length} из ${data.duties.length}` : ""}. Можно завершить смену.</p>
              <div class="n-actions"><button type="button" class="btn btn-primary" data-act="endShift">Завершить смену</button></div>
            </article>`}
      </section>

      ${later.length
        ? html`<section class="section n-queue n-later">
            <h2>Потом <span class="count">${later.length}</span></h2>
            <ul class="task-list n-tasks">
              ${later.map((q) =>
                q.d
                  ? html`<li class="n-task n-task-defect"><button type="button" class="n-item" data-act="nShiftFocus" data-key="${q.key}">
                      <span class="n-item-kind">Нарушение, ${q.d.zone.toLowerCase()}</span><span class="n-item-text">${q.d.title}</span></button></li>`
                  : taskRow(q.t, shift, isOwner)
              )}
            </ul>
          </section>`
        : ""}

      ${onReview.length
        ? html`<section class="section">
            <h2>Ждёт проверки руководителя <span class="count">${onReview.length}</span></h2>
            ${onReview.map(
              (d) => html`<article class="card defect-card n-review" id="defect-${d.id}">
                <h3>${d.title}</h3>
                ${photoPair(d.before_photos, "Было", d.after_photos, "Стало")}
              </article>`
            )}
          </section>`
        : ""}

      ${done.length
        ? html`<section class="section n-done">
            <button type="button" class="link-toggle n-done-toggle" data-act="toggle" data-target="n-done-list">Сделано ${done.length} из ${data.duties.length}</button>
            <ul class="task-list n-tasks" id="n-done-list" hidden>${done.map((t) => taskRow(t, shift, isOwner))}</ul>
          </section>`
        : ""}

      ${shiftFooter(shift)}`;
  }

  function fixCard(d) {
    return html`<article class="n-card defect-card" id="defect-${d.id}">
      <h3 class="n-title">Исправьте нарушение</h3>
      ${d.status === "returned" ? html`<p class="n-returned">Вернули: ${d.return_reason}</p>` : ""}
      <p class="n-what">${d.title}</p>
      ${photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть")}
      ${!d.reference_photo && d.photo_hint ? html`<p class="n-how"><strong>Как должно быть:</strong> ${d.photo_hint}</p>` : ""}
      ${d.remediation ? html`<p class="n-how"><strong>Что сделать:</strong> ${d.remediation}</p>` : ""}
      <div class="n-actions"><button type="button" class="btn btn-primary" data-act="fixDefect" data-id="${d.id}">${photoLabel("исправление")}</button></div>
    </article>`;
  }

  function taskCard(t, isOwner) {
    return html`<article class="n-card">
      <h3 class="n-title">${t.zone}</h3>
      <p class="n-what">${t.question}</p>
      ${isOwner && t.position ? html`<p class="n-how">${t.position}</p>` : ""}
      <div class="n-actions">
        <button type="button" class="btn btn-primary" data-act="nDone" data-id="${t.id}">Сделано</button>
        <button type="button" class="btn btn-secondary" data-act="taskMenu" data-id="${t.id}">Как правильно</button>
      </div>
    </article>`;
  }

  function taskRow(t, shift, isOwner) {
    return html`<li class="task n-task ${t.done ? "done" : ""}">
      <button type="button" class="n-task-text" data-act="taskMenu" data-id="${t.id}">
        <span class="n-item-kind">${t.zone}${isOwner && t.position ? `, ${t.position.toLowerCase()}` : ""}</span>
        <span class="n-item-text">${t.question}${t.photos.length ? html` <span class="muted small"><i class="ico" data-i="camera" aria-hidden="true"></i> ${t.photos.length}</span>` : ""}</span>
      </button>
      <button type="button" class="task-check n-check" data-act="toggleTask" data-id="${t.id}" data-done="${t.done ? "1" : ""}" ${raw(shift ? "" : "disabled")}
        aria-label="${t.done ? "Снять отметку" : "Отметить выполненной"}">${taskMark(t.done)}</button>
    </li>`;
  }

  // The big button of the task on top: done, and the next one comes up
  function doneNow(el) {
    const duty = Staff.shift.duties.find((d) => d.id === Number(el.dataset.id));
    if (!duty) return null;
    if (Staff.shift.facility.task_photo_required && !duty.photos.length) return attachTaskPhoto(duty.id);
    return busy(el, async () => {
      await api("POST", `/api/shift/tasks/${duty.id}`, { done: true });
      Bridge.haptic("light");
      toast("Сделано ✓", { type: "success" });
      await Router.refresh();
    });
  }

  function focusShift(el) {
    Now.shiftFocus = el.dataset.key;
    mount("#app", screen("Моя смена", shiftView(Staff.shift), { back: Router.stack.length > 1 }));
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  // Ticked rows stay where they are until the screen is opened again; only the numbers change
  function updateTaskCounters() {
    const data = Staff.shift;
    const done = data.duties.filter((d) => d.done).length;
    const left = data.duties.length - done + data.defects.filter((d) => d.status !== "fixed").length;
    const headline = document.querySelector(".n-shift-headline");
    if (headline && data.shift) headline.textContent = left ? `Осталось ${things(left)}` : "Всё сделано";
    const toggle = document.querySelector(".n-done-toggle");
    if (toggle) toggle.textContent = `Сделано ${done} из ${data.duties.length}`;
  }

  Design.register("now", "Сейчас", {
    globals: { renderAuditItem, shiftView, updateTaskCounters, readinessRing },
    actions: { nFocus: focusStep, nPhoto: switchPhoto, nDone: doneNow, nShiftFocus: focusShift },
    screens: { home: { render: renderHome } },
  });
})();

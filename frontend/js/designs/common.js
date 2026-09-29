// Shared by the design variants: the usual look's texts without the tick glyphs, middle dots and
// dashes glued into them, and a plain list for the sections sheet. Every design registers these
// parts next to its own ones; without a design the usual look keeps its texts.

const DesignCommon = (function () {
  const baseToast = window.toast;
  const basePhotoLabel = window.photoLabel;

  // "Принято ✓ Готовность: 91%" becomes "Принято. Готовность: 91%": the toast colour already says it worked
  function plainToast(message, options) {
    const text = String(message).replace(/\s*✓\s*$/, "").replace(/\s*✓\s+/g, ". ");
    return baseToast(text, options);
  }

  // The icon flows with the words, so a label that wraps on a narrow phone stays centred as one text
  function flowingPhotoLabel(action) {
    return html`<span class="btn-text">${basePhotoLabel(action)}</span>`;
  }

  function showPhotos(urls, caption) {
    sheet(
      html`<p class="muted">${caption}${urls.length > 1 ? `, ${urls.length} фото` : ""}</p>
        ${urls.map((u) => html`<img class="photo-full" src="${u}" alt="">`)}`,
      [{ label: "Закрыть", value: null }]
    );
  }

  // What is already known about a question, as a sentence, with its photos as a separate link
  function auditAnswerNote(id) {
    const answer = Audit.answers[String(id)];
    const defect = Audit.defectFor(id);
    const status = answer ? answer.status : "";
    let note = "";
    if (answer && answer.source === "features") note = "Отмечено при настройке: этого у вас нет.";
    else if (answer && answer.source === "fix") note = "Нарушение исправлено и принято.";
    else if (defect) note = defect.to_owner ? "Нарушение записано в ваши задачи." : `Передано на исправление: ${defect.assigned_position.toLowerCase()}.`;
    else if (status === "compliant") note = "Соблюдается.";
    if (!note) return "";
    const photos = status && status !== "na" ? answer.photos || [] : [];
    const canAddPhoto = status === "compliant" && answer.source === "user" && !photos.length;
    return html`<p class="answer-note ${status}">${note}
      ${photos.length
        ? html`<button type="button" class="inline-link" data-act="photo" data-srcs="${JSON.stringify(photos)}" data-caption="${STATUS_LABELS[status] || "Фото"}">${photos.length > 1 ? `Посмотреть ${photos.length} фото` : "Посмотреть фото"}</button>`
        : ""}
      ${canAddPhoto ? html`<button type="button" class="inline-link" data-act="addCompliantPhotos" data-id="${id}">Добавить фото</button>` : ""}</p>`;
  }

  function auditHint() {
    return compliantPhotoRequired()
      ? "К обоим ответам нужно фото: так настроено в правилах работы. Фото к «Соблюдается» станет образцом для сотрудников."
      : "К нарушению нужно фото. К «Соблюдается» фото по желанию: оно станет образцом для сотрудников.";
  }

  // Library photos of the question, captioned with the same words as the photos of a violation
  function examplePhotos(item) {
    if (!item.reference_photo && !item.violation_example_photo) return "";
    return html`<div class="example-photos">
      ${item.reference_photo
        ? html`<button type="button" class="example ok" data-act="photo" data-src="/${item.reference_photo}" data-caption="Как должно быть">
            <img src="/${item.reference_photo}" alt="" loading="lazy"><span>Как должно быть</span></button>`
        : ""}
      ${item.violation_example_photo
        ? html`<button type="button" class="example bad" data-act="photo" data-src="/${item.violation_example_photo}" data-caption="Пример нарушения">
            <img src="/${item.violation_example_photo}" alt="" loading="lazy"><span>Пример нарушения</span></button>`
        : ""}
    </div>`;
  }

  // The team with their shift status: who is on shift since when, and how far their duties are
  function shiftNowSection(state) {
    const people = [...state.staff].sort((a, b) => Number(b.on_shift) - Number(a.on_shift));
    const onShift = people.filter((p) => p.on_shift).length;
    if (!people.length) {
      return html`<section class="section" id="sec-shift">
        <h2>Смена сейчас</h2>
        <p class="muted">В команде пока никого. Добавьте людей в настройках и отправьте им QR-код.</p>
      </section>`;
    }
    return html`<section class="section" id="sec-shift">
      <h2>Смена сейчас <span class="count">${onShift} из ${people.length}</span></h2>
      <ul class="list card">
        ${people.map(
          (p) => html`<li class="person${p.on_shift ? " on-shift" : ""}">
            <span><strong>${p.full_name}</strong>${p.is_owner ? " (вы)" : ""}<span class="muted small block">${p.position}</span></span>
            <span class="person-right">${p.on_shift
              ? html`<span class="badge badge-ok">на смене с ${p.shift_started}</span><span class="small muted">задачи ${p.tasks_done} из ${p.tasks_total}</span>`
              : html`<span class="badge">${p.linked ? "не на смене" : "не в MAX"}</span>`}</span>
          </li>`
        )}
      </ul>
      ${people.some((p) => !p.linked)
        ? html`<button type="button" class="btn-link small" data-act="goInvite">Пригласить тех, кто не в MAX</button>`
        : onShift ? "" : html`<p class="muted small">Сотрудники начинают смену кнопкой в чате с ботом.</p>`}
    </section>`;
  }

  // Where a team violation stands, said from the owner's side
  const defectStatus = { open: "Ждёт исправления", returned: "Вернули на доработку", fixed: "Ждёт вашей проверки" };

  // A team violation as a sheet; whenFixed says where the fix shows up in this design
  function teamDefectSheet(d, whenFixed) {
    return sheet(
      html`<h3>${d.title}</h3>
        <dl class="facts">
          <div><dt>Зона</dt><dd>${d.zone}</dd></div>
          <div><dt>Исправляет</dt><dd>${d.assigned_position}</dd></div>
          <div><dt>Сейчас</dt><dd>${defectStatus[d.status]}</dd></div>
          ${d.return_reason ? html`<div class="facts-alert"><dt>Вернули</dt><dd>${d.return_reason}</dd></div>` : ""}
        </dl>
        ${photoPair(d.before_photos, "Как сейчас", d.reference_photo, "Как должно быть")}
        ${d.remediation ? html`<p><strong>Что сделать.</strong> ${d.remediation}</p>` : ""}
        <p class="muted small">${whenFixed}</p>`,
      [{ label: "Закрыть", value: null }]
    );
  }

  // Sections of the audit as a plain list: name on the left, how many questions are marked on the right
  function auditSections() {
    const current = Router.current && Router.current.params.itemId;
    const currentSection = current && Checklist.byId[current] ? Checklist.byId[current].section : "";
    sheet(
      html`<h3>Разделы</h3>
        <p class="muted small">Разделы идут в порядке обхода заведения. Начать можно с любого.</p>
        <div class="section-list">
          ${SECTION_ORDER.map((s) => {
            const st = Audit.sectionStats(s);
            const state = st.answered === st.total ? "done" : st.answered ? "started" : "";
            return html`<button type="button" class="section-row ${state}${s === currentSection ? " current" : ""}" data-act="openSection" data-section="${s}">
              <span class="section-name">${s}</span><span class="section-count">${st.answered} из ${st.total}</span>
            </button>`;
          })}
        </div>`,
      [{ label: "Закрыть", value: null }]
    );
  }

  function openSection(el) {
    document.dispatchEvent(new Event("sheet:close"));
    renderAuditItem(Audit.firstInSection(el.dataset.section));
    window.scrollTo(0, 0);
  }

  // A duty's card; the reference photo is captioned like everywhere else
  function taskMenu(el) {
    const duty = Staff.shift.duties.find((d) => d.id === Number(el.dataset.id));
    const item = Checklist.byId[duty.id];
    sheet(
      html`<h3>${duty.question}</h3>
        ${duty.norm ? html`<p>${duty.norm}</p>` : ""}
        ${duty.photo_hint ? html`<p class="muted small">Что показать на фото: ${duty.photo_hint}</p>` : ""}
        ${item && item.reference_photo
          ? html`<button type="button" class="example ok wide" data-act="photo" data-src="/${item.reference_photo}" data-caption="Как должно быть">
              <img src="/${item.reference_photo}" alt=""><span>Как должно быть</span></button>`
          : ""}
        ${duty.photos.length
          ? html`<button type="button" class="inline-link" data-act="photo" data-srcs="${JSON.stringify(duty.photos)}" data-caption="Фото выполнения"><i class="ico" data-i="camera" aria-hidden="true"></i> Фото выполнения: ${duty.photos.length}</button>`
          : ""}
        ${Staff.shift.shift ? html`<button type="button" class="btn btn-secondary" data-act="taskPhoto" data-id="${duty.id}">${photoLabel("выполнение")}</button>` : ""}`,
      [{ label: "Закрыть", value: null }]
    );
  }

  // Local time in Moscow, like the times the server sends
  function nowTime() {
    return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  }

  return {
    globals: { toast: plainToast, photoLabel: flowingPhotoLabel, showPhotos, auditAnswerNote, auditHint, examplePhotos, shiftNowSection },
    actions: { auditSections, openSection, taskMenu },
    teamDefectSheet,
    defectStatus,
    nowTime,
  };
})();

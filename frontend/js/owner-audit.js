// Internal audit: one question per screen along the route through the premises

const STATUS_LABELS = { compliant: "Соблюдается", violation: "Нарушение", na: "Не применимо" };

const Audit = {
  answers: {},
  summary: null,
  order: [],

  async load() {
    await Checklist.load();
    const [audit, state] = await Promise.all([api("GET", "/api/owner/audit"), api("GET", "/api/owner/state")]);
    this.answers = audit.answers;
    this.summary = audit.summary;
    App.ownerState = state;
    const rank = (item) => {
      const i = SECTION_ORDER.indexOf(item.section);
      return i === -1 ? SECTION_ORDER.length : i;
    };
    this.order = [...Checklist.items]
      .sort((a, b) => rank(a) - rank(b) || Checklist.items.indexOf(a) - Checklist.items.indexOf(b))
      .map((i) => i.id);
  },

  firstUnanswered(fromId) {
    const start = fromId ? this.order.indexOf(fromId) + 1 : 0;
    const rest = [...this.order.slice(start), ...this.order.slice(0, start)];
    return rest.find((id) => !this.answers[String(id)]);
  },

  next(id) {
    const i = this.order.indexOf(id);
    return i >= 0 && i < this.order.length - 1 ? this.order[i + 1] : null;
  },

  prev(id) {
    const i = this.order.indexOf(id);
    return i > 0 ? this.order[i - 1] : null;
  },

  sectionStats(section) {
    const ids = Checklist.items.filter((i) => i.section === section).map((i) => i.id);
    return { total: ids.length, answered: ids.filter((id) => this.answers[String(id)]).length };
  },

  defectFor(itemId) {
    return (App.ownerState.defects || []).find((d) => d.item_id === itemId);
  },

  // Staff with MAX accounts on a position (the owner too, when working shifts)
  linkedOn(position) {
    return App.ownerState.staff.filter((s) => s.linked && s.position === position).map((s) => s.full_name);
  },
};

Screens.audit = {
  async render({ itemId }) {
    if (!Audit.order.length || !App.ownerState) {
      mount("#app", screen("Аудит", skeleton(2)));
      try {
        await Audit.load();
      } catch (e) {
        mount("#app", screen("Аудит", errorState(e, () => Router.refresh())));
        return;
      }
    }
    const id = itemId || Audit.firstUnanswered();
    if (!id) {
      Router.go("auditSummary", {}, { replace: true });
      return;
    }
    Bridge.confirmClosing(true);
    renderAuditItem(id);
  },
  leave() {
    Bridge.confirmClosing(false);
  },
};

function renderAuditItem(id) {
  const item = Checklist.byId[id];
  const answer = Audit.answers[String(id)];
  const stats = Audit.sectionStats(item.section);
  const total = Audit.order.length;
  const answeredAll = Object.keys(Audit.answers).length;
  const defect = Audit.defectFor(id);
  const position = Audit.order.indexOf(id) + 1;
  const status = answer ? answer.status : "";

  let answerNote = "";
  if (answer && answer.source === "features") answerNote = "Отмечено при настройке: этого у вас нет";
  else if (answer && answer.source === "fix") answerNote = "Нарушение исправлено и принято";
  else if (defect) answerNote = defect.to_owner ? "Нарушение — в ваших задачах" : `Нарушение отправлено: ${defect.assigned_position}`;
  const answerPhotos = answer && answer.status !== "na" ? answer.photos || [] : [];
  if (!answerNote && status === "compliant") answerNote = answerPhotos.length ? `Соблюдается · ${answerPhotos.length} фото` : "Соблюдается";
  const addPhotoLink = status === "compliant" && answer.source === "user" && !answerPhotos.length;

  mount(
    "#app",
    html`<header class="topbar">
        <button type="button" class="topbar-back" data-act="auditExit" aria-label="Выйти из аудита">‹</button>
        <h1>Аудит</h1>
        <span class="saved" id="savedMark" hidden>Сохранено ✓</span>
        <button type="button" class="topbar-action" data-act="auditSections">Разделы</button>
      </header>
      <main class="screen audit-screen">
        <div class="audit-progress">
          <div class="row-between small"><span>${item.section}</span><span class="muted">${stats.answered} из ${stats.total}</span></div>
          <div class="bar"><div class="bar-fill" style="width:${Math.round((answeredAll / total) * 100)}%"></div></div>
          <p class="muted small">Проверено ${answeredAll} из ${total}</p>
        </div>

        <article class="card question-card">
          <p class="muted small">Вопрос ${position} из ${total}${item.zone ? html` · ${item.zone}` : ""}</p>
          <h2 class="question">${item.question}</h2>
          ${item.norm ? html`<p>${item.norm}</p>` : ""}
          ${item.applies_to ? html`<p class="muted small">Применимо, если: ${item.applies_to.toLowerCase()}.</p>` : ""}
          ${item.reference_photo || item.violation_example_photo
            ? html`<div class="example-photos">
                ${item.reference_photo
                  ? html`<button type="button" class="example ok" data-act="photo" data-src="/${item.reference_photo}" data-caption="Так правильно">
                      <img src="/${item.reference_photo}" alt="" loading="lazy"><span>✓ Так правильно</span></button>`
                  : ""}
                ${item.violation_example_photo
                  ? html`<button type="button" class="example bad" data-act="photo" data-src="/${item.violation_example_photo}" data-caption="Так — нарушение">
                      <img src="/${item.violation_example_photo}" alt="" loading="lazy"><span>✕ Так — нарушение</span></button>`
                  : ""}
              </div>`
            : ""}
          ${basisBlock(item, "basis-" + id)}
          ${answerNote
            ? html`<p class="answer-note ${status}">${answerNote}${answerPhotos.length
                ? html` · <button type="button" class="inline-link" data-act="photo" data-srcs="${JSON.stringify(answerPhotos)}" data-caption="${STATUS_LABELS[status] || "Фото"}">посмотреть фото</button>`
                : ""}${addPhotoLink
                ? html` · <button type="button" class="inline-link" data-act="addCompliantPhotos" data-id="${id}">добавить фото</button>`
                : ""}</p>`
            : ""}
        </article>

        <div class="answer-bar">
          <button type="button" class="answer ok ${status === "compliant" ? "active" : ""}" data-act="answerOk" data-id="${id}">✓<span>Соблюдается</span></button>
          <button type="button" class="answer bad ${status === "violation" ? "active" : ""}" data-act="answerViolation" data-id="${id}">✕<span>Нарушение</span></button>
          <button type="button" class="answer na ${status === "na" ? "active" : ""}" data-act="answerNa" data-id="${id}">—<span>Не применимо</span></button>
        </div>
        <p class="answer-hint muted small">${compliantPhotoRequired()
          ? "Оба ответа подтверждаются фото — так настроено в правилах работы. Фото «Соблюдается» станет эталоном для сотрудников."
          : "Нарушение подтверждается фото. Для «Соблюдается» фото по желанию — оно станет эталоном для сотрудников."}</p>
        <div class="row-between audit-nav">
          ${Audit.prev(id) ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${Audit.prev(id)}">‹ Предыдущий</button>` : html`<span></span>`}
          ${Audit.next(id) ? html`<button type="button" class="btn-link" data-act="auditGo" data-id="${Audit.next(id)}">Пропустить ›</button>` : html`<button type="button" class="btn-link" data-act="auditDone">К итогам ›</button>`}
        </div>
      </main>`
  );
  Router.current.params.itemId = id;
}

function flashSaved() {
  const mark = document.getElementById("savedMark");
  if (!mark) return;
  mark.hidden = false;
  clearTimeout(flashSaved.timer);
  flashSaved.timer = setTimeout(() => {
    if (mark.isConnected) mark.hidden = true;
  }, 1800);
}

// Save the answer and move on along the route
async function saveAnswer(id, body, button) {
  const res = await busy(button, () => api("PUT", `/api/owner/audit/${id}`, body));
  if (!res) return null;
  Audit.answers[String(id)] = res.answer;
  Audit.summary = res.summary;
  const others = (App.ownerState.defects || []).filter((d) => d.item_id !== id);
  App.ownerState.defects = res.defect ? [res.defect, ...others] : others;
  App.ownerState.summary = res.summary;
  Bridge.haptic(body.status === "violation" ? "warning" : "light");
  goNextQuestion(id);
  flashSaved();
  return res;
}

function goNextQuestion(id) {
  // The owner may have left the audit while a photo was uploading: just show the fresh cabinet
  if (!Router.current || Router.current.name !== "audit") {
    if (Router.current && Router.current.name === "home") Router.refresh();
    return;
  }
  const next = Audit.next(id);
  if (next) renderAuditItem(next);
  else Router.go("auditSummary", {}, { replace: true });
  window.scrollTo(0, 0);
}

Actions.auditGo = (el) => {
  renderAuditItem(Number(el.dataset.id));
  window.scrollTo(0, 0);
};
Actions.auditDone = () => Router.go("auditSummary", {}, { replace: true });
Actions.auditExit = () => Router.go("home", {}, { reset: true });

Actions.auditSections = async () => {
  const choice = await sheet(
    html`<h3>Разделы</h3><p class="muted small">Порядок — как обход заведения. Можно начать с любого.</p>`,
    [
      ...SECTION_ORDER.map((s) => {
        const st = Audit.sectionStats(s);
        return { label: `${s} · ${st.answered}/${st.total}`, value: s };
      }),
      { label: "Закрыть", value: null },
    ]
  );
  if (!choice) return;
  const ids = Audit.order.filter((id) => Checklist.byId[id].section === choice);
  renderAuditItem(ids.find((id) => !Audit.answers[String(id)]) || ids[0]);
  window.scrollTo(0, 0);
};

function compliantPhotoRequired() {
  const settings = App.ownerState && App.ownerState.settings;
  return Boolean(settings && settings.compliant_photo_required);
}

// Compliant: one tap and on to the next question; a photo can be added from the toast or later.
// With "only with a photo" in the work rules, the camera opens first, like for a violation
Actions.answerOk = async (el) => {
  const id = Number(el.dataset.id);
  const previous = Audit.answers[String(id)];
  const hasPhotos = previous && previous.status === "compliant" && (previous.photos || []).length;
  if (compliantPhotoRequired() && !hasPhotos) {
    const photos = await collectPhotos({
      title: "Соблюдается",
      note: "Покажите, как это выглядит сейчас. Первое фото станет эталоном «как должно быть» для сотрудников.",
      confirm: "Сохранить",
    });
    if (!photos) return;
    const saved = await saveAnswer(id, { status: "compliant", photos }, el);
    if (saved) toast(`Соблюдается ✓ Фото: ${photos.length}`, { type: "success" });
    return;
  }
  const res = await saveAnswer(id, { status: "compliant" }, el);
  if (!res) return;
  if ((res.answer.photos || []).length) {
    toast("Соблюдается ✓", { type: "success" });
    return;
  }
  toast("Соблюдается ✓", { type: "success", action: { label: "Добавить фото", fn: () => addCompliantPhotos(id) } });
};

// Photos for a "compliant" answer; the first one becomes the facility's "as it should be" reference
async function addCompliantPhotos(id) {
  const photos = await collectPhotos({
    title: "Соблюдается",
    note: "Покажите, как это выглядит сейчас. Первое фото станет эталоном «как должно быть» для сотрудников.",
    confirm: "Сохранить",
  });
  if (!photos) return;
  let res;
  try {
    res = await api("PUT", `/api/owner/audit/${id}`, { status: "compliant", photos });
  } catch (e) {
    toastError(e, () => addCompliantPhotos(id));
    return;
  }
  Audit.answers[String(id)] = res.answer;
  Audit.summary = res.summary;
  App.ownerState.summary = res.summary;
  toast(`Фото сохранено: ${photos.length} ✓ Это эталон для сотрудников`, { type: "success" });
  if (Router.current && Router.current.name === "audit" && Router.current.params.itemId === id) renderAuditItem(id);
}

Actions.addCompliantPhotos = (el) => addCompliantPhotos(Number(el.dataset.id));

Actions.answerNa = (el) => saveAnswer(Number(el.dataset.id), { status: "na" }, el);

// Violation: photos first, then "Send to <position>?"
Actions.answerViolation = async (el) => {
  const id = Number(el.dataset.id);
  const photos = await collectPhotos({
    title: "Нарушение",
    note: "Снимите, что не так — с разных сторон, если нужно. Эти фото получит ответственный.",
    confirm: "Далее",
  });
  if (!photos) return;
  const assignTo = await chooseAssignee(Checklist.byId[id]);
  if (assignTo === null) {
    toast("Нарушение не сохранено", { type: "info" });
    return;
  }
  const res = await saveAnswer(id, { status: "violation", photos, assign_to: assignTo }, el);
  if (!res || !res.defect) return;
  if (!res.defect.to_owner && res.delivered.length) {
    toast(`Отправлено: ${res.delivered.join(", ")} ✓`, { type: "success" });
  } else if (!res.defect.to_owner) {
    toast(`Задача у должности «${res.defect.assigned_position}», но сообщение в чат не ушло. Сотрудник увидит её в «Моей смене»`, {
      type: "info",
      duration: 5000,
    });
  } else if ((Checklist.byId[id].task_type || "shift") !== "shift") {
    toast("Добавлено в ваши задачи ✓", { type: "success" });
  } else {
    toast("Задача у вас ✓", { type: "success" });
  }
};

// Resolves with a position, "owner", or null when cancelled
async function chooseAssignee(item) {
  if ((item.task_type || "shift") !== "shift") return "owner";
  const state = App.ownerState;
  const position = state.assignments[String(item.id)] || item.default_role || state.positions[0];
  const people = Audit.linkedOn(position);
  const title = people.length ? "Отправить нарушение?" : "Отправить себе?";
  const text = people.length
    ? `Должность «${position}». Получат в MAX с двумя фото: ${people.join(", ")}.`
    : `На должности «${position}» пока никого нет в MAX — задача будет у вас.`;
  const first = await sheet(html`<h3>${title}</h3><p class="muted">${text}</p>`, [
    { label: "Да, отправить", kind: "primary", value: "yes" },
    { label: "Выбрать другого", value: "change" },
  ]);
  if (first === "yes") return people.length ? position : "owner";
  if (first !== "change") return null;
  const options = state.positions.map((p) => {
    const names = Audit.linkedOn(p);
    return { label: names.length ? `${p} — ${names.join(", ")}` : `${p} — никого в MAX`, value: p };
  });
  const picked = await sheet(html`<h3>Кому отправить?</h3>`, [
    ...options,
    { label: "Себе", value: "owner" },
    { label: "Отмена", value: null },
  ]);
  if (!picked || picked === "owner") return picked;
  if (Audit.linkedOn(picked).length) return picked;
  toast(`На должности «${picked}» пока никого нет в MAX — задача будет у вас`, { type: "info", duration: 4000 });
  return "owner";
}

// Audit results: index, violations and the act
Screens.auditSummary = {
  async render() {
    await loadScreen(
      "Итоги аудита",
      async () => {
        await Checklist.load();
        const state = await api("GET", "/api/owner/state");
        App.ownerState = state;
        Audit.summary = state.summary;
        if (state.summary.answered === state.summary.total && !state.summary.finished) {
          await api("POST", "/api/owner/audit/finish");
        }
        return state;
      },
      (state) => auditSummaryView(state)
    );
  },
};

function auditSummaryView(state) {
  const s = state.summary;
  const left = s.total - s.answered;
  const toStaff = state.defects.filter((d) => d.kind === "audit" && !d.to_owner).length;
  const toOwner = state.defects.filter((d) => d.kind === "audit" && d.to_owner).length;
  return html`<section class="card center">
      ${readinessRing(s)}
      <p>Соблюдается ${s.compliant} из ${s.applicable} применимых</p>
      ${left ? html`<p class="muted small">Осталось проверить: ${left} ${plural(left, "вопрос", "вопроса", "вопросов")}</p>` : ""}
    </section>
    ${state.defects.length
      ? html`<section class="card">
          <h2>❌ ${state.defects.length} ${plural(state.defects.length, "нарушение", "нарушения", "нарушений")} в работе</h2>
          <ul class="list">
            ${toStaff ? html`<li class="list-row"><span>Отправлены ответственным</span><strong>${toStaff}</strong></li>` : ""}
            ${toOwner ? html`<li class="list-row"><span>Ваши задачи</span><strong>${toOwner}</strong></li>` : ""}
          </ul>
        </section>`
      : ""}
    <div class="stack">
      ${left ? html`<button type="button" class="btn btn-primary" data-act="goAudit">Продолжить аудит</button>` : ""}
      <button type="button" class="btn ${left ? "btn-secondary" : "btn-primary"}" data-act="goHomeDefects">Открыть нарушения</button>
      <button type="button" class="btn btn-secondary" data-act="downloadAct">📄 Акт аудита (PDF)</button>
      <button type="button" class="btn-link" data-act="restartAudit">Пройти аудит заново</button>
    </div>`;
}

Actions.goHomeDefects = () => Router.go("home", {}, { reset: true });

Actions.restartAudit = async (el) => {
  const ok = await confirmSheet(
    "Пройти аудит заново?",
    "Ответы начнутся с чистого листа. Нарушения, которые сейчас в работе, останутся у сотрудников.",
    "Начать заново"
  );
  if (!ok) return;
  await busy(el, async () => {
    await api("POST", "/api/owner/audit/restart");
    Audit.order = [];
    await Router.go("audit", {}, { replace: true });
  });
};

// Circular readiness indicator with a traffic-light status
function readinessRing(summary) {
  const pct = summary.index;
  let tone = "gray";
  let label = "Аудит не начат";
  if (summary.started) {
    if (summary.ready) {
      tone = "green";
      label = "Готово к проверке";
    } else if (pct >= 70) {
      tone = "amber";
      label = "Почти готово";
    } else {
      tone = "red";
      label = "Есть что исправить";
    }
  }
  const circumference = 2 * Math.PI * 52;
  return html`<div class="ring ring-${tone}">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="52" class="ring-track"></circle>
      <circle cx="60" cy="60" r="52" class="ring-value" style="stroke-dasharray:${circumference};stroke-dashoffset:${circumference * (1 - pct / 100)}"></circle>
    </svg>
    <div class="ring-text"><strong>${pct}%</strong><span>готовность</span></div>
  </div>
  <p class="status status-${tone}">${label}</p>`;
}

// The link comes with the cabinet state, so the download starts right from the click
Actions.downloadAct = (el) =>
  busy(el, async () => {
    const file = App.ownerState.files.report;
    await Bridge.download(file.url, file.file_name);
  });

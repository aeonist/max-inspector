// Owner Management and Wizard Logic

// Open owner auth modal
function openOwnerAuthModal() {
  if (appState.facilityCode) {
    document.getElementById("authFacilityCode").value = appState.facilityCode;
  }
  showScreen("screenOwnerAuth");
}

// Submit owner auth
async function submitOwnerAuth() {
  const code = document.getElementById("authFacilityCode").value.trim();
  const pin = document.getElementById("authAdminPin").value.trim();
  if (!code || !pin) {
    alert("Заполните номер заведения и ПИН-код");
    return;
  }

  try {
    const data = await apiAuthFacility(code, pin);
    appState.facilityCode = code;
    appState.adminPin = pin;
    appState.role = "owner";
    localStorage.setItem("app_role", "owner");
    localStorage.setItem("app_code", code);
    localStorage.setItem("owner_pin_" + code, pin);
    await loadOwnerDashboard();
    showScreen("screenOwnerDashboard");
  } catch (e) {
    alert("Неверный номер заведения или ПИН-код администратора.");
  }
}

// GPS location detection
function detectOwnerLocation() {
  const box = document.getElementById("ownerGeoStatus");
  box.style.display = "block";
  box.className = "status-box";
  box.textContent = "Запрос координат устройства...";

  if (!navigator.geolocation) {
    box.className = "status-box error";
    box.textContent = "Служба геолокации недоступна в данном браузере.";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById("venueLat").value = pos.coords.latitude.toFixed(6);
      document.getElementById("venueLon").value = pos.coords.longitude.toFixed(6);
      box.className = "status-box success";
      box.textContent = `Координаты зафиксированы: ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
    },
    (err) => {
      box.className = "status-box error";
      box.textContent = `Координаты не получены (${err.message}). Введите значения вручную или пропустите шаг.`;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// Save Step 1 (Address, GPS, Custom PIN)
function saveOwnerStep1(skip) {
  const pinVal = document.getElementById("venuePin").value.trim();
  if (pinVal) {
    appState.adminPin = pinVal;
  } else if (!appState.adminPin) {
    appState.adminPin = "1234";
  }

  if (skip) {
    appState.venue.geoRequired = false;
    appState.venue.lat = null;
    appState.venue.lon = null;
  } else {
    const nameVal = document.getElementById("venueName").value.trim();
    if (nameVal) appState.venue.name = nameVal;
    appState.venue.address = document.getElementById("venueAddress").value.trim();
    const lat = parseFloat(document.getElementById("venueLat").value);
    const lon = parseFloat(document.getElementById("venueLon").value);
    if (!isNaN(lat) && !isNaN(lon)) {
      appState.venue.lat = lat;
      appState.venue.lon = lon;
      appState.venue.geoRequired = true;
    } else {
      appState.venue.geoRequired = false;
    }
  }
  renderPositionsList();
  renderSetupStaffList();
  populateSetupPositionSelect();
  showScreen("screenOwnerStep2");
}

// Render positions in Step 2
function renderPositionsList() {
  const cont = document.getElementById("positionsList");
  cont.innerHTML = "";
  appState.positions.forEach((pos, idx) => {
    const row = document.createElement("div");
    row.className = "position-row";
    row.innerHTML = `
      <span>${pos.name}</span>
      <div>
        <label style="display:inline; margin-right:6px; font-size:12px;">штат:</label>
        <input type="number" min="0" value="${pos.count}" onchange="updatePositionCount(${idx}, this.value)">
      </div>
    `;
    cont.appendChild(row);
  });
}

function updatePositionCount(idx, val) {
  appState.positions[idx].count = parseInt(val) || 0;
}

// Add new job title
function addNewPosition() {
  const input = document.getElementById("newPositionName");
  const name = input.value.trim();
  if (!name) return;
  appState.positions.push({ name: name, count: 1 });
  input.value = "";
  renderPositionsList();
  populateSetupPositionSelect();
}

// Render staff roster in Step 2
function renderSetupStaffList() {
  const cont = document.getElementById("setupStaffList");
  cont.innerHTML = "";
  if (appState.staffList.length === 0) {
    cont.innerHTML = "<p style='font-size:12px; color:#777777;'>Сотрудники еще не добавлены.</p>";
    return;
  }
  appState.staffList.forEach((st, idx) => {
    const card = document.createElement("div");
    card.className = "position-row";
    card.innerHTML = `
      <span><strong>${st.full_name}</strong> &mdash; ${st.position}</span>
      <button type="button" class="btn-back" style="padding:2px 8px; font-size:11px;" onclick="removeSetupStaffMember(${idx})">Удалить</button>
    `;
    cont.appendChild(card);
  });
}

function populateSetupPositionSelect() {
  const select = document.getElementById("setupNewStaffPosition");
  select.innerHTML = "";
  appState.positions.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
}

function addStaffMemberToSetup() {
  const nameInput = document.getElementById("setupNewStaffName");
  const posSelect = document.getElementById("setupNewStaffPosition");
  const name = nameInput.value.trim();
  const pos = posSelect.value;
  if (!name) {
    alert("Введите фамилию и имя сотрудника");
    return;
  }
  appState.staffList.push({ full_name: name, position: pos });
  nameInput.value = "";
  renderSetupStaffList();
}

function removeSetupStaffMember(idx) {
  appState.staffList.splice(idx, 1);
  renderSetupStaffList();
}

// Save Step 2
function saveOwnerStep2() {
  appState.venue.staffCount = appState.staffList.length;
  renderDutiesAssignment();
  showScreen("screenOwnerStep3");
}

// Render duties assignment in Step 3
function renderDutiesAssignment() {
  const cont = document.getElementById("dutiesAssignmentList");
  cont.innerHTML = "";

  appState.duties.forEach((duty, idx) => {
    const card = document.createElement("div");
    card.className = "item-card";

    let selectOptions = `<option value="Не назначено">Не назначено</option>`;
    appState.positions.forEach(p => {
      const selected = (duty.assignedTo === p.name) ? "selected" : "";
      selectOptions += `<option value="${p.name}" ${selected}>${p.name}</option>`;
    });

    card.innerHTML = `
      <div class="item-card-title">${duty.question}</div>
      <div class="item-card-meta">${duty.norm} (Зона: ${duty.zone})</div>
      <div class="item-card-fine">Штраф юридического лица: ${duty.fineText}</div>
      <label style="font-size:12px;">Ответственная должность:</label>
      <select onchange="appState.duties[${idx}].assignedTo = this.value">
        ${selectOptions}
      </select>
    `;
    cont.appendChild(card);
  });
}

function addCustomDuty() {
  const name = document.getElementById("customDutyName").value.trim();
  const fine = document.getElementById("customDutyFine").value.trim() || "10 000 – 30 000 руб.";
  if (!name) return;

  appState.duties.push({
    id: appState.duties.length + 1,
    zone: "Внутренний распорядок",
    question: name,
    norm: "Регламент предприятия",
    fineText: fine,
    fineAmount: 20000,
    assignedTo: appState.positions[0] ? appState.positions[0].name : "Не назначено"
  });

  document.getElementById("customDutyName").value = "";
  document.getElementById("customDutyFine").value = "";
  renderDutiesAssignment();
}

// Finish owner setup -> Save to DB and open dashboard or audit
async function finishOwnerSetup(openAuditNow = false) {
  try {
    await apiUpdateFacility(appState.facilityCode, {
      name: appState.venue.name,
      address: appState.venue.address,
      geo_lat: appState.venue.lat,
      geo_lon: appState.venue.lon,
      geo_required: appState.venue.geoRequired,
      admin_pin: appState.adminPin,
      staff_count: appState.staffList.length,
      positions: appState.positions,
      duties: appState.duties,
      staff_list: appState.staffList
    });

    localStorage.setItem("app_role", "owner");
    localStorage.setItem("app_code", appState.facilityCode);
    if (appState.adminPin) {
      localStorage.setItem("owner_pin_" + appState.facilityCode, appState.adminPin);
    }
  } catch (e) {
    console.error("Failed to finish setup:", e);
  }

  await loadOwnerDashboard();
  if (openAuditNow) {
    openOwnerAuditScreen();
  } else {
    showScreen("screenOwnerDashboard");
  }
}

// Switch dashboard tabs
function switchDashboardTab(tabName) {
  const btnShift = document.getElementById("tabBtnShift");
  const btnMgmt = document.getElementById("tabBtnManagement");
  const contentShift = document.getElementById("tabContentShift");
  const contentMgmt = document.getElementById("tabContentManagement");

  if (tabName === "shift") {
    btnShift.classList.add("active");
    btnMgmt.classList.remove("active");
    contentShift.classList.add("active");
    contentMgmt.classList.remove("active");
  } else {
    btnMgmt.classList.add("active");
    btnShift.classList.remove("active");
    contentMgmt.classList.add("active");
    contentShift.classList.remove("active");
  }
}

// Load owner dashboard data
async function loadOwnerDashboard() {
  document.getElementById("dashVenueName").textContent = appState.venue.name;
  document.getElementById("dashFacilityCode").textContent = appState.facilityCode;

  try {
    const data = await apiGetFacility(appState.facilityCode);
    appState.backendStaff = data.staff || [];
    if (data.name) appState.venue.name = data.name;
    if (data.address) appState.venue.address = data.address;
    appState.venue.lat = data.geo_lat;
    appState.venue.lon = data.geo_lon;
    appState.venue.geoRequired = data.geo_required;
    appState.positions = data.positions || appState.positions;
    appState.duties = data.duties || appState.duties;
    if (data.audit_answers) appState.auditAnswers = data.audit_answers;
    if (typeof data.audit_progress === "number") appState.auditProgress = data.audit_progress;
  } catch (e) {
    console.error("Failed to load dashboard:", e);
  }

  renderAuditReminderBanner();
  renderDashboardShiftTab();
  renderDashboardManagementTab();
}

// Render audit reminder banner with progress bar
function renderAuditReminderBanner() {
  const banner = document.getElementById("ownerAuditBanner");
  if (!banner) return;

  const total = (appState.duties && appState.duties.length > 0) ? appState.duties.length : 40;
  const answers = appState.auditAnswers || {};
  const answeredCount = Object.keys(answers).filter(k => answers[k]).length;
  const pct = Math.min(100, Math.round((answeredCount / total) * 100));
  appState.auditProgress = pct;

  const titleElem = document.getElementById("auditBannerTitle");
  const badgeElem = document.getElementById("auditBannerBadge");
  const textElem = document.getElementById("auditBannerText");
  const fillElem = document.getElementById("auditProgressBar");
  const countElem = document.getElementById("auditBannerCount");
  const btnElem = document.getElementById("auditBannerBtn");

  if (fillElem) fillElem.style.width = pct + "%";
  if (badgeElem) badgeElem.textContent = pct + "% пройдено";
  if (countElem) countElem.textContent = `Проверено: ${answeredCount} из ${total} пунктов`;

  if (pct >= 100) {
    banner.classList.add("completed");
    if (titleElem) titleElem.textContent = "Самообследование объекта пройдено на 100%";
    if (badgeElem) badgeElem.textContent = "100% готовность";
    if (textElem) textElem.textContent = "Все 40 обязательных санитарных требований СанПиН 2.3/2.4.3590-20 проверены. Объект готов к надзорным проверкам и формированию Декларации (ст. 51 248-ФЗ).";
    if (btnElem) btnElem.textContent = "Просмотреть аудит";
  } else {
    banner.classList.remove("completed");
    if (titleElem) titleElem.textContent = "Самообследование объекта не завершено";
    if (textElem) textElem.textContent = "Для исключения штрафов до 300 000 ₽ и снижения категории риска пройдите проверку всех обязательных пунктов СанПиН 2.3/2.4.3590-20.";
    if (btnElem) btnElem.textContent = (answeredCount === 0) ? "Пройти самообследование" : "Продолжить самообследование";
  }
}

// Open owner audit screen
function openOwnerAuditScreen() {
  renderOwnerAuditList();
  showScreen("screenOwnerAudit");
}

// Render section filter pills and question cards
function renderOwnerAuditList() {
  const duties = appState.duties || [];
  const answers = appState.auditAnswers || {};

  // Extract unique sections
  const sectionsMap = {};
  duties.forEach(d => {
    const sec = d.section || d.zone || "Общие нормы";
    if (!sectionsMap[sec]) {
      sectionsMap[sec] = { total: 0, answered: 0 };
    }
    sectionsMap[sec].total++;
    if (answers[d.id]) {
      sectionsMap[sec].answered++;
    }
  });

  // Render filter pills
  const filterCont = document.getElementById("auditSectionFilterBar");
  if (filterCont) {
    filterCont.innerHTML = "";
    const allTotal = duties.length;
    const allAnswered = Object.keys(answers).filter(k => answers[k]).length;

    const allPill = document.createElement("button");
    allPill.type = "button";
    allPill.className = "section-pill" + (appState.currentAuditSection === "all" ? " active" : "");
    allPill.textContent = `Все разделы (${allAnswered}/${allTotal})`;
    allPill.onclick = () => setAuditSectionFilter("all");
    filterCont.appendChild(allPill);

    Object.keys(sectionsMap).forEach(secName => {
      const stats = sectionsMap[secName];
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "section-pill" + (appState.currentAuditSection === secName ? " active" : "");
      pill.textContent = `${secName} (${stats.answered}/${stats.total})`;
      pill.onclick = () => setAuditSectionFilter(secName);
      filterCont.appendChild(pill);
    });
  }

  // Update top progress on screen
  const total = duties.length || 40;
  const answeredCount = Object.keys(answers).filter(k => answers[k]).length;
  const pct = Math.min(100, Math.round((answeredCount / total) * 100));

  const screenBar = document.getElementById("auditScreenProgressBar");
  if (screenBar) screenBar.style.width = pct + "%";
  const countText = document.getElementById("auditScreenCountText");
  if (countText) countText.textContent = `Проверено: ${answeredCount} из ${total} пунктов`;
  const pctText = document.getElementById("auditScreenPercentText");
  if (pctText) pctText.textContent = pct + "%";

  // Filter duties
  let filteredDuties = duties;
  if (appState.currentAuditSection && appState.currentAuditSection !== "all") {
    filteredDuties = duties.filter(d => (d.section || d.zone) === appState.currentAuditSection);
  }

  const listCont = document.getElementById("ownerAuditQuestionsList");
  if (!listCont) return;
  listCont.innerHTML = "";

  if (filteredDuties.length === 0) {
    listCont.innerHTML = "<p style='font-size:13px; color:#777777;'>В данном разделе нет пунктов.</p>";
    return;
  }

  filteredDuties.forEach((duty) => {
    const card = document.createElement("div");
    const currentAns = answers[duty.id] || "";
    let statusClass = "";
    if (currentAns === "compliant") statusClass = " status-compliant";
    else if (currentAns === "violation") statusClass = " status-violation";
    else if (currentAns === "na") statusClass = " status-na";

    card.className = "audit-card" + statusClass;

    let violationBlock = "";
    if (currentAns === "violation") {
      violationBlock = `
        <div class="violation-detail-box">
          <div style="color: #990000; font-weight: 700; margin-bottom: 4px;">Выявлено нарушение:</div>
          <div>${duty.violation}</div>
          <div class="remediation-box">
            <strong>Регламент исправления:</strong> ${duty.remediation}
          </div>
          <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
            <button type="button" class="btn btn-small" style="background:#0077ff; color:#ffffff;" onclick="notifyDefectToEmployees(${duty.id})">Оповестить сотрудников в MAX</button>
            <button type="button" class="btn btn-small btn-secondary" onclick="shareDefectToChat(${duty.id})">Поделиться в чат смены</button>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
        <span style="font-size:11px; font-weight:700; color:#555555; text-transform:uppercase;">${duty.section || duty.zone} &bull; Пункт №${duty.id}</span>
        <span style="font-size:11px; color:#880000; font-weight:600;">Штраф: ${duty.fineText}</span>
      </div>
      <div class="item-card-title">${duty.question}</div>
      <div class="item-card-meta">${duty.norm}</div>

      ${violationBlock}

      <div class="audit-actions">
        <button type="button" class="btn-choice ${currentAns === 'compliant' ? 'active-compliant' : ''}" onclick="setAuditAnswer(${duty.id}, 'compliant')">
          Соблюдается (норма)
        </button>
        <button type="button" class="btn-choice ${currentAns === 'violation' ? 'active-violation' : ''}" onclick="setAuditAnswer(${duty.id}, 'violation')">
          Нарушение (дефект)
        </button>
        <button type="button" class="btn-choice ${currentAns === 'na' ? 'active-na' : ''}" onclick="setAuditAnswer(${duty.id}, 'na')">
          Не применимо
        </button>
      </div>
    `;
    listCont.appendChild(card);
  });
}

// Set answer for an audit question
async function setAuditAnswer(dutyId, choice) {
  if (!appState.auditAnswers) appState.auditAnswers = {};
  appState.auditAnswers[dutyId] = choice;

  const total = (appState.duties && appState.duties.length > 0) ? appState.duties.length : 40;
  const answered = Object.keys(appState.auditAnswers).filter(k => appState.auditAnswers[k]).length;
  appState.auditProgress = Math.min(100, Math.round((answered / total) * 100));

  renderOwnerAuditList();
  renderAuditReminderBanner();

  if (appState.facilityCode) {
    try {
      await apiSaveFacilityAudit(appState.facilityCode, appState.auditAnswers, appState.auditProgress);
    } catch (e) {
      console.warn("Auto-save audit failed:", e);
    }
  }
}

// Switch section filter in audit screen
function setAuditSectionFilter(sectionName) {
  appState.currentAuditSection = sectionName;
  renderOwnerAuditList();
}

// Send defect push notification to facility employees via MAX bot
async function notifyDefectToEmployees(dutyId) {
  const duty = appState.duties.find(d => d.id === dutyId);
  if (!duty || !appState.facilityCode) return;
  try {
    const res = await apiNotifyFacilityDefect(appState.facilityCode, {
      duty_id: duty.id,
      title: duty.question,
      violation: duty.violation,
      remediation: duty.remediation,
      assigned_role: duty.assignedTo || duty.default_role || "Персонал кухни / зала",
      reporter_name: "Руководитель (" + (appState.venue.name || "Объект") + ")"
    });
    alert(res.message || "Оповещение с регламентом исправления успешно направлено сотрудникам заведения в MAX.");
  } catch (e) {
    alert("Ошибка отправки: " + e.message);
  }
}

// Share defect report to work chat
function shareDefectToChat(dutyId) {
  const duty = appState.duties.find(d => d.id === dutyId);
  if (!duty) return;
  const text = "Внимание! Требуется устранить нарушение (СанПиН 2.3/2.4.3590-20):\n\n" +
    "Объект: " + (appState.venue.name || appState.facilityCode) + "\n" +
    "Пункт: " + duty.question + "\n" +
    "Норма: " + duty.norm + "\n\n" +
    "Выявленный дефект: " + duty.violation + "\n\n" +
    "Регламент исправления:\n" + duty.remediation + "\n\n" +
    "Ответственная роль: " + (duty.assignedTo || duty.default_role || "Сотрудник") + "\n" +
    "Риск штрафа: " + duty.fineText;

  if (navigator.share) {
    navigator.share({
      title: "Предписание по устранению нарушения",
      text: text
    }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      alert("Текст предписания скопирован в буфер обмена. Вставьте его в рабочий чат смены.");
    }).catch(() => {
      prompt("Скопируйте текст предписания для отправки в чат:", text);
    });
  } else {
    prompt("Скопируйте текст предписания для отправки в чат:", text);
  }
}

// Finish audit and return to dashboard
async function finishAuditAndReturn() {
  if (appState.facilityCode) {
    try {
      await apiSaveFacilityAudit(appState.facilityCode, appState.auditAnswers, appState.auditProgress);
    } catch (e) {}
  }
  await loadOwnerDashboard();
  showScreen("screenOwnerDashboard");
}

async function refreshDashboardData() {
  await loadOwnerDashboard();
}

// Render Tab 1 (Active shifts & compliance)
function renderDashboardShiftTab() {
  const staff = appState.backendStaff;
  const activeStaff = staff.filter(s => s.shift_active);

  let totalTasksDone = 0;
  let totalFinesSaved = 0;

  activeStaff.forEach(s => {
    const doneTasks = s.completed_tasks || [];
    totalTasksDone += doneTasks.length;
    doneTasks.forEach(tId => {
      const duty = appState.duties.find(d => d.id === tId);
      totalFinesSaved += duty ? duty.fineAmount : 30000;
    });
  });

  document.getElementById("metricStaffCount").textContent = `${activeStaff.length} из ${staff.length}`;
  document.getElementById("metricFinesSaved").textContent = `${totalFinesSaved.toLocaleString("ru-RU")} руб.`;

  const listCont = document.getElementById("activeStaffList");
  listCont.innerHTML = "";

  if (activeStaff.length === 0) {
    listCont.innerHTML = `
      <div class="status-box">
        В данный момент на смене нет активных сотрудников.<br>
        Сотрудники открывают смену через подтверждение геолокации в боте МАХ.
      </div>
    `;
    return;
  }

  activeStaff.forEach(s => {
    const card = document.createElement("div");
    card.className = "item-card";

    const tasksDone = (s.completed_tasks || []).length;
    const distText = s.last_geo_distance !== null ? `${s.last_geo_distance} м` : "без гео";

    let photosHtml = "";
    const photos = s.task_photos || {};
    const photoKeys = Object.keys(photos);
    if (photoKeys.length > 0) {
      photosHtml = `<div class="photo-upload-row">Прикреплено фотоотчетов: <strong>${photoKeys.length}</strong></div>`;
    }

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="item-card-title">${s.full_name}</div>
        <span class="badge-active">На смене с ${s.shift_started_at || "08:00"}</span>
      </div>
      <div class="item-card-meta">Должность: <strong>${s.position}</strong></div>
      <div class="item-card-meta">Дистанция при входе: <strong>${distText}</strong></div>
      <div class="item-card-meta">Выполнено обязательных требований: <strong>${tasksDone}</strong></div>
      ${photosHtml}
    `;
    listCont.appendChild(card);
  });
}

// Render Tab 2 (Management & staff roster)
function renderDashboardManagementTab() {
  document.getElementById("mgmtAddress").textContent = appState.venue.address || "Не указан";
  document.getElementById("mgmtCoords").textContent = (appState.venue.lat && appState.venue.lon)
    ? `${appState.venue.lat}, ${appState.venue.lon}`
    : "Не заданы";
  document.getElementById("mgmtGeoStatus").textContent = appState.venue.geoRequired
    ? "Включен (радиус 100 м)"
    : "Отключен";

  const tbody = document.getElementById("mgmtStaffTableBody");
  tbody.innerHTML = "";

  const staff = appState.backendStaff;
  if (staff.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#777777;">Сотрудники не внесены</td></tr>`;
  } else {
    staff.forEach(s => {
      const tr = document.createElement("tr");
      const statusBadge = s.user_id
        ? `<span class="badge-linked">Привязан</span>`
        : `<span class="badge-unlinked">Ожидает входа</span>`;

      let actionBtn = s.user_id
        ? `<button class="btn-back" style="padding:2px 6px; font-size:11px;" onclick="unlinkStaffMember(${s.id})">Сбросить</button>`
        : `<span style="font-size:11px; color:#888888;">&mdash;</span>`;

      tr.innerHTML = `
        <td><strong>${s.full_name}</strong></td>
        <td>${s.position}</td>
        <td>${statusBadge}</td>
        <td>${actionBtn}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Populate position dropdown in dashboard
  const select = document.getElementById("dashNewStaffPosition");
  select.innerHTML = "";
  appState.positions.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
}

// Unlink staff member
async function unlinkStaffMember(employeeId) {
  if (!confirm("Сбросить привязку пользователя к этой должности? Сотрудник сможет привязаться заново.")) {
    return;
  }
  try {
    await apiUnlinkStaff(appState.facilityCode, employeeId);
    await loadOwnerDashboard();
  } catch (e) {
    alert("Ошибка сброса привязки");
  }
}

// Add staff from dashboard
async function addStaffMemberFromDashboard() {
  const nameInput = document.getElementById("dashNewStaffName");
  const posSelect = document.getElementById("dashNewStaffPosition");
  const name = nameInput.value.trim();
  const pos = posSelect.value;

  if (!name) {
    alert("Введите фамилию и имя сотрудника");
    return;
  }

  try {
    await apiAddStaff(appState.facilityCode, name, pos);
    nameInput.value = "";
    await loadOwnerDashboard();
  } catch (e) {
    alert("Ошибка добавления сотрудника");
  }
}

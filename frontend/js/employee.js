// Employee Workflow and Shift Logic

// Load roster for employee registration
async function loadFacilityRosterForEmployee() {
  const code = document.getElementById("empFacilityCode").value.trim();
  if (!code) {
    alert("Введите номер заведения");
    return;
  }

  try {
    const data = await apiGetFacility(code);
    appState.facilityCode = code;
    document.getElementById("empFoundVenueName").textContent = data.name;
    document.getElementById("empFoundVenueAddress").textContent = data.address || "Адрес не указан";

    const select = document.getElementById("empRosterSelect");
    select.innerHTML = "";

    const staff = data.staff || [];
    if (staff.length === 0) {
      select.innerHTML = `<option value="">Список сотрудников пуст (обратитесь к руководителю)</option>`;
    } else {
      staff.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.id;
        const statusText = s.user_id ? "зарегистрирован" : "свободен";
        opt.textContent = `${s.full_name} — ${s.position} (${statusText})`;
        select.appendChild(opt);
      });
    }

    document.getElementById("empRosterSection").style.display = "block";
  } catch (e) {
    alert("Заведение с таким номером не найдено в реестре.");
  }
}

// Confirm claiming employee profile
async function confirmEmployeeRosterClaim() {
  const select = document.getElementById("empRosterSelect");
  const empId = parseInt(select.value);

  if (!empId) {
    alert("Выберите вашу фамилию из списка сотрудников.");
    return;
  }

  try {
    const data = await apiClaimEmployee(appState.facilityCode, empId, appState.user_id);
    appState.employee.name = data.full_name;
    appState.employee.position = data.position;
    appState.employee.facilityCode = appState.facilityCode;

    localStorage.setItem("app_role", "employee");
    localStorage.setItem("app_code", appState.facilityCode);
    localStorage.setItem("app_emp_name", data.full_name);

    const box = document.getElementById("empClaimStatusBox");
    box.style.display = "block";
    box.innerHTML = `
      <strong>Профиль успешно привязан:</strong> ${data.full_name} (${data.position}).<br>
      Сообщение с кнопкой подтверждения присутствия отправлено в чат с ботом.<br><br>
      <button class="btn" onclick="closeWebAppAndReturnToBot()">Перейти в чат для выхода на смену</button>
    `;
    document.getElementById("empRosterSection").style.display = "none";
  } catch (e) {
    alert("Ошибка привязки профиля.");
  }
}

// Render employee shift workspace
function renderEmployeeShiftScreen() {
  const emp = appState.employee;
  const card = document.getElementById("empProfileCard");
  card.innerHTML = `
    <div class="item-card-title">${emp.name}</div>
    <div class="item-card-meta">Должность: <strong>${emp.position}</strong></div>
    <div class="item-card-meta">Номер заведения: <strong>${emp.facilityCode}</strong></div>
  `;

  const statusBox = document.getElementById("shiftStatusBox");
  const tasksSection = document.getElementById("employeeTasksSection");

  if (emp.shiftStarted) {
    statusBox.className = "status-box success";
    statusBox.textContent = `Присутствие на объекте подтверждено через платформу MAX. Смена открыта в ${emp.shiftStartTime || "08:00"}.`;
    tasksSection.style.display = "block";
    renderEmployeeTasks();
  } else {
    statusBox.className = "status-box error";
    statusBox.innerHTML = `
      Регистрация завершена. Смена еще не открыта.<br>
      Для выхода на смену подтвердите геолокацию в диалоге с ботом.
      <button class="btn" style="margin-top: 10px;" onclick="closeWebAppAndReturnToBot()">Перейти в чат для выхода на смену</button>
    `;
    tasksSection.style.display = "none";
  }
}

// Render duties/tasks for employee's role with full remediation cycle
function renderEmployeeTasks() {
  const cont = document.getElementById("employeeTasksList");
  cont.innerHTML = "";

  const myRole = appState.employee.position;
  const myTasks = appState.duties.filter(d => d.assignedTo === myRole);

  if (myTasks.length === 0) {
    cont.innerHTML = "<p>На вашу должность нет назначенных обязательных требований.</p>";
    return;
  }

  myTasks.forEach(task => {
    const isDone = appState.employee.completedTasks.includes(task.id);
    const photoUrl = appState.employee.taskPhotos[task.id];
    const isAuditViolation = (appState.auditAnswers && appState.auditAnswers[task.id] === "violation");
    const isManualDefect = Boolean(appState.employeeDefects && appState.employeeDefects[task.id]);
    const hasActiveDefect = (isAuditViolation || isManualDefect) && !isDone;
    const isResolved = isDone && (isAuditViolation || isManualDefect || Boolean(photoUrl));

    const card = document.createElement("div");

    if (hasActiveDefect) {
      card.className = "duty-card has-defect";
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span class="defect-badge violation">Зафиксировано нарушение</span>
          <span style="font-size: 11px; color: #880000; font-weight: 600;">Штраф: ${task.fineText}</span>
        </div>
        <div class="duty-title">${task.question}</div>
        <div class="duty-norm">Норма: ${task.norm} (Зона: ${task.zone})</div>

        <div class="violation-detail-box">
          <div style="font-weight: 700; color: #990000; margin-bottom: 4px;">Суть дефекта:</div>
          <div>${task.violation}</div>

          <div class="remediation-box">
            <strong>Пошаговый регламент исправления:</strong><br>
            ${task.remediation}
          </div>

          <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
            <button type="button" class="btn btn-small" style="background:#0077ff; color:#ffffff;" onclick="notifyEmployeeTaskDefect(${task.id})">
              Оповестить коллег в MAX
            </button>
            <button type="button" class="btn btn-small btn-secondary" onclick="shareEmployeeTaskDefect(${task.id})">
              Отправить в чат смены
            </button>
          </div>
        </div>

        <div class="photo-upload-row">
          <label style="font-size: 11px; color: #333333; font-weight: 600;">1. Прикрепите фото подтверждения исправления:</label>
          <input type="file" accept="image/*" onchange="uploadTaskPhoto(${task.id}, this)">
          ${photoUrl ? `<a href="${photoUrl}" target="_blank" class="photo-preview-link">Просмотреть фото исправления</a>` : ""}
        </div>

        <div style="margin-top: 10px; display: flex; gap: 8px;">
          <button type="button" class="btn btn-small" style="background:#137333; color:#ffffff; width:100%;" onclick="resolveTaskDefect(${task.id})">
            2. Подтвердить устранение дефекта
          </button>
        </div>
      `;
    } else if (isResolved) {
      card.className = "duty-card done resolved";
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span class="defect-badge resolved">Дефект устранен</span>
          <span style="font-size: 11px; color: #137333; font-weight: 600;">Норма соблюдена</span>
        </div>
        <div class="duty-title">${task.question}</div>
        <div class="duty-norm">Норма: ${task.norm} (Зона: ${task.zone})</div>
        <div style="font-size: 12px; color: #137333; margin: 6px 0;">
          Нарушение исправлено согласно регламенту СанПиН. Замечание снято.
        </div>
        ${photoUrl ? `<div style="margin-top:4px;"><a href="${photoUrl}" target="_blank" class="photo-preview-link">Просмотреть прикрепленное фото</a></div>` : ""}
        <button type="button" class="btn-defect-toggle" onclick="toggleTaskDone(${task.id}, false)">
          Снять отметку о выполнении
        </button>
      `;
    } else {
      card.className = "duty-card" + (isDone ? " done" : "");
      let photoSection = `
        <div class="photo-upload-row">
          <label style="font-size:11px; color:#555555;">Фото подтверждение выполнения:</label>
          <input type="file" accept="image/*" onchange="uploadTaskPhoto(${task.id}, this)">
          ${photoUrl ? `<a href="${photoUrl}" target="_blank" class="photo-preview-link">Просмотреть прикрепленное фото</a>` : ""}
        </div>
      `;

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span class="defect-badge compliant">Контроль СанПиН</span>
          <span style="font-size: 11px; color: #880000; font-weight: 600;">Штраф: ${task.fineText}</span>
        </div>
        <div class="duty-title">${task.question}</div>
        <div class="duty-norm">Норма: ${task.norm} (Зона: ${task.zone})</div>
        <label class="duty-check-label">
          <input type="checkbox" ${isDone ? "checked" : ""} onchange="toggleTaskDone(${task.id}, this.checked)">
          ${isDone ? "Требование выполнено" : "Отметить выполнение"}
        </label>
        ${photoSection}
        <div>
          <button type="button" class="btn-defect-toggle" onclick="toggleManualDefect(${task.id}, true)">
            Зафиксировать нарушение / дефект
          </button>
        </div>
      `;
    }

    cont.appendChild(card);
  });
}

// Toggle manual defect on duty card
function toggleManualDefect(taskId, flag) {
  if (!appState.employeeDefects) appState.employeeDefects = {};
  appState.employeeDefects[taskId] = flag;
  renderEmployeeTasks();
}

// Resolve defect after employee completes corrective actions
async function resolveTaskDefect(taskId) {
  if (!appState.employee.shiftStarted) {
    alert("Смена не открыта. Подтверждение доступно только на объекте.");
    return;
  }

  if (!appState.employee.completedTasks.includes(taskId)) {
    appState.employee.completedTasks.push(taskId);
  }
  if (!appState.employeeDefects) appState.employeeDefects = {};
  appState.employeeDefects[taskId] = false;

  if (!appState.auditAnswers) appState.auditAnswers = {};
  appState.auditAnswers[taskId] = "compliant";

  renderEmployeeTasks();

  if (appState.user_id) {
    try {
      await apiSaveEmployeeTasks(
        appState.user_id,
        appState.employee.completedTasks,
        appState.employee.taskPhotos
      );
    } catch (e) {
      console.warn("Save employee tasks failed:", e);
    }
  }

  if (appState.facilityCode) {
    try {
      await apiSaveFacilityAudit(appState.facilityCode, appState.auditAnswers, appState.auditProgress);
    } catch (e) {
      console.warn("Save audit status failed:", e);
    }
  }

  alert("Дефект успешно устранен. Статус соответствия СанПиН подтвержден.");
}

// Send defect push notification to shift employees via MAX bot
async function notifyEmployeeTaskDefect(taskId) {
  const task = appState.duties.find(d => d.id === taskId);
  if (!task || !appState.facilityCode) return;
  try {
    const res = await apiNotifyFacilityDefect(appState.facilityCode, {
      duty_id: task.id,
      title: task.question,
      violation: task.violation,
      remediation: task.remediation,
      assigned_role: task.assignedTo || appState.employee.position,
      reporter_name: `Сотрудник: ${appState.employee.name || "Смена"}`
    });
    alert(res.message || "Оповещение с регламентом исправления направлено коллегам по объекту в MAX.");
  } catch (e) {
    alert("Ошибка отправки: " + e.message);
  }
}

// Share defect report to work chat
function shareEmployeeTaskDefect(taskId) {
  const task = appState.duties.find(d => d.id === taskId);
  if (!task) return;
  const text = "Внимание! На объекте выявлено нарушение (СанПиН 2.3/2.4.3590-20):\n\n" +
    "Объект: " + (appState.venue.name || appState.facilityCode) + "\n" +
    "Зона: " + task.zone + "\n" +
    "Требование: " + task.question + "\n\n" +
    "Суть дефекта: " + task.violation + "\n\n" +
    "Инструкция по устранению:\n" + task.remediation + "\n\n" +
    "Ответственный: " + (task.assignedTo || appState.employee.position) + "\n" +
    "Риск штрафа: " + task.fineText;

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

// Toggle completion of a task
async function toggleTaskDone(taskId, checked) {
  if (!appState.employee.shiftStarted) {
    alert("Смена не открыта. Отметка требований доступна только на объекте.");
    return;
  }

  if (checked) {
    if (!appState.employee.completedTasks.includes(taskId)) {
      appState.employee.completedTasks.push(taskId);
    }
  } else {
    appState.employee.completedTasks = appState.employee.completedTasks.filter(id => id !== taskId);
  }
  renderEmployeeTasks();

  if (appState.user_id) {
    try {
      await apiSaveEmployeeTasks(
        appState.user_id,
        appState.employee.completedTasks,
        appState.employee.taskPhotos
      );
    } catch (e) {
      alert(e.message);
    }
  }
}

// Upload photo verification
async function uploadTaskPhoto(taskId, inputElem) {
  if (!appState.employee.shiftStarted) {
    alert("Смена не открыта. Прикрепление фото доступно только на объекте.");
    return;
  }

  if (!inputElem.files || inputElem.files.length === 0) return;
  const file = inputElem.files[0];

  try {
    const data = await apiUploadPhoto(file);
    appState.employee.taskPhotos[taskId] = data.url;

    if (!appState.employee.completedTasks.includes(taskId)) {
      appState.employee.completedTasks.push(taskId);
    }
    renderEmployeeTasks();

    if (appState.user_id) {
      await apiSaveEmployeeTasks(
        appState.user_id,
        appState.employee.completedTasks,
        appState.employee.taskPhotos
      );
    }
  } catch (e) {
    alert("Ошибка загрузки фото");
  }
}

// End shift from web
async function endEmployeeShiftFromWeb() {
  if (!confirm("Завершить смену? Данные о выполненных требованиях будут сохранены в системе.")) {
    return;
  }
  if (appState.user_id) {
    try {
      await apiEndShift(appState.user_id);
    } catch (e) {
      console.error("Failed to end shift:", e);
    }
  }
  closeWebAppAndReturnToBot();
}


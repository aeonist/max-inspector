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

// Render duties/tasks for employee's role
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

    const card = document.createElement("div");
    card.className = "duty-card" + (isDone ? " done" : "");

    let photoSection = `
      <div class="photo-upload-row">
        <label style="font-size:11px; color:#555555;">Фото подтверждение выполнения:</label>
        <input type="file" accept="image/*" onchange="uploadTaskPhoto(${task.id}, this)">
        ${photoUrl ? `<a href="${photoUrl}" target="_blank" class="photo-preview-link">Просмотреть прикрепленное фото</a>` : ""}
      </div>
    `;

    card.innerHTML = `
      <div class="duty-title">${task.question}</div>
      <div class="duty-norm">Норма: ${task.norm} (Зона: ${task.zone})</div>
      <div class="duty-fine">Предотвращенный штраф по ст. 6.6 КоАП РФ: ${task.fineText}</div>
      <label class="duty-check-label">
        <input type="checkbox" ${isDone ? "checked" : ""} onchange="toggleTaskDone(${task.id}, this.checked)">
        ${isDone ? "Требование выполнено" : "Отметить выполнение"}
      </label>
      ${photoSection}
    `;
    cont.appendChild(card);
  });
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

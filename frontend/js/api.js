// API Client Functions

async function apiGetFacility(code) {
  const res = await fetch(`/api/facility/${code}`);
  if (!res.ok) throw new Error("Заведение не найдено");
  return await res.json();
}

async function apiAuthFacility(code, pin) {
  const res = await fetch("/api/facility/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code, admin_pin: pin })
  });
  if (!res.ok) throw new Error("Неверный номер или ПИН-код");
  return await res.json();
}

async function apiUpdateFacility(code, payload) {
  const res = await fetch(`/api/facility/${code}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Ошибка сохранения заведения");
  return await res.json();
}

async function apiAddStaff(code, fullName, position) {
  const res = await fetch(`/api/facility/${code}/staff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName, position: position })
  });
  if (!res.ok) throw new Error("Ошибка добавления сотрудника");
  return await res.json();
}

async function apiUnlinkStaff(code, employeeId) {
  const res = await fetch(`/api/facility/${code}/staff/${employeeId}/unlink`, {
    method: "POST"
  });
  if (!res.ok) throw new Error("Ошибка сброса привязки сотрудника");
  return await res.json();
}

async function apiClaimEmployee(code, employeeId, userId) {
  const res = await fetch("/api/employee/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: code,
      employee_id: employeeId,
      user_id: userId
    })
  });
  if (!res.ok) throw new Error("Ошибка привязки сотрудника");
  return await res.json();
}

async function apiGetEmployee(userId) {
  const res = await fetch(`/api/employee/${userId}`);
  if (!res.ok) throw new Error("Сотрудник не найден");
  return await res.json();
}

async function apiEndShift(userId) {
  const res = await fetch(`/api/employee/${userId}/shift/end`, { method: "POST" });
  if (!res.ok) throw new Error("Ошибка завершения смены");
  return await res.json();
}

async function apiSaveEmployeeTasks(userId, completedTasks, taskPhotos) {
  const res = await fetch(`/api/employee/${userId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      completed_task_ids: completedTasks,
      task_photos: taskPhotos
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка сохранения задач");
  }
  return await res.json();
}

async function apiUploadPhoto(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData
  });
  if (!res.ok) throw new Error("Ошибка загрузки фото");
  return await res.json();
}

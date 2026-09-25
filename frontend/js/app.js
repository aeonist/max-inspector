// Main App Navigation and Entrypoint

// Ready MAX WebApp
if (window.WebApp) {
  window.WebApp.ready();
}

// Show specific screen
function showScreen(screenId, pushHistory = true) {
  const current = document.querySelector(".screen.active");
  if (current && pushHistory && current.id !== screenId) {
    appState.history.push(current.id);
  }
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");

  const backBtn = document.getElementById("globalBackBtn");
  backBtn.disabled = (appState.history.length === 0 || screenId === "screenLanding" || screenId === "screenOwnerDashboard");
}

// Go back in navigation stack
function navigateBack() {
  if (appState.history.length > 0) {
    const prev = appState.history.pop();
    showScreen(prev, false);
  }
}

// Close WebApp and return to chat bot
function closeWebAppAndReturnToBot() {
  // 1. Try closing via native MAX WebApp SDK
  try {
    if (window.WebApp && typeof window.WebApp.close === "function") {
      window.WebApp.close();
    }
  } catch (e) {
    console.warn("WebApp.close error:", e);
  }

  // 2. Try window.close() if opened as a popup or separate window
  try {
    window.close();
  } catch (e) {}

  // 3. Fallback redirect: if window is still open after 80ms (e.g. desktop browser, iframe)
  setTimeout(() => {
    try {
      window.location.href = "https://max.ru/t658_hakaton_max_bot";
    } catch (e) {
      window.open("https://max.ru/t658_hakaton_max_bot", "_self");
    }
  }, 80);
}


// Handle landing code submit
function handleLandingCodeSubmit() {
  const code = document.getElementById("landingFacilityCode").value.trim();
  if (!code) {
    alert("Введите номер заведения");
    return;
  }
  appState.facilityCode = code;
  document.getElementById("empFacilityCode").value = code;
  loadFacilityRosterForEmployee();
  showScreen("screenEmployeeRegister");
}

// Application startup
window.addEventListener("DOMContentLoaded", async () => {
  await loadChecklists();

  const urlParams = new URLSearchParams(window.location.search);
  let role = urlParams.get("role") || localStorage.getItem("app_role");
  let code = urlParams.get("code") || localStorage.getItem("app_code");
  let userId = parseInt(urlParams.get("user_id")) || parseInt(localStorage.getItem("app_user_id")) || 0;
  const mode = urlParams.get("mode");

  appState.user_id = userId;
  if (userId) localStorage.setItem("app_user_id", String(userId));

  let facilityLoaded = false;
  if (code) {
    appState.facilityCode = code;
    try {
      const data = await apiGetFacility(code);
      appState.venue.name = data.name;
      appState.venue.address = data.address || "";
      appState.venue.lat = data.geo_lat;
      appState.venue.lon = data.geo_lon;
      appState.venue.geoRequired = data.geo_required;
      if (data.positions && data.positions.length > 0) {
        appState.positions = data.positions;
      }
      if (data.duties && data.duties.length > 0) {
        appState.duties = data.duties;
      }
      if (data.audit_answers) {
        appState.auditAnswers = data.audit_answers;
      }
      if (typeof data.audit_progress === "number") {
        appState.auditProgress = data.audit_progress;
      }
      appState.backendStaff = data.staff || [];
      facilityLoaded = true;
    } catch (e) {
      console.warn("Facility not found, clearing stale storage:", e);
      if (mode !== "new") {
        code = null;
        role = null;
        appState.facilityCode = "";
        localStorage.removeItem("app_code");
        localStorage.removeItem("app_role");
      }
    }
  }

  if (role === "owner") {
    appState.role = "owner";
    localStorage.setItem("app_role", "owner");
    if (mode === "new" || !appState.venue.address) {
      showScreen("screenOwnerStep1");
    } else {
      await loadOwnerDashboard();
      showScreen("screenOwnerDashboard");
    }
  } else if (role === "employee") {
    appState.role = "employee";
    localStorage.setItem("app_role", "employee");
    if (userId) {
      try {
        const empData = await apiGetEmployee(userId);
        appState.employee.name = empData.full_name;
        appState.employee.position = empData.position;
        appState.employee.facilityCode = empData.facility_code;
        appState.employee.shiftStarted = Boolean(empData.shift_active);
        appState.employee.shiftStartTime = empData.shift_started_at;
        appState.employee.lastGeoDistance = empData.last_geo_distance;
        appState.employee.completedTasks = empData.completed_tasks || [];
        appState.employee.taskPhotos = empData.task_photos || {};
      } catch (e) {
        console.error("Failed to load employee on boot:", e);
      }
    }

    if (appState.employee.name) {
      renderEmployeeShiftScreen();
      showScreen("screenEmployeeShift");
    } else {
      if (appState.facilityCode) {
        document.getElementById("empFacilityCode").value = appState.facilityCode;
        loadFacilityRosterForEmployee();
      }
      showScreen("screenEmployeeRegister");
    }
  } else {
    showScreen("screenLanding");
  }
});

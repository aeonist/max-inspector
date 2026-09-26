// Global Application State
const appState = {
  facilityCode: "",
  adminPin: "",
  user_id: 0,
  role: "",
  history: [],
  venue: {
    name: "Объект общественного питания",
    address: "",
    lat: null,
    lon: null,
    geoRequired: true,
    staffCount: 0
  },
  positions: [
    { name: "Повар" },
    { name: "Официант" },
    { name: "Уборщик" }
  ],
  staffList: [],
  backendStaff: [],
  duties: [],
  auditAnswers: {},
  auditProgress: 0,
  currentAuditSection: "all",
  employeeDefects: {},
  employee: {
    id: 0,
    facilityCode: "",
    name: "",
    position: "Повар",
    shiftStarted: false,
    shiftStartTime: null,
    lastGeoDistance: null,
    completedTasks: [],
    taskPhotos: {}
  }
};

// Default role assignment helper
function getDefaultRoleForZone(zone) {
  if (zone === "Кухня" || zone === "Холодильники" || zone === "Склад") return "Повар";
  if (zone === "Мойка" || zone === "Отходы") return "Уборщик";
  return "Официант";
}

// Load normative checklists from JSON
async function loadChecklists() {
  try {
    const res = await fetch("checklists.json");
    const list = await res.json();
    appState.duties = list.map((item, idx) => {
      // Lower bound of the legal entity fine, e.g. "30 000 – 50 000 ₽" -> 30000
      let fineNum = 30000;
      if (item.fines && item.fines.legal_entity) {
        const m = item.fines.legal_entity.match(/^[\d\s]+/);
        if (m) fineNum = parseInt(m[0].replace(/\s+/g, ""), 10);
      }
      const taskType = item.task_type || "shift";
      return {
        id: item.id || (idx + 1),
        section: item.section || item.zone,
        zone: item.zone,
        question: item.question,
        norm: item.norm,
        basis: item.basis || "",
        checklistRef: item.checklist_ref || "",
        appliesTo: item.applies_to || "",
        photoHint: item.photo_hint || "",
        referencePhoto: item.reference_photo || null,
        taskType: taskType,
        violation: item.violation || "Несоблюдение санитарных требований",
        remediation: item.remediation || "Привести объект в соответствие с нормативом СанПиН.",
        article: item.article || "Ст. 6.6 КоАП РФ",
        fineText: item.fines ? item.fines.legal_entity : "30 000 – 50 000 ₽",
        fineAmount: fineNum,
        // Only recurring shift duties are assigned to positions; documents and premises stay with the owner
        assignedTo: taskType === "shift" ? (item.default_role || getDefaultRoleForZone(item.zone)) : null
      };
    });
  } catch (e) {
    console.error("Failed to load checklists:", e);
  }
}

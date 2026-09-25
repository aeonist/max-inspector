// Global Application State
const appState = {
  facilityCode: "",
  adminPin: "",
  user_id: 0,
  role: "",
  history: [],
  venue: {
    name: "Объект общественного питания",
    address: "г. Казань, ул. Петербургская, д. 28",
    lat: 55.783611,
    lon: 49.129444,
    geoRequired: true,
    staffCount: 3
  },
  positions: [
    { name: "Повар" },
    { name: "Официант" },
    { name: "Уборщик" }
  ],
  staffList: [
    { full_name: "Иванов Алексей", position: "Повар" },
    { full_name: "Петрова Анна", position: "Официант" },
    { full_name: "Сидоров Иван", position: "Уборщик" }
  ],
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
      let fineNum = 30000;
      if (item.fines && item.fines.legal_entity) {
        const m = item.fines.legal_entity.replace(/\s+/g, "").match(/(\d+)/);
        if (m) fineNum = parseInt(m[1]) * 1000;
      }
      return {
        id: item.id || (idx + 1),
        section: item.section || item.zone,
        zone: item.zone,
        question: item.question,
        norm: item.norm,
        violation: item.violation || "Несоблюдение санитарных требований",
        remediation: item.remediation || "Привести объект в соответствие с нормативом СанПиН.",
        article: item.article || "Ст. 6.6 КоАП РФ",
        fineText: item.fines ? item.fines.legal_entity : "30 000 – 50 000 ₽",
        fineAmount: fineNum,
        assignedTo: item.default_role || getDefaultRoleForZone(item.zone)
      };
    });
  } catch (e) {
    console.error("Failed to load checklists:", e);
  }
}

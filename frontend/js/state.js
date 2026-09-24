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
    { name: "Повар", count: 1 },
    { name: "Официант", count: 1 },
    { name: "Уборщик", count: 1 }
  ],
  staffList: [
    { full_name: "Иванов Алексей", position: "Повар" },
    { full_name: "Петрова Анна", position: "Официант" },
    { full_name: "Сидоров Иван", position: "Уборщик" }
  ],
  backendStaff: [],
  duties: [],
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
  if (zone === "Мойка") return "Уборщик";
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
        id: idx + 1,
        zone: item.zone,
        question: item.question,
        norm: item.norm,
        violation: item.violation,
        article: item.article,
        fineText: item.fines ? item.fines.legal_entity : "30 000 – 50 000 ₽",
        fineAmount: fineNum,
        assignedTo: getDefaultRoleForZone(item.zone)
      };
    });
  } catch (e) {
    appState.duties = [
      { id: 1, zone: "Склад", question: "Ведется ли ежедневная регистрация температуры и влажности в помещениях хранения?", norm: "п. 3.8 СанПиН 2.3/2.4.3590-20", fineText: "30 000 – 50 000 ₽", fineAmount: 30000, assignedTo: "Повар" },
      { id: 2, zone: "Кухня", question: "Обеспечена ли раздельная маркировка разделочного инвентаря для сырой и готовой продукции?", norm: "п. 3.6 СанПиН 2.3/2.4.3590-20", fineText: "30 000 – 50 000 ₽", fineAmount: 30000, assignedTo: "Повар" },
      { id: 3, zone: "Мойка", question: "Соблюдается ли инструкция по приготовлению и концентрации дезинфицирующих растворов?", norm: "п. 4.5 СанПиН 2.3/2.4.3590-20", fineText: "30 000 – 50 000 ₽", fineAmount: 30000, assignedTo: "Уборщик" },
      { id: 4, zone: "Персонал", question: "Наличие личных медицинских книжек с отметками о прохождении медосмотра?", norm: "п. 13.1 СанПиН 2.3/2.4.3590-20", fineText: "50 000 – 100 000 ₽", fineAmount: 50000, assignedTo: "Официант" }
    ];
  }
}

// Still copies of four key screens with the demo café's data, in the app's real markup,
// so every design is shown on exactly what the app renders.

(function () {
  var img = function (id, kind) { return "../img/reference/" + id + "_" + kind + ".jpg"; };
  var ico = function (name) { return '<i class="ico" data-i="' + name + '" aria-hidden="true"></i>'; };
  var C = 2 * Math.PI * 52;

  var FRYER = "Контролируется ли ежедневно фритюрный жир и фиксируется ли его замена (записи хранятся не менее 3 месяцев)?";
  var LABELS = "Соблюдаются ли сроки годности продукции после вскрытия упаковки (отмечается ли дата и время вскрытия)?";
  var THERMO = "Оснащено ли всё холодильное оборудование контрольными термометрами?";

  function pair(a, aCap, b, bCap) {
    return '<div class="photo-pair">' +
      '<button type="button" class="photo-thumb"><img src="' + a + '" alt=""><span>' + aCap + "</span></button>" +
      '<button type="button" class="photo-thumb"><img src="' + b + '" alt=""><span>' + bCap + "</span></button></div>";
  }

  function roleTabs(active) {
    return '<nav class="role-tabs" aria-label="Роль">' +
      '<button type="button" class="' + (active === "home" ? "active" : "") + '">' + ico("store") + " Кабинет</button>" +
      '<button type="button" class="' + (active === "shift" ? "active" : "") + '">' + ico("user") + " Моя смена</button></nav>";
  }

  function topbar(title, back, action) {
    return '<header class="topbar">' + (back ? '<button type="button" class="topbar-back" aria-label="Назад">‹</button>' : "") +
      "<h1>" + title + "</h1>" + (action || "") + "</header>";
  }

  function home() {
    return topbar("Демо-кафе «Зерно»", false, '<button type="button" class="icon-btn" aria-label="Настройки">' + ico("gear") + "</button>") +
      '<main class="screen">' + roleTabs("home") +
      '<section class="card center">' +
        '<div class="ring ring-amber"><svg viewBox="0 0 120 120" aria-hidden="true">' +
          '<circle cx="60" cy="60" r="52" class="ring-track"></circle>' +
          '<circle cx="60" cy="60" r="52" class="ring-value" style="stroke-dasharray:' + C + ";stroke-dashoffset:" + C * (1 - 0.87) + '"></circle>' +
        '</svg><div class="ring-text"><strong>87%</strong><span>готовность</span></div></div>' +
        '<p class="status status-amber">Почти готово</p>' +
        '<div class="todo"><p class="todo-title">Что сделать для готовности:</p>' +
          todo("search", "Проверить исправления: 1") +
          todo("clipboard", "Ваши задачи: 1") +
          todo("users", "Нарушения у команды: 1") +
          todo("help", "Не проверено вопросов: 6 из 71") +
        "</div>" +
        '<button type="button" class="btn btn-primary">Продолжить аудит</button>' +
      "</section>" +
      '<section class="section"><h2>Ждут вашей проверки <span class="count">1</span></h2>' +
        '<article class="card defect-card"><p class="muted small">Мария Петрова · 29.09, 10:42</p><h3>' + LABELS + "</h3>" +
        pair(img(18, "bad"), "Было", img(18, "good"), "Стало") +
        '<div class="row-buttons"><button type="button" class="btn btn-primary">Принять</button><button type="button" class="btn btn-secondary">Вернуть</button></div></article>' +
      "</section>" +
      '<section class="section"><h2>Ваши задачи <span class="count">1</span></h2>' +
        '<article class="card defect-card"><p class="muted small">Холодильники</p><h3>' + THERMO + "</h3>" +
        "<p><strong>Что сделать:</strong> Установить контрольный (не ртутный) термометр в каждую единицу холодильного оборудования.</p>" +
        pair(img(14, "bad"), "Как сейчас", img(14, "good"), "Как должно быть") +
        '<button type="button" class="btn btn-secondary">' + ico("camera") + " Сфотографировать результат</button></article>" +
      "</section>" +
      '<section class="section"><h2>Нарушения у команды <span class="count">1</span></h2>' +
        '<ul class="list card"><li><button type="button" class="list-row row-button"><span><strong>' + FRYER +
        '</strong><span class="muted small block">Повар · Назначено</span></span><span class="chevron">›</span></button></li></ul>' +
      "</section>" +
      '<section class="section"><h2>Смена сейчас <span class="count">2 из 5</span></h2><ul class="list card">' +
        person("Мария Петрова", "Повар · с 08:05 · по QR", true, "задачи 5/9") +
        person("Айдар Галиев", "Бариста · с 08:30 · по QR", true, "задачи 2/6") +
        person("Ольга Смирнова", "Официант", false, "не на смене") +
        person("Ильдар Хабибуллин", "Уборщик", false, "не в MAX") +
      "</ul></section></main>";
  }

  function todo(icon, text) {
    return '<button type="button" class="todo-row"><span class="todo-icon">' + ico(icon) + '</span><span class="todo-text">' + text + '</span><span class="chevron">›</span></button>';
  }

  function person(name, sub, on, right) {
    return '<li class="person"><span><strong>' + name + '</strong><span class="muted small block">' + sub + "</span></span>" +
      (on ? '<span class="person-right"><span class="badge badge-ok">на смене</span><span class="small muted">' + right + "</span></span>"
          : '<span class="badge">' + right + "</span>") + "</li>";
  }

  function audit() {
    return '<header class="topbar"><button type="button" class="topbar-back" aria-label="Выйти из аудита">‹</button><h1>Аудит</h1>' +
      '<span class="saved">Сохранено ✓</span><button type="button" class="topbar-action">Разделы</button></header>' +
      '<main class="screen audit-screen"><div class="audit-progress">' +
        '<div class="row-between small"><span>Кухня и технологический процесс</span><span class="muted">6 из 11</span></div>' +
        '<div class="bar"><div class="bar-fill" style="width:92%"></div></div><p class="muted small">Проверено 65 из 71</p></div>' +
      '<article class="card question-card"><p class="muted small">Вопрос 6 из 11 · Кухня</p>' +
        '<h2 class="question">' + FRYER + "</h2>" +
        "<p>Фритюрные жиры подлежат ежедневному контролю; информация о замене фиксируется ответственным лицом в электронном или бумажном виде и хранится не менее трёх месяцев.</p>" +
        '<p class="muted small">Применимо, если: используется фритюр.</p>' +
        '<div class="example-photos">' +
          '<button type="button" class="example ok"><img src="' + img(26, "good") + '" alt=""><span>✓ Так правильно</span></button>' +
          '<button type="button" class="example bad"><img src="' + img(26, "bad") + '" alt=""><span>✕ Так — нарушение</span></button></div>' +
        '<button type="button" class="link-toggle">Основание</button>' +
        '<p class="answer-note violation">Нарушение отправлено: Повар · <button type="button" class="inline-link">посмотреть фото</button></p>' +
      "</article>" +
      '<div class="answer-bar">' +
        '<button type="button" class="answer ok">✓<span>Соблюдается</span></button>' +
        '<button type="button" class="answer bad active">✕<span>Нарушение</span></button>' +
        '<button type="button" class="answer na">—<span>Не применимо</span></button></div>' +
      '<p class="answer-hint muted small">Нарушение подтверждается фото. Для «Соблюдается» фото по желанию — оно станет эталоном для сотрудников.</p>' +
      '<div class="row-between audit-nav"><button type="button" class="btn-link">‹ Предыдущий</button><button type="button" class="btn-link">Пропустить ›</button></div>' +
      "</main>";
  }

  function shift() {
    var tasks = function (list) {
      return '<ul class="task-list card">' + list.map(function (t) {
        return '<li class="task' + (t[1] ? " done" : "") + '"><button type="button" class="task-check" aria-label="Отметить">' + (t[1] ? "✓" : "") +
          '</button><span class="task-text">' + t[0] + '</span><button type="button" class="icon-btn" aria-label="Подробнее">⋯</button></li>';
      }).join("") + "</ul>";
    };
    return topbar("Моя смена", true) +
      '<main class="screen">' +
      '<section class="card"><p class="muted small">Демо-кафе «Зерно»</p><h2>Мария Петрова<span class="muted"> · Повар</span></h2>' +
        '<p class="status status-green">Смена с 08:05 · по QR на месте</p></section>' +
      '<section class="section"><h2 class="urgent-title">' + ico("alert-dot") + ' Срочно <span class="count">1</span></h2>' +
        '<article class="card defect-card urgent"><p class="muted small">Кухня</p><h3>' + FRYER + "</h3>" +
        pair(img(26, "bad"), "Как сейчас", img(26, "good"), "Как должно быть") +
        "<p><strong>Что сделать:</strong> Завести журнал учёта фритюрных жиров, контролировать качество каждый день и фиксировать замену.</p>" +
        '<button type="button" class="link-toggle">Основание</button>' +
        '<button type="button" class="btn btn-primary">' + ico("camera") + " Сфотографировать исправление</button></article>" +
      "</section>" +
      '<section class="section"><h2>На проверке у руководителя <span class="count">1</span></h2>' +
        '<article class="card defect-card"><h3>' + LABELS + "</h3>" + pair(img(18, "bad"), "Было", img(18, "good"), "Стало") +
        '<p class="muted small">' + ico("clock") + " Руководитель проверит фото и примет исправление</p></article>" +
      "</section>" +
      '<section class="section"><h2>Задачи смены <span class="count">5/9</span></h2>' +
        '<div class="bar"><div class="bar-fill" style="width:56%"></div></div>' +
        '<div class="chips chips-small zone-filter"><button type="button" class="chip selected">Все · 5/9</button><button type="button" class="chip">Холодильники · 3/4</button><button type="button" class="chip">Кухня · 2/5</button></div>' +
        '<h3 class="zone">Холодильники</h3>' +
        tasks([
          ["Регистрируется ли ежедневно температура в каждом холодильнике и морозильнике?", true],
          ["Изымается ли и утилизируется ли продукция с истекшим сроком годности?", true],
          ["Соблюдаются ли сроки годности продукции после вскрытия упаковки?", true],
          ["Соответствует ли фактическая температура в холодильниках условиям хранения?", false],
        ]) +
        '<h3 class="zone">Кухня</h3>' +
        tasks([
          ["Промаркирован ли разделочный инвентарь и используется ли он строго по назначению?", true],
          ["Контролируется ли ежедневно фритюрный жир и фиксируется ли его замена?", true],
          ["Соответствует ли температура горячих и холодных блюд при раздаче?", false],
        ]) +
      "</section>" +
      '<div class="stack"><button type="button" class="btn btn-secondary">' + ico("megaphone") + " Сообщить о проблеме</button>" +
        '<button type="button" class="btn btn-secondary">Завершить смену</button></div>' +
      "</main>";
  }

  // The owner opens a team violation: a sheet over the cabinet
  function defect() {
    document.getElementById("sheet-root").innerHTML =
      '<div class="sheet-overlay show"><div class="sheet" role="dialog"><div class="sheet-handle"></div><div class="sheet-body">' +
      '<p class="muted small">Кухня · Повар · Возвращено на доработку</p><h3>' + FRYER + "</h3>" +
      '<p class="notice small">' + ico("undo") + " Вернули: на фото не видно журнала учёта</p>" +
      pair(img(26, "bad"), "Как сейчас", img(26, "good"), "Как должно быть") +
      "<p><strong>Что сделать:</strong> Завести журнал учёта фритюрных жиров, контролировать качество каждый день и фиксировать замену.</p>" +
      '<p class="muted small">Задача у должности «Повар». Когда пришлют фото исправления, оно появится в «Ждут вашей проверки».</p>' +
      '</div><div class="sheet-actions"><button type="button" class="btn btn-secondary">Закрыть</button></div></div></div>';
    return home();
  }

  var screens = { home: home, audit: audit, shift: shift, defect: defect };
  var params = new URLSearchParams(location.search);

  // ?scheme=dark|light pins the phone theme regardless of the viewer's system setting
  var scheme = params.get("scheme");
  if (scheme) {
    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      var rules = sheet.cssRules;
      for (var i = rules.length - 1; i >= 0; i--) {
        var r = rules[i];
        if (!r.media || r.media.mediaText.indexOf("prefers-color-scheme") < 0) continue;
        var inner = Array.prototype.map.call(r.cssRules, function (x) { return x.cssText; });
        sheet.deleteRule(i);
        if (scheme === "dark") inner.forEach(function (t) { sheet.insertRule(t, sheet.cssRules.length); });
      }
    });
    document.documentElement.style.colorScheme = scheme;
  }
  document.getElementById("app").innerHTML = (screens[params.get("s")] || home)();
})();

import io

from reportlab.graphics import renderPDF, renderSVG
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.orm import Session

from config import FONTS_DIR
from models import Facility
from services import audit
from services.checklist import load_checklist
from utils.timefmt import format_local_datetime, utcnow

CHECKLIST_SOURCE = (
    "Проверочный лист: приложение № 2 к приказу Роспотребнадзора от 24.12.2021 № 808 "
    "(предприятия общественного питания, кроме детского питания)."
)
STATUS_TEXT = {
    "compliant": "Соблюдается",
    "violation": "Нарушение",
    "na": "Не применимо",
}
DEFECT_STATUS_TEXT = {
    "open": "назначено",
    "returned": "возвращено на доработку",
    "fixed": "исправлено, ждёт проверки",
}

_fonts_ready = False


def _register_fonts() -> None:
    global _fonts_ready
    if not _fonts_ready:
        pdfmetrics.registerFont(TTFont("DejaVu", str(FONTS_DIR / "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(FONTS_DIR / "DejaVuSans-Bold.ttf")))
        _fonts_ready = True


def _styles() -> dict:
    _register_fonts()
    return {
        "title": ParagraphStyle("title", fontName="DejaVu-Bold", fontSize=15, leading=19, spaceAfter=4),
        "h2": ParagraphStyle("h2", fontName="DejaVu-Bold", fontSize=11, leading=14, spaceBefore=8, spaceAfter=4),
        "body": ParagraphStyle("body", fontName="DejaVu", fontSize=9, leading=12),
        "small": ParagraphStyle("small", fontName="DejaVu", fontSize=7.5, leading=9.5, textColor=colors.HexColor("#555555")),
        "cell": ParagraphStyle("cell", fontName="DejaVu", fontSize=7.5, leading=9.5),
        "cell_bold": ParagraphStyle("cell_bold", fontName="DejaVu-Bold", fontSize=7.5, leading=9.5),
    }


def _esc(text: str | None) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# "Акт внутреннего аудита по проверочному листу" (not a declaration under art. 51 of 248-FZ)
def build_act_pdf(db: Session, facility: Facility) -> bytes:
    st = _styles()
    summary = audit.summary(db, facility)
    answers = audit.answers_by_item(db, audit.current_session(db, facility))
    unresolved = audit.unresolved_defects(db, facility)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
        title="Акт внутреннего аудита", author="МАХ-Инспектор",
    )
    story = [
        Paragraph("Акт внутреннего аудита по проверочному листу", st["title"]),
        Paragraph(_esc(CHECKLIST_SOURCE), st["small"]),
        Spacer(1, 6),
    ]

    ready = "готово к проверке" if summary["ready"] else "есть что исправить до проверки"
    info = [
        ("Заведение", facility.name),
        ("Адрес", facility.address or "не указан"),
        ("Дата формирования", format_local_datetime(utcnow())),
        ("Аудит начат", summary["started_at"] or "—"),
        ("Индекс готовности", f"{summary['index']}% — соблюдается {summary['compliant']} из {summary['applicable']} применимых пунктов"),
        ("Проверено пунктов", f"{summary['answered']} из {summary['total']}"),
        ("Итог", ready),
    ]
    info_table = Table(
        [[Paragraph(_esc(k), st["cell_bold"]), Paragraph(_esc(v), st["cell"])] for k, v in info],
        colWidths=[42 * mm, None],
    )
    info_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    story += [info_table]

    if unresolved:
        story.append(Paragraph("Нарушения, которые ещё не устранены", st["h2"]))
        rows = [[Paragraph(h, st["cell_bold"]) for h in ("Пункт", "Нарушение", "Кто исправляет", "Статус")]]
        for d in unresolved:
            who = "руководитель" if d.to_owner else (d.assigned_position or "—")
            rows.append([
                Paragraph(str(d.item_id or "—"), st["cell"]),
                Paragraph(_esc(d.title), st["cell"]),
                Paragraph(_esc(who), st["cell"]),
                Paragraph(_esc(DEFECT_STATUS_TEXT.get(d.status, d.status)), st["cell"]),
            ])
        story.append(_grid(rows, [14 * mm, None, 32 * mm, 34 * mm]))

    story.append(Paragraph("Результаты по вопросам проверочного листа", st["h2"]))
    rows = [[Paragraph(h, st["cell_bold"]) for h in ("№", "Вопрос", "Результат", "Основание")]]
    for item in load_checklist():
        answer = answers.get(item["id"])
        if not answer:
            result = "Не проверено"
        elif answer.source == "fix":
            result = "Соблюдается (нарушение устранено)"
        else:
            result = STATUS_TEXT.get(answer.status, answer.status)
        rows.append([
            Paragraph(str(item["id"]), st["cell"]),
            Paragraph(_esc(item["question"]), st["cell"]),
            Paragraph(_esc(result), st["cell_bold" if result == "Нарушение" else "cell"]),
            Paragraph(_esc(f"{item.get('basis', '')}. {item.get('checklist_ref', '')}"), st["small"]),
        ])
    story.append(_grid(rows, [9 * mm, 78 * mm, 30 * mm, None]))

    story += [
        Spacer(1, 8),
        Paragraph(
            "Документ сформирован сервисом «МАХ-Инспектор» для внутреннего контроля заведения. "
            "Он не является документом контрольного органа и не заменяет проверку.",
            st["small"],
        ),
    ]
    doc.build(story)
    return buf.getvalue()


def _grid(rows, widths) -> Table:
    table = Table(rows, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#bbbbbb")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef3ff")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


def _qr_drawing(url: str, size: float) -> Drawing:
    widget = QrCodeWidget(url, barLevel="M")
    x1, y1, x2, y2 = widget.getBounds()
    drawing = Drawing(size, size, transform=[size / (x2 - x1), 0, 0, size / (y2 - y1), 0, 0])
    drawing.add(widget)
    return drawing


def qr_svg(url: str, size: int = 240) -> str:
    svg = renderSVG.drawToString(_qr_drawing(url, size))
    # Drop the XML prolog and doctype so the markup can be inlined in HTML
    return svg[svg.index("<svg"):]


# Printable A4 poster for the kitchen: staff scan it to join shifts
def build_poster_pdf(facility: Facility, invite_url: str) -> bytes:
    _register_fonts()
    buf = io.BytesIO()
    width, height = A4
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"Плакат для сотрудников — {facility.name}")

    c.setFont("DejaVu-Bold", 26)
    c.drawCentredString(width / 2, height - 40 * mm, f"Команда «{facility.name[:28]}»")
    c.setFont("DejaVu", 15)
    c.drawCentredString(width / 2, height - 52 * mm, "Подключитесь к сменам в MAX")

    qr_size = 120 * mm
    renderPDF.draw(_qr_drawing(invite_url, qr_size), c, (width - qr_size) / 2, height - 60 * mm - qr_size)

    steps = [
        "1. Наведите камеру телефона на QR-код или отсканируйте его в MAX.",
        "2. В чате с ботом нажмите «Начать».",
        "3. Выберите себя из списка сотрудников.",
    ]
    c.setFont("DejaVu", 13)
    y = height - 75 * mm - qr_size
    for step in steps:
        c.drawString(30 * mm, y, step)
        y -= 9 * mm
    c.setFont("DejaVu", 9)
    c.setFillColor(colors.HexColor("#666666"))
    c.drawCentredString(width / 2, 18 * mm, invite_url)
    c.showPage()
    c.save()
    return buf.getvalue()

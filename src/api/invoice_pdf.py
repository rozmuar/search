"""
Генерация PDF "Счёт на оплату" для клиента - reportlab, с шрифтом, поддерживающим
кириллицу (встроенные PDF-шрифты reportlab кириллицу не знают вообще).
"""
import io
import os
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

FONT_NAME = "InvoiceFont"
FONT_NAME_BOLD = "InvoiceFont-Bold"

# Линуксовый прод-путь (fonts-dejavu-core в Dockerfile) проверяется первым;
# Windows-путь - только чтобы генерацию счёта можно было проверить локально при разработке
_FONT_CANDIDATES = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
]

_fonts_registered = False


def _ensure_fonts_registered():
    global _fonts_registered
    if _fonts_registered:
        return

    for regular_path, bold_path in _FONT_CANDIDATES:
        if os.path.exists(regular_path) and os.path.exists(bold_path):
            pdfmetrics.registerFont(TTFont(FONT_NAME, regular_path))
            pdfmetrics.registerFont(TTFont(FONT_NAME_BOLD, bold_path))
            _fonts_registered = True
            return

    raise RuntimeError(
        "No Cyrillic-capable TTF font found for invoice PDF generation. "
        "Install fonts-dejavu-core (see Dockerfile) or add a font path to _FONT_CANDIDATES."
    )


def _fmt_money(amount) -> str:
    return f"{float(amount):,.2f}".replace(",", " ").replace(".", ",")


def generate_invoice_pdf(invoice_id: int, invoice_date, project: dict, requisites: dict, amount) -> bytes:
    """Строит PDF счёта в память и возвращает его байты.

    project: {"name", "payer_company_name"?, "payer_inn"?}
    requisites: {"company_name", "inn", "kpp", "checking_account", "bank_name",
                 "bik", "correspondent_account", "legal_address"} - реквизиты поставщика
    """
    _ensure_fonts_registered()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=18 * mm, rightMargin=18 * mm
    )

    title_style = ParagraphStyle("Title", fontName=FONT_NAME_BOLD, fontSize=15, leading=19, spaceAfter=10)
    label_style = ParagraphStyle("Label", fontName=FONT_NAME_BOLD, fontSize=10, leading=14, spaceAfter=2)
    body_style = ParagraphStyle("Body", fontName=FONT_NAME, fontSize=10, leading=14, spaceAfter=10)
    footer_style = ParagraphStyle("Footer", fontName=FONT_NAME, fontSize=9, leading=13, textColor=colors.grey)

    story = []

    formatted_date = invoice_date.strftime("%d.%m.%Y")
    story.append(Paragraph(f"Счёт на оплату № {invoice_id} от {formatted_date}", title_style))

    supplier_lines = [f"<b>Поставщик:</b> {_e(requisites.get('company_name'))}"]
    if requisites.get("inn"):
        inn_kpp = f"ИНН {_e(requisites['inn'])}"
        if requisites.get("kpp"):
            inn_kpp += f", КПП {_e(requisites['kpp'])}"
        supplier_lines.append(inn_kpp)
    if requisites.get("legal_address"):
        supplier_lines.append(_e(requisites["legal_address"]))
    if requisites.get("checking_account"):
        bank_line = f"Р/с {_e(requisites['checking_account'])}"
        if requisites.get("bank_name"):
            bank_line += f" в {_e(requisites['bank_name'])}"
        supplier_lines.append(bank_line)
    if requisites.get("bik") or requisites.get("correspondent_account"):
        bik_line_parts = []
        if requisites.get("bik"):
            bik_line_parts.append(f"БИК {_e(requisites['bik'])}")
        if requisites.get("correspondent_account"):
            bik_line_parts.append(f"к/с {_e(requisites['correspondent_account'])}")
        supplier_lines.append(", ".join(bik_line_parts))
    story.append(Paragraph("<br/>".join(supplier_lines), body_style))

    payer_company = project.get("payer_company_name")
    payer_inn = project.get("payer_inn")
    payer_lines = [f"<b>Покупатель:</b> {_e(payer_company) if payer_company else 'не указан'}"]
    if payer_inn:
        payer_lines.append(f"ИНН {_e(payer_inn)}")
    payer_lines.append(f"Проект: {_e(project.get('name', ''))}")
    story.append(Paragraph("<br/>".join(payer_lines), body_style))

    story.append(Spacer(1, 6 * mm))

    service_name = f"Услуги поиска и рекомендаций SearchPro — проект «{project.get('name', '')}»"
    table_data = [
        ["№", "Наименование услуги", "Кол-во", "Цена, ₽", "Сумма, ₽"],
        ["1", Paragraph(_e(service_name), body_style), "1", _fmt_money(amount), _fmt_money(amount)],
    ]
    table = Table(table_data, colWidths=[10 * mm, 90 * mm, 20 * mm, 30 * mm, 30 * mm])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
        ("FONTNAME", (0, 0), (-1, 0), FONT_NAME_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3F4F6")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D1D5DB")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(table)

    story.append(Spacer(1, 4 * mm))
    total_style = ParagraphStyle("Total", fontName=FONT_NAME_BOLD, fontSize=12, alignment=TA_RIGHT)
    story.append(Paragraph(f"Итого к оплате: {_fmt_money(amount)} ₽", total_style))

    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph(
        "Оплата данного счёта означает согласие с условиями предоставления услуг SearchPro.",
        footer_style
    ))

    doc.build(story)
    return buffer.getvalue()


def _e(value: Optional[str]) -> str:
    """Экранирует спецсимволы reportlab-разметки (&, <, >) в пользовательских строках"""
    if not value:
        return ""
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

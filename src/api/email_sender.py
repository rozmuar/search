"""
Отправка писем клиентам про биллинг (напоминание за 7 дней, приостановка проекта).
Только stdlib (smtplib) - без новых зависимостей. Если SMTP не настроен через переменные
окружения - тихо логирует и возвращает False, ничего не падает (важно для локальной
разработки и для деплоев, где почта ещё не подключена).
"""
import os
import asyncio
import smtplib
import logging
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM = os.getenv("SMTP_FROM", "noreply@searchpro.local")


def _is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def _send_sync(to_email: str, subject: str, body: str):
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM, [to_email], msg.as_string())


async def send_email(to_email: str, subject: str, body: str) -> bool:
    if not _is_configured():
        logger.info(f"[email_sender] SMTP not configured, skip: {subject!r} -> {to_email}")
        return False
    try:
        await asyncio.to_thread(_send_sync, to_email, subject, body)
        return True
    except Exception as e:
        logger.error(f"[email_sender] send failed to {to_email}: {e}")
        return False


async def send_expiry_warning(project: dict) -> bool:
    """Проекту осталось 7 дней (или меньше) оплаченного периода"""
    subject = f"Оплата проекта «{project['name']}» истекает через 7 дней"
    body = (
        f"Здравствуйте!\n\n"
        f"Оплата проекта «{project['name']}» ({project.get('domain', '')}) в SearchPro "
        f"истекает {project['paid_until']}.\n"
        f"Продлите оплату, чтобы поиск на сайте не отключился.\n\n"
        f"— SearchPro"
    )
    return await send_email(project["owner_email"], subject, body)


async def send_suspension_notice(project: dict) -> bool:
    """Оплаченный период закончился, проект автоматически приостановлен"""
    subject = f"Проект «{project['name']}» приостановлен"
    body = (
        f"Здравствуйте!\n\n"
        f"Срок оплаты проекта «{project['name']}» ({project.get('domain', '')}) истёк, "
        f"поиск на сайте временно отключён.\n"
        f"Продлите оплату для возобновления работы.\n\n"
        f"— SearchPro"
    )
    return await send_email(project["owner_email"], subject, body)

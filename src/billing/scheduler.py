"""
Планировщик биллинга - раз в час проверяет paid_until всех активных проектов:
- за 7 дней (или меньше) до истечения, если ещё не предупреждали - письмо клиенту + уведомление
  admin/manager
- после истечения - приостановка проекта (status='suspended') + письмо клиенту + уведомление
  admin/manager

Зеркалит src/feed/scheduler.py (тот же asyncio.create_task-цикл, start()/stop()).
paid_until=NULL у проекта означает "оплата не отслеживается" - такие проекты не трогаются
вообще ни на одном из двух шагов (см. WHERE paid_until IS NOT NULL в DataStore-запросах).
"""
import asyncio
from datetime import datetime
from typing import Optional


class BillingScheduler:
    """Планировщик проверки окончания оплаченного периода проектов"""

    CHECK_INTERVAL_MINUTES = 60  # paid_until - дата (не время), часовой опрос более чем достаточен

    def __init__(self, data_store, send_expiry_warning, send_suspension_notice):
        self.data_store = data_store
        self.send_expiry_warning = send_expiry_warning
        self.send_suspension_notice = send_suspension_notice
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self):
        """Запуск планировщика"""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._scheduler_loop())
        print(f"✓ Billing scheduler started (check every {self.CHECK_INTERVAL_MINUTES}m)")

    async def stop(self):
        """Остановка планировщика"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        print("✓ Billing scheduler stopped")

    async def _scheduler_loop(self):
        """Основной цикл планировщика"""
        await asyncio.sleep(60)

        while self._running:
            try:
                await self._check_billing()
            except Exception as e:
                print(f"[BillingScheduler] error: {e}")

            await asyncio.sleep(self.CHECK_INTERVAL_MINUTES * 60)

    async def _check_billing(self):
        """Проверка предупреждений об окончании оплаты и авто-приостановки просроченных"""
        today = datetime.utcnow().date()

        expiring = await self.data_store.get_projects_expiring_soon(today)
        for project in expiring:
            try:
                await self.send_expiry_warning(project)
                await self.data_store.mark_expiry_reminder_sent(project["id"])
                await self.data_store.notify_admins_and_managers(
                    "expiry_warning",
                    f"Проект «{project['name']}» истекает {project['paid_until']}",
                    project_id=project["id"]
                )
                print(f"[BillingScheduler] expiry warning sent for {project['id']}")
            except Exception as e:
                print(f"[BillingScheduler] failed to warn {project.get('id')}: {e}")

        to_suspend = await self.data_store.get_projects_to_suspend(today)
        for project in to_suspend:
            try:
                await self.data_store.suspend_project(project["id"])
                await self.send_suspension_notice(project)
                await self.data_store.notify_admins_and_managers(
                    "suspended",
                    f"Проект «{project['name']}» приостановлен (не оплачен)",
                    project_id=project["id"]
                )
                print(f"[BillingScheduler] suspended {project['id']} (paid_until {project['paid_until']})")
            except Exception as e:
                print(f"[BillingScheduler] failed to suspend {project.get('id')}: {e}")


# Глобальный экземпляр
_scheduler: Optional[BillingScheduler] = None


async def start_billing_scheduler(data_store, send_expiry_warning, send_suspension_notice) -> BillingScheduler:
    """Запуск глобального планировщика биллинга"""
    global _scheduler
    _scheduler = BillingScheduler(data_store, send_expiry_warning, send_suspension_notice)
    await _scheduler.start()
    return _scheduler


async def stop_billing_scheduler():
    """Остановка глобального планировщика биллинга"""
    global _scheduler
    if _scheduler:
        await _scheduler.stop()
        _scheduler = None

"""
Планировщик обновления фидов
"""
import asyncio
from datetime import datetime, timedelta
from typing import List, Optional
from dataclasses import dataclass, field
import heapq

from ..core.models import Feed, FeedType, FeedStatus
from ..core.interfaces import IFeedRepository
from .processor import FeedProcessor


@dataclass(order=True)
class FeedTask:
    """Задача обновления фида"""
    next_run: datetime
    priority: int = field(compare=False)  # 1 - высокий (delta), 2 - обычный (full)
    feed_id: str = field(compare=False)
    project_id: str = field(compare=False)
    feed_type: FeedType = field(compare=False)
    url: str = field(compare=False)
    interval: timedelta = field(compare=False)


class FeedScheduler:
    """
    Планировщик обновления фидов
    
    Особенности:
    - Delta-фиды имеют высокий приоритет
    - Параллельная обработка нескольких фидов
    - Retry при ошибках
    - Блокировка дублирующих задач
    """
    
    def __init__(
        self,
        feed_processor: FeedProcessor,
        feed_repository: IFeedRepository,
        redis_client,
        config: dict = None
    ):
        self.processor = feed_processor
        self.repository = feed_repository
        self.redis = redis_client
        self.config = config or {}
        
        # Очередь задач (priority queue)
        self.task_queue: List[FeedTask] = []
        
        # Настройки
        self.max_concurrent = self.config.get("max_concurrent", 5)
        self.retry_count = self.config.get("retry_count", 3)
        self.retry_delay = self.config.get("retry_delay", 60)
        self.lock_ttl = self.config.get("lock_ttl", 300)
        
        # Флаг работы
        self.running = False
    
    async def start(self):
        """
        Запуск планировщика
        """
        self.running = True
        
        # Загружаем все фиды из БД
        await self._load_feeds()
        
        # Запускаем обработчики
        workers = [
            asyncio.create_task(self._worker(i))
            for i in range(self.max_concurrent)
        ]
        
        # Запускаем мониторинг новых фидов
        monitor = asyncio.create_task(self._monitor_new_feeds())
        
        try:
            await asyncio.gather(*workers, monitor)
        except asyncio.CancelledError:
            self.running = False
    
    async def stop(self):
        """Остановка планировщика"""
        self.running = False
    
    async def schedule_feed(self, feed: Feed):
        """
        Добавление фида в расписание
        """
        task = FeedTask(
            next_run=datetime.now(),
            priority=1 if feed.type == FeedType.DELTA else 2,
            feed_id=feed.id,
            project_id=feed.project_id,
            feed_type=feed.type,
            url=feed.url,
            interval=timedelta(seconds=feed.update_interval)
        )
        
        heapq.heappush(self.task_queue, task)
    
    async def force_update(self, feed_id: str):
        """
        Принудительное обновление фида
        """
        feed = await self.repository.get_by_id(feed_id)
        if feed:
            # Ставим в начало очереди
            task = FeedTask(
                next_run=datetime.now() - timedelta(hours=1),
                priority=0,  # Наивысший приоритет
                feed_id=feed.id,
                project_id=feed.project_id,
                feed_type=feed.type,
                url=feed.url,
                interval=timedelta(seconds=feed.update_interval)
            )
            heapq.heappush(self.task_queue, task)
    
    async def _load_feeds(self):
        """
        Загрузка всех фидов в очередь
        """
        feeds = await self.repository.get_pending_feeds()
        
        for feed in feeds:
            # Рассчитываем следующее время запуска
            if feed.last_update:
                next_run = feed.last_update + timedelta(seconds=feed.update_interval)
            else:
                next_run = datetime.now()
            
            task = FeedTask(
                next_run=next_run,
                priority=1 if feed.type == FeedType.DELTA else 2,
                feed_id=feed.id,
                project_id=feed.project_id,
                feed_type=feed.type,
                url=feed.url,
                interval=timedelta(seconds=feed.update_interval)
            )
            
            heapq.heappush(self.task_queue, task)
    
    async def _worker(self, worker_id: int):
        """
        Воркер для обработки задач
        """
        while self.running:
            try:
                # Получаем задачу из очереди
                task = await self._get_next_task()
                
                if not task:
                    await asyncio.sleep(1)
                    continue
                
                # Проверяем время выполнения
                now = datetime.now()
                if task.next_run > now:
                    # Возвращаем в очередь и ждём
                    heapq.heappush(self.task_queue, task)
                    await asyncio.sleep(1)
                    continue
                
                # Пробуем получить блокировку
                if not await self._acquire_lock(task.feed_id):
                    # Фид уже обрабатывается
                    continue
                
                try:
                    # Обрабатываем фид
                    await self._process_task(task, worker_id)
                finally:
                    # Освобождаем блокировку
                    await self._release_lock(task.feed_id)
                
                # Планируем следующее обновление
                task.next_run = datetime.now() + task.interval
                heapq.heappush(self.task_queue, task)
                
            except Exception as e:
                print(f"Worker {worker_id} error: {e}")
                await asyncio.sleep(5)
    
    async def _get_next_task(self) -> Optional[FeedTask]:
        """
        Получение следующей задачи из очереди
        """
        if not self.task_queue:
            return None
        
        return heapq.heappop(self.task_queue)
    
    async def _process_task(self, task: FeedTask, worker_id: int):
        """
        Обработка задачи
        """
        print(f"Worker {worker_id}: Processing feed {task.feed_id} ({task.feed_type.value})")
        
        # Получаем актуальные данные фида
        feed = await self.repository.get_by_id(task.feed_id)
        if not feed:
            return
        
        # Обновляем URL на случай изменения
        task.url = feed.url
        task.interval = timedelta(seconds=feed.update_interval)
        
        # Обрабатываем с retry
        last_error = None
        for attempt in range(self.retry_count):
            try:
                if task.feed_type == FeedType.FULL:
                    log = await self.processor.process_full_feed(feed)
                else:
                    log = await self.processor.process_delta_feed(feed)
                
                # Обновляем статус фида
                feed.last_update = datetime.now()
                feed.last_status = log.status
                feed.last_error = log.error_message
                feed.items_count = log.items_processed
                
                await self.repository.update(feed)
                
                print(f"Worker {worker_id}: Feed {task.feed_id} completed - "
                      f"{log.items_processed} items, {log.duration_ms}ms")
                
                return
                
            except Exception as e:
                last_error = str(e)
                print(f"Worker {worker_id}: Feed {task.feed_id} attempt {attempt + 1} failed: {e}")
                
                if attempt < self.retry_count - 1:
                    await asyncio.sleep(self.retry_delay)
        
        # Все попытки исчерпаны
        feed.last_update = datetime.now()
        feed.last_status = FeedStatus.ERROR
        feed.last_error = last_error
        await self.repository.update(feed)
    
    async def _acquire_lock(self, feed_id: str) -> bool:
        """
        Получение блокировки для фида
        """
        lock_key = f"lock:feed:{feed_id}"
        # SET NX с TTL
        result = await self.redis.set(
            lock_key, 
            "processing", 
            nx=True, 
            ex=self.lock_ttl
        )
        return result is not None
    
    async def _release_lock(self, feed_id: str):
        """
        Освобождение блокировки
        """
        lock_key = f"lock:feed:{feed_id}"
        await self.redis.delete(lock_key)
    
    async def _monitor_new_feeds(self):
        """
        Мониторинг новых фидов (добавленных во время работы)
        """
        while self.running:
            await asyncio.sleep(60)  # Проверяем раз в минуту
            
            try:
                # Получаем ID фидов в очереди
                queued_ids = {task.feed_id for task in self.task_queue}
                
                # Получаем все активные фиды
                all_feeds = await self.repository.get_pending_feeds()
                
                # Добавляем новые
                for feed in all_feeds:
                    if feed.id not in queued_ids:
                        await self.schedule_feed(feed)
                        print(f"Added new feed to schedule: {feed.id}")
                        
            except Exception as e:
                print(f"Monitor error: {e}")

"""
Планировщик автообновления фидов
Простая версия для работы с Redis
"""
import asyncio
from datetime import datetime, timedelta
from typing import Optional


class SimpleFeedScheduler:
    """
    Простой планировщик для автоматического обновления фидов
    Проверяет фиды каждые 15 минут и обновляет устаревшие (старше 4 часов)
    """
    
    UPDATE_INTERVAL_HOURS = 4  # Интервал обновления в часах
    CHECK_INTERVAL_MINUTES = 15  # Интервал проверки
    
    def __init__(self, redis_client, feed_manager, data_store, indexer):
        self.redis = redis_client
        self.feed_manager = feed_manager
        self.data_store = data_store
        self.indexer = indexer
        self._task: Optional[asyncio.Task] = None
        self._running = False
    
    async def start(self):
        """Запуск планировщика"""
        if self._running:
            return
        
        self._running = True
        self._task = asyncio.create_task(self._scheduler_loop())
        print(f"✓ Feed scheduler started (auto-update every {self.UPDATE_INTERVAL_HOURS}h)")
    
    async def stop(self):
        """Остановка планировщика"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        print("✓ Feed scheduler stopped")
    
    async def _scheduler_loop(self):
        """Основной цикл планировщика"""
        # Ждём немного после старта
        await asyncio.sleep(60)
        
        while self._running:
            try:
                await self._check_and_update_feeds()
            except Exception as e:
                print(f"Scheduler error: {e}")
            
            # Спим между проверками
            await asyncio.sleep(self.CHECK_INTERVAL_MINUTES * 60)
    
    async def _check_and_update_feeds(self):
        """Проверка и обновление устаревших фидов"""
        from ..core.models import Product
        
        # Получаем все проекты
        project_keys = await self.redis.keys("project:proj_*")
        
        now = datetime.utcnow()
        update_threshold = now - timedelta(hours=self.UPDATE_INTERVAL_HOURS)
        
        updated_count = 0
        
        for key in project_keys:
            try:
                key_str = key.decode() if isinstance(key, bytes) else key
                
                # Пропускаем вложенные ключи (feed, product и т.д.)
                if ':feed' in key_str or ':product' in key_str or ':analytics' in key_str:
                    continue
                
                project_id = key_str.replace("project:", "")
                
                # Получаем данные проекта
                project_data = await self.redis.hgetall(key_str)
                if not project_data:
                    continue
                
                # Декодируем
                project = {}
                for k, v in project_data.items():
                    pk = k.decode() if isinstance(k, bytes) else k
                    pv = v.decode() if isinstance(v, bytes) else v
                    project[pk] = pv
                
                feed_url = project.get("feed_url")
                if not feed_url:
                    continue
                
                # Проверяем включено ли автообновление (по умолчанию включено)
                auto_update = project.get("auto_update", "true")
                if auto_update == "false":
                    continue
                
                # Проверяем время последнего обновления
                feed_status = await self.feed_manager.get_feed_status(project_id)
                
                should_update = True
                
                if feed_status:
                    last_update_str = feed_status.get("last_update")
                    if last_update_str:
                        try:
                            last_update = datetime.fromisoformat(last_update_str.replace('Z', ''))
                            if last_update > update_threshold:
                                # Фид ещё свежий, пропускаем
                                should_update = False
                        except:
                            pass
                
                if not should_update:
                    continue
                
                # Обновляем фид
                print(f"[Scheduler] Auto-updating feed for {project_id}...")
                
                # Устанавливаем статус "downloading"
                await self.redis.hset(
                    f"project:{project_id}:feed",
                    mapping={
                        "status": "downloading",
                        "progress": "0",
                        "message": "Автообновление фида...",
                        "update_started": now.isoformat()
                    }
                )
                
                try:
                    # Загружаем фид
                    result = await self.feed_manager.load_feed(project_id, feed_url)
                    
                    if result["success"]:
                        # Статус индексации
                        await self.redis.hset(
                            f"project:{project_id}:feed",
                            mapping={
                                "status": "indexing",
                                "progress": "50",
                                "message": f"Индексация {result['products_count']} товаров..."
                            }
                        )
                        
                        # Сохраняем товары
                        await self.data_store.save_products(project_id, result["products"])
                        
                        # Конвертируем и индексируем
                        products_list = []
                        for p in result["products"]:
                            try:
                                product = Product(
                                    id=str(p.get("id", "")),
                                    name=p.get("name", ""),
                                    url=p.get("url", ""),
                                    description=p.get("description"),
                                    image=p.get("image"),
                                    images=p.get("images", []),
                                    price=float(p.get("price", 0) or 0),
                                    old_price=float(p.get("old_price") or 0) if p.get("old_price") else None,
                                    in_stock=p.get("in_stock", True),
                                    category=p.get("category"),
                                    brand=p.get("brand"),
                                    vendor_code=p.get("vendor_code"),
                                    params=p.get("params", {}),
                                )
                                products_list.append(product)
                            except:
                                continue
                        
                        await self.indexer.index_products(project_id, products_list)
                        
                        # Обновляем статус успеха
                        await self.redis.hset(
                            f"project:{project_id}:feed",
                            mapping={
                                "status": "success",
                                "progress": "100",
                                "message": f"Загружено {result['products_count']} товаров",
                                "products_count": str(result["products_count"]),
                                "categories_count": str(result["categories_count"]),
                                "last_update": datetime.utcnow().isoformat(),
                                "last_auto_update": datetime.utcnow().isoformat(),
                                "auto_update_status": "success"
                            }
                        )
                        
                        updated_count += 1
                        print(f"[Scheduler] ✓ Updated {result['products_count']} products for {project_id}")
                    else:
                        # Сохраняем ошибку
                        await self.redis.hset(
                            f"project:{project_id}:feed",
                            mapping={
                                "status": "error",
                                "progress": "0",
                                "message": result.get("error", "Ошибка загрузки"),
                                "last_auto_update": datetime.utcnow().isoformat(),
                                "auto_update_status": "error"
                            }
                        )
                        print(f"[Scheduler] ✗ Failed to update {project_id}: {result.get('error')}")
                        
                except Exception as e:
                    await self.redis.hset(
                        f"project:{project_id}:feed",
                        mapping={
                            "status": "error",
                            "progress": "0",
                            "message": str(e),
                            "last_auto_update": datetime.utcnow().isoformat(),
                            "auto_update_status": "error"
                        }
                    )
                    print(f"[Scheduler] ✗ Error updating {project_id}: {e}")
                
            except Exception as e:
                print(f"[Scheduler] Error checking project: {e}")
        
        if updated_count > 0:
            print(f"[Scheduler] Completed: {updated_count} feeds updated")


# Глобальный экземпляр
_scheduler: Optional[SimpleFeedScheduler] = None


async def start_feed_scheduler(redis_client, feed_manager, data_store, indexer) -> SimpleFeedScheduler:
    """Запуск глобального планировщика"""
    global _scheduler
    _scheduler = SimpleFeedScheduler(redis_client, feed_manager, data_store, indexer)
    await _scheduler.start()
    return _scheduler


async def stop_feed_scheduler():
    """Остановка глобального планировщика"""
    global _scheduler
    if _scheduler:
        await _scheduler.stop()
        _scheduler = None

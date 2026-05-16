import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from src.config import RegisterConfig, SchedulerConfig, TelegramConfig
from src.db.user import UserOperate
from src.services import get_emby_client, EmbyService
from src.core.utils import timestamp, format_duration
from src.services.user_service import UserService

logger = logging.getLogger(__name__)

class SchedulerService:
    _scheduler = None

    @classmethod
    def get_scheduler(cls):
        if cls._scheduler is None:
            cls._scheduler = AsyncIOScheduler(timezone=SchedulerConfig.TIMEZONE)
        return cls._scheduler

    @staticmethod
    async def check_expired_users():
        """检查过期用户并禁用"""
        logger.info("🔍 开始检查过期用户...")
        try:
            expired_users = await UserOperate.get_expired_users()
            if not expired_users:
                logger.info("✅ 没有需要处理的过期用户")
                return
            
            logger.info(f"📋 发现 {len(expired_users)} 个过期用户")
            emby = get_emby_client()
            disabled_count = 0
            failed_count = 0
            
            for user in expired_users:
                try:
                    if user.EMBYID:
                        await emby.set_user_enabled(user.EMBYID, False)
                    user.ACTIVE_STATUS = False
                    await UserOperate.update_user(user)
                    disabled_count += 1
                    logger.info(f"  ⏹️ 已禁用: {user.USERNAME} (UID: {user.UID})")
                except Exception as e:
                    failed_count += 1
                    logger.error(f"  ❌ 禁用失败: {user.USERNAME} - {e}")
            logger.info(f"✅ 过期用户检查完成: 禁用 {disabled_count} 个, 失败 {failed_count} 个")
        except Exception as e:
            logger.error(f"❌ 检查过期用户时发生错误: {e}")

    @staticmethod
    async def check_expiring_users():
        """检查即将过期的用户（用于提醒）"""
        logger.info("🔔 检查即将过期的用户...")
        try:
            expiring_users = await UserOperate.get_expiring_users(days=3)
            if not expiring_users:
                logger.info("✅ 没有即将过期的用户")
                return
            
            logger.info(f"📋 发现 {len(expiring_users)} 个即将过期的用户:")
            current = timestamp()
            for user in expiring_users:
                remaining = user.EXPIRED_AT - current
                remaining_str = format_duration(remaining)
                logger.info(f"  ⚠️ {user.USERNAME} (UID: {user.UID}) - {remaining_str}后过期")
            
            # TODO: 实现通知功能
        except Exception as e:
            logger.error(f"❌ 检查即将过期用户时发生错误: {e}")

    @staticmethod
    async def cleanup_inactive_sessions():
        """清理不活跃的会话"""
        logger.info("🧹 清理不活跃会话...")
        try:
            emby = get_emby_client()
            sessions = await emby.get_sessions()
            active = len([s for s in sessions if s.is_active])
            total = len(sessions)
            logger.info(f"📊 当前会话: {active} 活跃 / {total} 总计")
        except Exception as e:
            logger.error(f"❌ 清理会话时发生错误: {e}")

    @staticmethod
    async def daily_stats():
        """每日统计"""
        logger.info("📊 生成每日统计...")
        try:
            from src.db.regcode import RegCodeOperate
            registered = await UserOperate.get_registered_users_count()
            active = await UserOperate.get_active_users_count()
            regcodes = await RegCodeOperate.get_active_regcodes_count()
            server_status = await EmbyService.get_server_status()
            
            logger.info("=" * 50)
            logger.info("📈 Twilight 每日统计")
            logger.info("=" * 50)
            logger.info(f"👥 注册用户: {registered} / {RegisterConfig.USER_LIMIT}")
            logger.info(f"✅ 活跃用户: {active}")
            logger.info(f"🎫 可用注册码: {regcodes}")
            logger.info(f"📺 Emby 状态: {'在线' if server_status.get('online') else '离线'}")
            if server_status.get('online'):
                logger.info(f"   活跃会话: {server_status.get('active_sessions', 0)}")
            logger.info("=" * 50)
        except Exception as e:
            logger.error(f"❌ 生成统计时发生错误: {e}")

    @staticmethod
    async def send_expiry_reminders():
        """发送到期提醒"""
        from src.services.admin_service import ReminderService
        logger.info("📧 发送到期提醒...")
        try:
            result = await ReminderService.send_expiry_reminders()
            logger.info(f"✅ 到期提醒发送完成: {result['sent']} 条")
        except Exception as e:
            logger.error(f"❌ 发送到期提醒出错: {e}")

    @staticmethod
    async def emby_sync():
        """定期同步 Emby 用户数据"""
        logger.info("🔄 开始 Emby 用户数据同步...")
        try:
            success, failed, errors = await EmbyService.sync_all_users()
            logger.info(f"✅ Emby 同步完成: 成功 {success}, 失败 {failed}")
            if errors:
                for e in errors[:10]:
                    logger.warning(f"  ⚠️ {e}")
        except Exception as e:
            logger.error(f"❌ Emby 同步出错: {e}")

    @staticmethod
    async def enforce_group_membership():
        """定时巡检：绑定了 TG 但已退出必需群组的用户 → 禁用本地账号 + 禁用 Emby。

        仅在 `TelegramConfig.REQUIRE_GROUP_MEMBERSHIP` 开启且配置了 `GROUP_ID` 时执行。
        管理员、白名单不会被本任务处理（在 SQL 层面就过滤掉了）。
        """
        from src.services.telegram_membership import TelegramMembershipService
        if not TelegramMembershipService.enforcement_enabled():
            return

        logger.info("🛂 开始群组成员资格巡检...")
        try:
            users = await UserOperate.get_active_telegram_bound_users()
            if not users:
                logger.info("✅ 没有需要检查的用户")
                return

            disabled = 0
            skipped = 0
            failed = 0
            for u in users:
                try:
                    ok, missing = await TelegramMembershipService.check_user_in_groups(
                        u.TELEGRAM_ID, strict=False
                    )
                    if ok:
                        skipped += 1
                        continue

                    # 拿到了「明确不在群」的判定 → 禁用
                    success, msg = await UserService.disable_user(
                        u, reason="未加入必需 Telegram 群组"
                    )
                    if success:
                        disabled += 1
                        logger.info(
                            f"  ⏹️ 已禁用 {u.USERNAME} (UID: {u.UID}, "
                            f"TG: {u.TELEGRAM_ID}) — 缺失群组: "
                            f"{', '.join(m.id for m in missing) or '未知'}"
                        )
                    else:
                        failed += 1
                        logger.warning(
                            f"  ⚠️ 禁用 {u.USERNAME} 失败: {msg}"
                        )
                except Exception as exc:  # pragma: no cover
                    failed += 1
                    logger.error(
                        f"  ❌ 巡检 {u.USERNAME} (UID: {u.UID}) 出错: {exc}",
                        exc_info=True,
                    )

            logger.info(
                f"✅ 群组成员资格巡检完成: 仍在群 {skipped} 个, 已禁用 {disabled} 个, "
                f"失败 {failed} 个"
            )
        except Exception as exc:
            logger.error(f"❌ 群组成员资格巡检异常: {exc}", exc_info=True)

    @staticmethod
    async def cleanup_no_emby_users():
        """清理注册后长期未创建 Emby 账户的用户"""
        if not RegisterConfig.AUTO_CLEANUP_NO_EMBY:
            return
        days = RegisterConfig.AUTO_CLEANUP_NO_EMBY_DAYS
        logger.info(f"🧹 开始清理注册超过 {days} 天无 Emby 账户的用户...")
        try:
            users = await UserOperate.get_no_emby_users(days)
            if not users:
                logger.info("✅ 没有需要清理的无 Emby 账户用户")
                return

            deleted_count = 0
            failed_count = 0
            for user in users:
                try:
                    success, msg = await UserService.delete_user(user, delete_emby=False)
                    if success:
                        deleted_count += 1
                        logger.info(f"  🗑️ 已删除: {user.USERNAME} (UID: {user.UID})")
                    else:
                        failed_count += 1
                        logger.warning(f"  ⚠️ 删除失败: {user.USERNAME} - {msg}")
                except Exception as e:
                    failed_count += 1
                    logger.error(f"  ❌ 删除失败: {user.USERNAME} - {e}")
            logger.info(f"✅ 无 Emby 账户用户清理完成: 删除 {deleted_count} 个, 失败 {failed_count} 个")
        except Exception as e:
            logger.error(f"❌ 清理无 Emby 账户用户时发生错误: {e}")

    @classmethod
    async def start(cls):
        """启动调度器"""
        if not SchedulerConfig.ENABLED:
            logger.info("ℹ️ 调度器已禁用")
            return

        scheduler = cls.get_scheduler()
        
        # 解析配置时间
        def parse_time(time_str):
            try:
                hour, minute = map(int, time_str.split(':'))
                return hour, minute
            except:
                return 0, 0

        # 注册定时任务
        h, m = parse_time(SchedulerConfig.EXPIRED_CHECK_TIME)
        scheduler.add_job(cls.check_expired_users, 'cron', hour=h, minute=m, id='check_expired')
        
        h, m = parse_time(SchedulerConfig.EXPIRING_CHECK_TIME)
        scheduler.add_job(cls.check_expiring_users, 'cron', hour=h, minute=m, id='check_expiring')
        scheduler.add_job(cls.send_expiry_reminders, 'cron', hour=h, minute=(m+5)%60, id='expiry_reminders')
        
        h, m = parse_time(SchedulerConfig.DAILY_STATS_TIME)
        scheduler.add_job(cls.daily_stats, 'cron', hour=h, minute=m, id='daily_stats')
        
        scheduler.add_job(cls.cleanup_inactive_sessions, 'interval', hours=SchedulerConfig.SESSION_CLEANUP_INTERVAL, id='cleanup_sessions')
        
        # Emby 数据同步（每 6 小时）
        scheduler.add_job(cls.emby_sync, 'interval', hours=SchedulerConfig.EMBY_SYNC_INTERVAL, id='emby_sync')

        # 无 Emby 账户用户清理（每天过期检查后执行）
        h_cleanup, m_cleanup = parse_time(SchedulerConfig.EXPIRED_CHECK_TIME)
        scheduler.add_job(cls.cleanup_no_emby_users, 'cron', hour=h_cleanup, minute=(m_cleanup + 30) % 60, id='cleanup_no_emby')

        # 群组成员资格巡检（开关 + 群组配置齐备时才注册）
        from src.services.telegram_membership import TelegramMembershipService
        if TelegramMembershipService.enforcement_enabled():
            interval_minutes = max(1, int(TelegramConfig.GROUP_CHECK_INTERVAL_MINUTES or 30))
            scheduler.add_job(
                cls.enforce_group_membership,
                'interval',
                minutes=interval_minutes,
                id='enforce_group_membership',
            )

        scheduler.start()
        logger.info("=" * 50)
        logger.info(f"🌙 Twilight Scheduler 已启动 ({SchedulerConfig.TIMEZONE})")
        logger.info(f"  - 过期检查: {SchedulerConfig.EXPIRED_CHECK_TIME}")
        logger.info(f"  - 到期提醒: {SchedulerConfig.EXPIRING_CHECK_TIME}")
        logger.info(f"  - 每日统计: {SchedulerConfig.DAILY_STATS_TIME}")
        logger.info(f"  - 会话清理: 每 {SchedulerConfig.SESSION_CLEANUP_INTERVAL} 小时")
        logger.info(f"  - Emby 同步: 每 {SchedulerConfig.EMBY_SYNC_INTERVAL} 小时")
        if RegisterConfig.AUTO_CLEANUP_NO_EMBY:
            logger.info(f"  - 无 Emby 清理: {SchedulerConfig.EXPIRED_CHECK_TIME} (注册超 {RegisterConfig.AUTO_CLEANUP_NO_EMBY_DAYS} 天)")
        if TelegramMembershipService.enforcement_enabled():
            logger.info(
                f"  - 群组成员巡检: 每 {max(1, int(TelegramConfig.GROUP_CHECK_INTERVAL_MINUTES or 30))} 分钟"
            )
        logger.info("=" * 50)
        
        # 立即运行一次统计
        await cls.daily_stats()

    @classmethod
    async def stop(cls):
        """停止调度器"""
        if cls._scheduler and cls._scheduler.running:
            cls._scheduler.shutdown()
            logger.info("👋 调度器已关闭")

import logging

from maxapi import Bot, Dispatcher

from config import BOT_TOKEN, BOT_USERNAME

logger = logging.getLogger(__name__)

# Initialize bot and dispatcher; maxapi refuses an empty token, and without
# a token polling is off and nothing is sent (see config.BOT_POLLING, notifier)
bot = Bot(BOT_TOKEN or "not-configured")
dp = Dispatcher()

_username = BOT_USERNAME


# Bot username for deep links and OpenAppButton, from env or the Bot API
async def resolve_username() -> str:
    global _username
    if not _username:
        try:
            me = await bot.get_me()
            _username = me.username or ""
        except Exception as e:
            logger.error(f"Could not resolve bot username: {e}")
    return _username


def bot_username() -> str:
    return _username

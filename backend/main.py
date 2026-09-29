import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from maxapi.exceptions.max import InvalidToken

import max_bot.handlers  # noqa: F401 - register bot handlers
from api import api_router
from config import BOT_POLLING, BOT_TOKEN, FRONTEND_DIR, UPLOADS_DIR
from database import init_db
from max_bot import bot, dp
from max_bot.instance import resolve_username

# Setup basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Seconds between attempts to start the bot while the MAX API is unreachable
BOT_RETRY_FIRST_DELAY = 5
BOT_RETRY_MAX_DELAY = 300

# Initialize database tables and migrate columns
init_db()

if not BOT_TOKEN:
    logger.warning("BOT_TOKEN is not set: the bot is off; API and mini-app run, sign-in works only from MAX")


# Bot polling that survives a MAX API outage at startup: the username lookup and
# the first get_me are retried with backoff instead of leaving the bot dead
async def run_bot() -> None:
    delay = BOT_RETRY_FIRST_DELAY
    while True:
        try:
            await resolve_username()
            await dp.start_polling(bot)
            return
        except asyncio.CancelledError:
            raise
        except InvalidToken:
            logger.error("MAX Bot token is invalid: the bot is off")
            return
        except Exception as e:
            logger.error(f"MAX Bot could not start, retrying in {delay} s: {e!r}")
            await asyncio.sleep(delay)
            delay = min(delay * 2, BOT_RETRY_MAX_DELAY)


# Application lifespan context
@asynccontextmanager
async def lifespan(app: FastAPI):
    if not BOT_POLLING:
        yield
        return
    logger.info("Starting MAX Bot polling...")
    task = asyncio.create_task(run_bot())
    yield
    logger.info("Stopping MAX Bot polling...")
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


# Create FastAPI application
app = FastAPI(title="МАХ-Инспектор API", lifespan=lifespan)


# The MAX WebView caches aggressively; make it revalidate the app shell
@app.middleware("http")
async def no_cache_app_shell(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".js", ".css", ".json")):
        response.headers["Cache-Control"] = "no-cache"
    return response


# Register API routes
app.include_router(api_router)

# Mount static uploads
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Mount frontend web application at root
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

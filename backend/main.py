import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

import max_bot.handlers  # noqa: F401 - register bot handlers
from api import api_router
from config import BOT_POLLING, FRONTEND_DIR, UPLOADS_DIR
from database import init_db
from max_bot import bot, dp
from max_bot.instance import resolve_username

# Setup basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize database tables and migrate columns
init_db()


# Application lifespan context
@asynccontextmanager
async def lifespan(app: FastAPI):
    if not BOT_POLLING:
        yield
        return
    await resolve_username()
    logger.info("Starting MAX Bot polling...")
    task = asyncio.create_task(dp.start_polling(bot))

    def on_polling_done(t):
        if not t.cancelled() and t.exception():
            logger.error(f"MAX Bot polling failed: {t.exception()}", exc_info=t.exception())

    task.add_done_callback(on_polling_done)
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

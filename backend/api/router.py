from fastapi import APIRouter

from api.files import router as files_router
from api.me import router as me_router
from api.owner import router as owner_router
from api.staff import router as staff_router
from api.uploads import router as uploads_router

# Main API router combining all sub-routers
api_router = APIRouter()
api_router.include_router(me_router)
api_router.include_router(owner_router)
api_router.include_router(staff_router)
api_router.include_router(uploads_router)
api_router.include_router(files_router)

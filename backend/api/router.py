from fastapi import APIRouter
from api.facilities import router as facilities_router
from api.employees import router as employees_router
from api.uploads import router as uploads_router

# Main API router combining all sub-routers
api_router = APIRouter()
api_router.include_router(facilities_router)
api_router.include_router(employees_router)
api_router.include_router(uploads_router)

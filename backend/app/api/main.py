# AIGEN MOD START

# from fastapi import APIRouter

# from app.api.routes import items, login, private, users, utils
# from app.core.config import settings

# AIGEN MOD CONT

from fastapi import APIRouter

from app.api.routes import documents, items, login, private, users, utils
from app.core.config import settings

# AIGEN MOD END

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
# AIGEN ADD START
api_router.include_router(documents.router)
# AIGEN ADD END


if settings.FASTAPI_ENV == "development":
    api_router.include_router(private.router)

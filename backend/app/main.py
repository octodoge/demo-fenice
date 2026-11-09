# AIGEN MOD START

# from pathlib import Path

# import sentry_sdk
# from fastapi import FastAPI
# from fastapi.routing import APIRoute
# from starlette.middleware.cors import CORSMiddleware

# from app.api.main import api_router
# from app.core.config import settings

# AIGEN MOD CONT

from pathlib import Path

import logfire
import sentry_sdk
from fastapi import FastAPI
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware

from app.api.main import api_router
from app.core.config import settings

# AIGEN MOD END

FRONTEND_DIR = Path(__file__).parent / "frontend"

# AIGEN MOD START
# 'if-token-present' means nothing will be sent (and the app will work) if you don't have logfire configured
logfire.configure(
    token=settings.LOGFIRE_TOKEN,
    send_to_logfire="if-token-present",
)
logfire.instrument_pydantic_ai()
# AIGEN MOD END


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


if settings.SENTRY_DSN and settings.FASTAPI_ENV != "development":
    sentry_sdk.init(dsn=str(settings.SENTRY_DSN), enable_tracing=True)

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_HOST],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)
app.frontend("/", directory=FRONTEND_DIR)

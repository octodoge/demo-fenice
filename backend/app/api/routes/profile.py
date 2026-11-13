# AIGEN ADD START

from fastapi import APIRouter

# from app.models import Profile

router = APIRouter(prefix="/profile", tags=["profile"])


# @router.get("/", response_model=Profile)
# def read_profile(
#     session: SessionDep,
#     current_user: CurrentUser,
# ) -> Any:
#     return {"template": "", "sensitive_data": {}}


# AIGEN ADD END

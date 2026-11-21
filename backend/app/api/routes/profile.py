# AIGEN ADD START

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.models import Profile, ProfileBase, ProfileCreate, ProfilePublic
from app.utils import (
    TemplateInferrerOutput,
    fill_profile_demo,
    get_profile,
    infer_template,
)

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("/", response_model=ProfilePublic)
def read_profile(
    session: SessionDep,
    current_user: CurrentUser,  # noqa: ARG001
) -> Any:
    """
    Retrieve the shared profile, creating an empty one if none exists yet.
    """
    return get_profile(session)


@router.put("/", response_model=ProfilePublic)
def replace_profile(
    *,
    session: SessionDep,
    current_user: CurrentUser,  # noqa: ARG001
    profile_in: ProfileCreate,
) -> Any:
    """
    Create or replace the shared profile.
    """
    profile = session.exec(select(Profile)).first()
    if profile:
        profile.sqlmodel_update(profile_in.model_dump())
    else:
        profile = Profile.model_validate(profile_in)
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile


@router.post("/infer-template", response_model=TemplateInferrerOutput)
async def infer_profile_template(
    current_user: CurrentUser,  # noqa: ARG001
    files: Annotated[list[UploadFile], File()] = [],  # noqa: B006
    template: Annotated[str, Form()] = "",
) -> Any:
    """
    Infer or refactor a profile template and placeholder substitution map.
    """
    if not files and not template.strip():
        raise HTTPException(status_code=422, detail="No PDF files or template provided")

    pdfs: list[bytes] = []
    for file in files:
        if not file.filename:
            raise HTTPException(status_code=422, detail="Invalid PDF filename")
        content = await file.read()
        if not content.startswith(b"%PDF-"):
            raise HTTPException(status_code=422, detail="Invalid PDF content")
        pdfs.append(content)

    return await infer_template(pdfs, template)


@router.post("/fill-demo", response_model=ProfileBase)
async def fill_demo_profile(
    current_user: CurrentUser,  # noqa: ARG001
    template: Annotated[str, Form()],
) -> Any:
    """
    Populate a profile template with coherent, realistic fake data, keeping
    sensitive placeholders in sensitive_data and inlining non-sensitive values.
    """
    if not template.strip():
        raise HTTPException(status_code=422, detail="No template provided")

    return await fill_profile_demo(template)


# AIGEN ADD END

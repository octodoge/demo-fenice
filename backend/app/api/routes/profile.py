# AIGEN ADD START

from contextlib import ExitStack
from typing import Any

import pymupdf
from fastapi import APIRouter, HTTPException, UploadFile
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.models import Profile, ProfileBase, ProfileCreate, ProfilePublic
from app.utils import get_profile, infer_template

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


@router.post("/infer-template", response_model=ProfileBase)
async def infer_profile_template(
    current_user: CurrentUser,  # noqa: ARG001
    files: list[UploadFile],
) -> Any:
    """
    Infer a profile template and sensitive data keys from example PDF forms.
    """
    if not files:
        raise HTTPException(status_code=422, detail="No PDF files provided")

    with ExitStack() as stack:
        docs: list[pymupdf.Document] = []
        for file in files:
            if not file.filename:
                raise HTTPException(status_code=422, detail="Invalid PDF filename")
            content = await file.read()
            if not content.startswith(b"%PDF-"):
                raise HTTPException(status_code=422, detail="Invalid PDF content")
            doc = stack.enter_context(pymupdf.open(stream=content, filetype="pdf"))
            docs.append(doc)

        return await infer_template(docs)


# AIGEN ADD END

# AIGEN REFS
# Custom response: https://fastapi.tiangolo.com/advanced/custom-response/
# AIGEN ADD START

from urllib.parse import quote

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import Response

router = APIRouter(prefix="/documents", tags=["documents"])


class PDFResponse(Response):
    media_type = "application/pdf"


@router.post("/", response_class=PDFResponse)
async def upload_document(file: UploadFile) -> PDFResponse:
    if not file.filename:
        raise HTTPException(status_code=422, detail="Invalid PDF filename")
    content_disposition = f"attachment; filename*=utf-8''{quote(file.filename)}"
    headers = {"Content-Disposition": content_disposition}

    content = await file.read()
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=422, detail="Invalid PDF content")

    return PDFResponse(headers=headers, content=content)


# AIGEN ADD END

# AIGEN REFS
# Custom response: https://fastapi.tiangolo.com/advanced/custom-response/
# AIGEN ADD START

from urllib.parse import quote

import pymupdf
from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import Response

from app.utils import (
    add_missing_widgets,
    clean_malformed_widgets,
    detect_missing_widgets,
    highlight_widgets,
    label_widgets,
    postprocess_missing_widgets,
)

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

    with pymupdf.open(stream=content, filetype="pdf") as doc:
        clean_malformed_widgets(doc)
        with pymupdf.open() as doc_copy:
            doc_copy.insert_pdf(doc)
            highlight_widgets(doc_copy)
            missing_widgets = await detect_missing_widgets(doc_copy)
        missing_widgets_post = postprocess_missing_widgets(doc, missing_widgets)
        add_missing_widgets(doc, missing_widgets_post)
        with pymupdf.open() as doc_copy:
            doc_copy.insert_pdf(doc)
            label_widgets(doc_copy)
            # value_keys_map = await infer_value_keys_map(doc_copy, value_keys)
        label_widgets(doc)  # TODO: continue as intended instead

        content = doc.tobytes()

    return PDFResponse(headers=headers, content=content)


# AIGEN ADD END

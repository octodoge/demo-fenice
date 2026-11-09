# AIGEN MOD START

# import logging
# from dataclasses import dataclass
# from datetime import UTC, datetime, timedelta
# from pathlib import Path
# from typing import Any

# import emails
# import jwt
# from jinja2 import Template
# from jwt.exceptions import InvalidTokenError

# from app.core import security
# from app.core.config import settings

# AIGEN MOD CONT

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from inspect import cleandoc
from pathlib import Path
from typing import Any, Literal

import emails
import jwt
import pymupdf
from jinja2 import Template
from jwt.exceptions import InvalidTokenError
from pydantic import BaseModel, Field, ValidationInfo, field_validator
from pydantic_ai import Agent, BinaryContent
from pydantic_ai.models.google import GoogleModel, GoogleModelSettings
from pydantic_ai.providers.google import GoogleProvider

from app.core import security
from app.core.config import settings

# AIGEN MOD END

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class EmailData:
    html_content: str
    subject: str


def render_email_template(*, template_name: str, context: dict[str, Any]) -> str:
    template_str = (
        Path(__file__).parent / "email-templates" / template_name
    ).read_text()
    template: Template = Template(template_str)
    html_content = template.render(context)
    return html_content


def send_email(
    *,
    email_to: str,
    subject: str = "",
    html_content: str = "",
) -> None:
    assert settings.emails_enabled, "no provided configuration for email variables"
    assert settings.EMAILS_FROM_EMAIL  # For type checker
    message = emails.message.Message(
        subject=subject,
        html=html_content,
        mail_from=(settings.EMAILS_FROM_NAME, settings.EMAILS_FROM_EMAIL),
    )
    smtp_options = {"host": settings.SMTP_HOST, "port": settings.SMTP_PORT}
    if settings.SMTP_TLS:
        smtp_options["tls"] = True
    elif settings.SMTP_SSL:
        smtp_options["ssl"] = True
    if settings.SMTP_USER:
        smtp_options["user"] = settings.SMTP_USER
    if settings.SMTP_PASSWORD:
        smtp_options["password"] = settings.SMTP_PASSWORD
    response = message.send(to=email_to, smtp=smtp_options)
    logger.info(f"send email result: {response}")


def generate_test_email(email_to: str) -> EmailData:
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Test email"
    html_content = render_email_template(
        template_name="test_email.html",
        context={"project_name": settings.PROJECT_NAME, "email": email_to},
    )
    return EmailData(html_content=html_content, subject=subject)


def generate_reset_password_email(email_to: str, email: str, token: str) -> EmailData:
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Password recovery for user {email}"
    link = f"{settings.FRONTEND_HOST}/reset-password?token={token}"
    html_content = render_email_template(
        template_name="reset_password.html",
        context={
            "project_name": settings.PROJECT_NAME,
            "username": email,
            "email": email_to,
            "valid_hours": settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS,
            "link": link,
        },
    )
    return EmailData(html_content=html_content, subject=subject)


def generate_new_account_email(
    email_to: str, username: str, password: str
) -> EmailData:
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - New account for user {username}"
    html_content = render_email_template(
        template_name="new_account.html",
        context={
            "project_name": settings.PROJECT_NAME,
            "username": username,
            "password": password,
            "email": email_to,
            "link": settings.FRONTEND_HOST,
        },
    )
    return EmailData(html_content=html_content, subject=subject)


def generate_password_reset_token(email: str) -> str:
    delta = timedelta(hours=settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS)
    now = datetime.now(UTC)
    expires = now + delta
    exp = expires.timestamp()
    encoded_jwt = jwt.encode(
        {"exp": exp, "nbf": now, "sub": email},
        settings.SECRET_KEY,
        algorithm=security.ALGORITHM,
    )
    return encoded_jwt


def verify_password_reset_token(token: str) -> str | None:
    try:
        decoded_token = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        return str(decoded_token["sub"])
    except InvalidTokenError:
        return None


# AIGEN ADD START


# TODO: implement
def clean_malformed_widgets(doc: pymupdf.Document) -> None:
    pass


def highlight_widgets(doc: pymupdf.Document) -> None:
    for page in doc.pages():
        for widget in page.widgets():
            if widget.rect and not widget.rect.is_empty:
                widget.border_color = (1, 0, 0)
                widget.update()


ai_studio_api_key = settings.AI_STUDIO_API_KEY or "invalid-api-key"


class MissingWidget(BaseModel):
    page: int = Field(description="The page where the widget is missing.")
    box_2d: list[int] = Field(
        description=(
            "The 2D bounding box of the missing widget on the page as "
            "[ymin, xmin, ymax, xmax] normalized to 0-1000."
        ),
    )
    type: Literal["text", "checkbox", "signature"] = Field(
        description="The type of the missing widget."
    )

    @field_validator("page")
    @classmethod
    def validate_page(cls, page: int, info: ValidationInfo) -> int:
        assert isinstance(info.context, DetectorDeps)
        if not 0 <= page < len(info.context.doc):
            raise ValueError("invalid page")
        return page

    @field_validator("box_2d")
    @classmethod
    def validate_box_2d(cls, box_2d: list[int]) -> list[int]:
        ymin, xmin, ymax, xmax = box_2d
        if not (0 <= ymin < ymax <= 1000 and 0 <= xmin < xmax <= 1000):
            raise ValueError("invalid bounding box")
        return box_2d


@dataclass
class DetectorDeps:
    doc: pymupdf.Document


widget_detector = Agent(
    GoogleModel(
        "gemini-3.8-flash",
        provider=GoogleProvider(api_key=ai_studio_api_key),
    ),
    model_settings=GoogleModelSettings(thinking="medium"),
    output_type=list[MissingWidget],
    deps_type=DetectorDeps,
    validation_context=lambda ctx: ctx.deps,
    instructions=cleandoc(
        """
        You will receive images corresponding to pages of a PDF form.
        Each image is preceded by its page index (ignore page numbers on the image).
        Interactive form fields (widgets) are highlighted with red borders.
        Areas expecting inputs (e.g. empty boxes, blank areas above underlines,
        checkboxes, etc.) not showing red borders are missing a widget (they are not
        interactive).
        Often, all widgets are missing, so no red borders are present at all.
        Detect all missing widgets of type "text", "checkbox" and "signature", if any
        (ignore other types).
        This includes specifying for each missing widget a 2D box that would bound it if
        inserted.
        Each image has its own independent box coordinate system (with y=0 at the top),
        so never use cumulative coordinates across images.
        For "text" widgets, ensure that:
        * The bottom of the box rests along the underline or the text baseline.
        * The box starts strictly after any label or colon, never overlapping text.
        * The box spans the full input area.
        """
    ),
)


# TODO: in final product would be better to process all pages in parallel (slightly
# higher cost but faster and less error prone for the model)
async def detect_missing_widgets(doc: pymupdf.Document) -> list[MissingWidget]:
    if len(doc) == 0:
        return []

    prompt_parts: list[str | BinaryContent] = []
    for page_idx, page in enumerate(doc.pages()):
        prompt_parts.append(f"--- Page {page_idx} ---")
        pix = page.get_pixmap(dpi=150)
        prompt_parts.append(
            BinaryContent(data=pix.tobytes("png"), media_type="image/png")
        )

    result = await widget_detector.run(prompt_parts, deps=DetectorDeps(doc=doc))
    return result.output


def postprocess_missing_widgets(widgets: list[MissingWidget]) -> None:
    a4_ratio: float = 297 / 210

    text_height: int = 16
    left_padding: int = 4
    min_text_width: int = round(text_height * a4_ratio)
    checkbox_half_h: int = 12 // 2
    checkbox_half_w: int = round(checkbox_half_h * a4_ratio)
    signature_half_h: int = 32 // 2
    signature_half_w: int = round(signature_half_h * 2 * a4_ratio)

    for widget in widgets:
        ymin, xmin, ymax, xmax = widget.box_2d
        y_center: int = (ymin + ymax) // 2
        x_center: int = (xmin + xmax) // 2

        if widget.type == "text":
            ymax = max(text_height, ymax)
            ymin = ymax - text_height
            xmin = min(xmin + left_padding, 1000 - min_text_width)
            xmax = max(xmin + min_text_width, xmax)

        elif widget.type == "checkbox":
            y_center = min(max(checkbox_half_h, y_center), 1000 - checkbox_half_h)
            x_center = min(max(checkbox_half_w, x_center), 1000 - checkbox_half_w)
            ymin = y_center - checkbox_half_h
            xmin = x_center - checkbox_half_w
            ymax = y_center + checkbox_half_h
            xmax = x_center + checkbox_half_w

        elif widget.type == "signature":
            y_center = min(max(signature_half_h, y_center), 1000 - signature_half_h)
            x_center = min(max(signature_half_w, x_center), 1000 - signature_half_w)
            ymin = y_center - signature_half_h
            xmin = x_center - signature_half_w
            ymax = y_center + signature_half_h
            xmax = x_center + signature_half_w

        widget.box_2d = [ymin, xmin, ymax, xmax]


# TODO: review
def add_missing_widgets(
    doc: pymupdf.Document, missing_widgets: list[MissingWidget]
) -> None:
    type_map = {
        "text": pymupdf.mupdf.PDF_WIDGET_TYPE_TEXT,
        "checkbox": pymupdf.mupdf.PDF_WIDGET_TYPE_CHECKBOX,
        "signature": pymupdf.mupdf.PDF_WIDGET_TYPE_SIGNATURE,
    }

    for idx, missing_widget in enumerate(missing_widgets):
        if not (0 <= missing_widget.page < len(doc)):
            continue
        page = doc[missing_widget.page]
        ymin, xmin, ymax, xmax = missing_widget.box_2d
        x0 = (xmin / 1000) * page.rect.width
        y0 = (ymin / 1000) * page.rect.height
        x1 = (xmax / 1000) * page.rect.width
        y1 = (ymax / 1000) * page.rect.height

        rect = pymupdf.Rect(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        if rect.is_empty:
            continue

        widget = pymupdf.Widget()
        widget.rect = rect
        widget.field_type = type_map.get(
            missing_widget.type, pymupdf.mupdf.PDF_WIDGET_TYPE_TEXT
        )
        widget.field_name = f"{missing_widget.type}_{missing_widget.page}_{idx}"
        page.add_widget(widget)


# AIGEN ADD END

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
from pydantic import BaseModel, Field
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


def highlight_widgets(doc: pymupdf.Document) -> None:
    for page in doc.pages():
        for widget in page.widgets():
            if widget.rect and not widget.rect.is_empty:
                widget.border_color = (1, 0, 0)
                widget.update()


# TODO: parse from .env.local
ai_studio_api_key = settings.AI_STUDIO_API_KEY or "invalid-api-key"


class MissingWidget(BaseModel):
    page: int = Field(description="The page where the widget should be placed.")
    box_2d: list[int] = Field(
        description="The 2D bounding box where to place the widget on the page, as [ymin, xmin, ymax, xmax] normalized to 0-1000."
    )
    type: Literal["text", "checkbox", "signature"] = Field(
        description="The type of widget to place."
    )


widget_detector = Agent(
    GoogleModel(
        "gemini-3.8-flash",
        provider=GoogleProvider(api_key=ai_studio_api_key),
    ),
    model_settings=GoogleModelSettings(thinking="medium"),
    output_type=list[MissingWidget],
    instructions=cleandoc(
        """
        You will receive images corresponding to pages of a PDF form.
        Pre-existing interactive form fields (widgets) are highlighted with red borders.
        If an area expects user input (e.g. an empty space or underline for text or signatures, a checkbox, etc.) but lacks a red border, a widget is missing.
        Often all widgets are missing, so you might not see any red borders at all.
        Detect all missing widgets of type "text", "checkbox", and "signature".
        Ignore widgets of other types.
        """
    ),
)


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

    result = await widget_detector.run(prompt_parts)
    return result.output


def add_missing_widgets(
    doc: pymupdf.Document, missing_widgets: list[MissingWidget]
) -> None:
    pass  # TODO: implement


# AIGEN ADD END

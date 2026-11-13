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
from itertools import product
from pathlib import Path
from string import Formatter, ascii_uppercase
from typing import Annotated, Any, Literal, Self

import emails
import jwt
import pymupdf
from jinja2 import Template
from jwt.exceptions import InvalidTokenError
from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    ValidationInfo,
    create_model,
    field_validator,
    model_validator,
)
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
                color = (1, 0, 0)
                widget.border_color = color
                widget.update()
                if widget.field_type == pymupdf.mupdf.PDF_WIDGET_TYPE_SIGNATURE:
                    page.draw_rect(widget.rect, color=color)


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


class MissingWidgetPost(BaseModel):
    page: int
    rect: list[float]
    type: int


TEXT_HEIGHT: float = 16
LEFT_MARGIN: float = 4
MIN_TEXT_WIDTH: float = TEXT_HEIGHT
CHECKBOX_HALF_H: float = 12 / 2
CHECKBOX_HALF_W: float = CHECKBOX_HALF_H
SIGNATURE_HALF_H: float = 32 / 2
SIGNATURE_HALF_W: float = SIGNATURE_HALF_H * 2


def postprocess_missing_widgets(
    doc: pymupdf.Document, widgets: list[MissingWidget]
) -> list[MissingWidgetPost]:
    type_map = {
        "text": pymupdf.mupdf.PDF_WIDGET_TYPE_TEXT,
        "checkbox": pymupdf.mupdf.PDF_WIDGET_TYPE_CHECKBOX,
        "signature": pymupdf.mupdf.PDF_WIDGET_TYPE_SIGNATURE,
    }

    result: list[MissingWidgetPost] = []
    for widget in widgets:
        page = doc[widget.page]
        ymin, xmin, ymax, xmax = widget.box_2d
        x0 = (xmin / 1000) * page.rect.width
        y0 = (ymin / 1000) * page.rect.height
        x1 = (xmax / 1000) * page.rect.width
        y1 = (ymax / 1000) * page.rect.height

        y_center = (y0 + y1) / 2
        x_center = (x0 + x1) / 2

        if widget.type == "text":
            y1 = max(TEXT_HEIGHT, y1)
            y0 = y1 - TEXT_HEIGHT
            x0 = min(x0 + LEFT_MARGIN, page.rect.width - MIN_TEXT_WIDTH)
            x1 = max(x0 + MIN_TEXT_WIDTH, x1)

        elif widget.type == "checkbox":
            y_center = min(
                max(CHECKBOX_HALF_H, y_center), page.rect.height - CHECKBOX_HALF_H
            )
            x_center = min(
                max(CHECKBOX_HALF_W, x_center), page.rect.width - CHECKBOX_HALF_W
            )
            y0 = y_center - CHECKBOX_HALF_H
            x0 = x_center - CHECKBOX_HALF_W
            y1 = y_center + CHECKBOX_HALF_H
            x1 = x_center + CHECKBOX_HALF_W

        elif widget.type == "signature":
            y_center = min(
                max(SIGNATURE_HALF_H, y_center), page.rect.height - SIGNATURE_HALF_H
            )
            x_center = min(
                max(SIGNATURE_HALF_W, x_center), page.rect.width - SIGNATURE_HALF_W
            )
            y0 = y_center - SIGNATURE_HALF_H
            x0 = x_center - SIGNATURE_HALF_W
            y1 = y_center + SIGNATURE_HALF_H
            x1 = x_center + SIGNATURE_HALF_W

        result.append(
            MissingWidgetPost(
                page=widget.page,
                rect=[x0, y0, x1, y1],
                type=type_map[widget.type],
            )
        )
    return result


def add_missing_widgets(
    doc: pymupdf.Document, missing_widgets: list[MissingWidgetPost]
) -> None:
    for idx, missing_widget in enumerate(missing_widgets):
        page = doc[missing_widget.page]
        rect = pymupdf.Rect(missing_widget.rect)
        widget = pymupdf.Widget()
        widget.rect = rect
        widget.field_type = missing_widget.type
        widget.field_name = f"missing_widget_{missing_widget.page}_{idx}"
        page.add_widget(widget)


def _identify_widgets(doc: pymupdf.Document) -> list[dict[str, pymupdf.Widget]]:
    """
    Needed because field_name is required on widget addition and immutable afterwards.
    """
    lookup = []
    ids = [f"{a}{b}" for a, b in product(ascii_uppercase, repeat=2)]
    for page in doc.pages():
        widgets = sorted(page.widgets(), key=lambda w: (w.rect.y0, w.rect.x0))
        assert len(widgets) <= len(ids)
        lookup.append(dict(zip(ids, widgets, strict=False)))
    return lookup


def label_widgets(doc: pymupdf.Document) -> None:

    # font size
    badge_h: float = 10
    padding: float = 1
    fontname: str = "helv"
    font = pymupdf.Font(fontname)
    cap_height_ratio = font.glyph_bbox(ord("H")).height
    fontsize = (badge_h - 2 * padding) / cap_height_ratio

    # badge width
    lookup = _identify_widgets(doc)
    ids = [id for page_lookup in lookup for id in page_lookup.keys()]
    if not ids:
        return
    max_text_w = max(font.text_length(id, fontsize) for id in ids)
    badge_w = max_text_w + 2 * padding

    colors = {
        pymupdf.mupdf.PDF_WIDGET_TYPE_TEXT: (0.7, 0.0, 0.0),  # dark red
        pymupdf.mupdf.PDF_WIDGET_TYPE_CHECKBOX: (0.0, 0.2, 0.65),  # dark blue
        pymupdf.mupdf.PDF_WIDGET_TYPE_SIGNATURE: (0.0, 0.5, 0.15),  # dark green
    }
    for page, page_lookup in zip(doc.pages(), lookup, strict=True):
        for id, widget in page_lookup.items():
            assert widget.rect is not None
            color = colors[widget.field_type]

            # widget rect
            page.draw_rect(widget.rect, color=color)

            # badge rect
            x0 = min(widget.rect.x0, widget.rect.x1 - badge_w)
            y0 = widget.rect.y0
            rect = pymupdf.Rect(x0, y0, x0 + badge_w, y0 + badge_h)
            page.draw_rect(rect, fill=color, color=color)

            # badge text
            text_w = font.text_length(id, fontsize)
            baseline_x0 = x0 + (badge_w - text_w) / 2
            baseline_y0 = y0 + badge_h - padding
            page.insert_text(
                pymupdf.Point(baseline_x0, baseline_y0),
                id,
                fontname=fontname,
                fontsize=fontsize,
                color=(1, 1, 1),
            )


value_inferrer = Agent(
    GoogleModel(
        "gemini-3.8-flash",
        provider=GoogleProvider(api_key=ai_studio_api_key),
    ),
    model_settings=GoogleModelSettings(thinking="medium"),
    instructions=cleandoc(
        """
        You will receive a company profile (with sensitive values redacted as
        {placeholder} tags) and images of PDF form pages.
        Each page is preceded by its key (e.g. page_0, page_1).
        Fillable widgets are outlined and labeled with a 2-letter badge ID
        (red = text, blue = checkbox; ignore green signature widgets).
        For each widget ID:
        - Text widgets: return the text to fill in. You may use the exact
          {placeholder} tags from the profile as Python format placeholders
          (e.g. "{company_name} - {vat_number}"). Escape literal braces as {{ }}.
        - Checkboxes: return true or false.
        - If a field cannot be filled (missing info or a checkbox depends on
          a redacted {placeholder}), DO NOT guess: return an Annotation with a
          concise note explaining what is needed (and how to improve the profile).
        """
    ),
)


class Profile(BaseModel):
    template: str
    sensitive_data: dict[str, str]

    @model_validator(mode="after")
    def validate_sensitive_data(self) -> Self:
        try:
            template_keys = {
                field_name.split(".")[0].split("[")[0]
                for _, field_name, _, _ in Formatter().parse(self.template)
                if field_name is not None
            }
        except ValueError as err:
            raise ValueError(
                f"Invalid format string syntax in template: {err}"
            ) from err

        missing_keys = template_keys - set(self.sensitive_data.keys())
        if missing_keys:
            missing_str = ", ".join(sorted(missing_keys))
            raise ValueError(
                f"Missing sensitive data for placeholder(s) in template: {missing_str}"
            )
        return self


def get_profile() -> Profile:
    return Profile(
        template=cleandoc(
            """
            Company Name: {company_name}
            Legal Form: S.r.l. (Limited Liability Company)
            VAT Number: {vat_number}
            Tax Code: {tax_code}
            Registered Office: {address}, {postal_code} {city} ({province}), Italy
            PEC / Email: {pec_email}
            Phone: {phone}
            IBAN: {iban}
            Legal Representative: {legal_rep_name} (Tax ID: {legal_rep_tax_code})

            Company Details:
            - Micro/Small Enterprise: Yes (10-49 employees)
            - Year Established: 2019
            - Sector: Software Development & IT Consulting
            - Certifications: ISO 9001
            - Registered in the Chamber of Commerce (CCIAA)
            - Not in liquidation or bankruptcy; no pending tax arrears
            """
        ),
        sensitive_data={
            "company_name": "Fenice Tech S.r.l.",
            "vat_number": "IT12345678901",
            "tax_code": "12345678901",
            "address": "Via Roma 42",
            "postal_code": "20121",
            "city": "Milano",
            "province": "MI",
            "pec_email": "fenicetech@pec.it",
            "phone": "+39 02 1234567",
            "iban": "IT60X0542811101000000123456",
            "legal_rep_name": "Mario Rossi",
            "legal_rep_tax_code": "RSSMRA80A01F205X",
        },
    )


async def infer_values(doc: pymupdf.Document, profile: Profile) -> BaseModel | None:
    output_schema = build_output_schema(doc, set(profile.sensitive_data.keys()))
    if not output_schema.model_fields:
        return None

    prompt_parts: list[str | BinaryContent] = [
        f"Company profile:\n{profile.template}",
    ]
    for page_idx, page in enumerate(doc.pages()):
        prompt_parts.append(f"--- page_{page_idx} ---")
        pix = page.get_pixmap(dpi=150)
        prompt_parts.append(
            BinaryContent(data=pix.tobytes("png"), media_type="image/png")
        )

    result = await value_inferrer.run(prompt_parts, output_type=output_schema)
    return result.output


class Annotation(BaseModel):
    note: str


def _make_format_str(allowed_keys: set[str]) -> type[str]:
    def _validate(value: str) -> str:
        try:
            keys = {
                name for _, name, _, _ in Formatter().parse(value) if name is not None
            }
        except ValueError as err:
            raise ValueError(f"Invalid format string syntax: {err}") from err

        if unknown := keys - allowed_keys:
            raise ValueError(f"Unknown placeholder(s): {', '.join(sorted(unknown))}")
        return value

    return Annotated[str, AfterValidator(_validate)]  # type: ignore


def build_output_schema(
    doc: pymupdf.Document, allowed_keys: set[str]
) -> type[BaseModel]:
    FormatStr = _make_format_str(allowed_keys)
    type_map: dict[int, Any] = {
        pymupdf.mupdf.PDF_WIDGET_TYPE_TEXT: FormatStr | Annotation,
        pymupdf.mupdf.PDF_WIDGET_TYPE_CHECKBOX: bool | Annotation,
    }

    pages: dict[str, Any] = {}
    for idx, page_lookup in enumerate(_identify_widgets(doc)):
        fields: dict[str, Any] = {
            wid: (type_map[w.field_type], ...)
            for wid, w in page_lookup.items()
            if w.field_type in type_map
        }
        if fields:
            page_model = create_model(f"Page{idx}Model", **fields)
            pages[f"page_{idx}"] = (page_model, ...)

    return create_model("OutputSchema", **pages)


def _add_review_annot(page: pymupdf.Page, rect: pymupdf.Rect, note: str) -> None:
    icon_size = 24
    pr = page.rect
    x = rect.x1 + 2 if rect.x1 + 2 + icon_size <= pr.x1 else rect.x0 - icon_size
    x = min(max(x, pr.x0 + 2), pr.x1 - icon_size)
    y = min(max(rect.y0, pr.y0 + 2), pr.y1 - icon_size)

    annot = page.add_text_annot(pymupdf.Point(x, y), note, icon="Note")
    annot.set_colors(stroke=(1, 0, 0))
    annot.set_flags(annot.flags & ~pymupdf.mupdf.PDF_ANNOT_IS_PRINT)
    annot.update()


def fill_pdf(doc: pymupdf.Document, values: BaseModel, profile: Profile) -> None:
    lookup = _identify_widgets(doc)
    for page_key, page_model in values:
        page_idx = int(page_key.removeprefix("page_"))
        page = doc[page_idx]
        page_lookup = lookup[page_idx]

        for wid, val in page_model:
            widget = page_lookup[wid]
            if isinstance(val, Annotation):
                assert widget.rect is not None
                _add_review_annot(page, widget.rect, val.note)
            elif isinstance(val, bool):
                widget.field_value = val
                widget.update()
            elif isinstance(val, str):
                widget.field_value = val.format(**profile.sensitive_data)
                widget.update()


# AIGEN ADD END

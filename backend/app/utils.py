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
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

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
)
from pydantic_ai import Agent, BinaryContent
from pydantic_ai.models.google import GoogleModel, GoogleModelSettings
from pydantic_ai.providers.google import GoogleProvider
from sqlmodel import Session, select

from app.core import security
from app.core.config import settings
from app.models import Profile, ProfileBase

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


# AIGEN REFS
"""
Choosing a LLM: https://aistudio.google.com/docs/choosing-a-model
"""
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
    # TODO: adapt all code: drop "signature"
    type: Literal["text", "multiline_text", "checkbox", "signature"] = Field(
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
        "gemini-4-carbon",  # Carbon sota now for objDec. Use faster only if same result
        provider=GoogleProvider(api_key=ai_studio_api_key),
    ),
    model_settings=GoogleModelSettings(
        thinking="low"  # no need to think at all here (is a waste of time and money)
    ),
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
        Detect all missing widgets of type "text", "multiline_text", "checkbox" and
        "signature", if any (ignore other types).
        This includes specifying for each missing widget a 2D box that would bound it if
        inserted.
        Each image has its own independent box coordinate system (with y=0 at the top),
        so never use cumulative coordinates across images.
        For "text" (single-line) widgets, ensure that:
        * The bottom of the box rests along the underline or the text baseline.
        * The box starts strictly after any label or colon, never overlapping text.
        * The box spans the full input area.
        For "multiline_text" widgets:
        * Use for tall open rectangular boxes or blank areas expecting multiple lines
          of text (for stacked horizontal underlines, use separate "text" widgets
          instead, one per line).
        * Bound the full empty interior of the box without overlapping its borders or
          any header/label text.
        """
    ),
)


# TODO: in final product would be better to process all pages in parallel (slightly
# higher cost but faster and less error prone for the model). but we should give context
# about last sentences in prev page IMO to catch edge cases. Or maybe do it only if 4+
# pages to avoid creating too many request that may end up being queued


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
    is_multiline: bool = False


TEXT_HEIGHT: float = 12
LEFT_MARGIN: float = 1
MIN_TEXT_WIDTH: float = TEXT_HEIGHT
MULTILINE_MARGIN: float = 0.5
CHECKBOX_HALF_H: float = 12 / 2
CHECKBOX_HALF_W: float = CHECKBOX_HALF_H
SIGNATURE_HALF_H: float = 32 / 2
SIGNATURE_HALF_W: float = SIGNATURE_HALF_H * 2


def postprocess_missing_widgets(
    doc: pymupdf.Document, widgets: list[MissingWidget]
) -> list[MissingWidgetPost]:
    type_map = {
        "text": pymupdf.mupdf.PDF_WIDGET_TYPE_TEXT,
        "multiline_text": pymupdf.mupdf.PDF_WIDGET_TYPE_TEXT,
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

        elif widget.type == "multiline_text":
            x0 = min(x0 + MULTILINE_MARGIN, page.rect.width - MIN_TEXT_WIDTH)
            x1 = max(x0 + MIN_TEXT_WIDTH, x1 - MULTILINE_MARGIN)
            y0_in = y0 + MULTILINE_MARGIN
            y1_in = y1 - MULTILINE_MARGIN
            if y1_in - y0_in < TEXT_HEIGHT:
                half_h = TEXT_HEIGHT / 2
                y_center = min(max(half_h, y_center), page.rect.height - half_h)
                y0 = y_center - half_h
                y1 = y_center + half_h
            else:
                y0, y1 = y0_in, y1_in

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
                is_multiline=widget.type == "multiline_text",
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
        if missing_widget.type == pymupdf.mupdf.PDF_WIDGET_TYPE_TEXT:
            widget.text_font = "Helv"
        if missing_widget.is_multiline:
            widget.field_flags |= pymupdf.mupdf.PDF_TX_FIELD_IS_MULTILINE
        widget.field_name = f"missing_widget_{missing_widget.page}_{idx}"
        page.add_widget(widget)


def _identify_widgets(page: pymupdf.Page) -> dict[str, pymupdf.Widget]:
    """
    Needed because field_name is required on widget addition and immutable afterwards.
    Takes `page` so the caller keeps a ref to it: PyMuPDF widgets don't hold a
    Python ref to their Page, so garbage-collecting `page` unbinds them in C and
    breaks `widget.update()`.
    """
    ids = [f"{a}{b}" for a, b in product(ascii_uppercase, repeat=2)]
    widgets = sorted(page.widgets(), key=lambda w: (w.rect.y0, w.rect.x0))
    assert len(widgets) <= len(ids)
    return dict(zip(ids, widgets, strict=False))


def label_widgets(doc: pymupdf.Document) -> None:

    # font size
    badge_h: float = 10
    padding: float = 1
    fontname: str = "helv"
    font = pymupdf.Font(fontname)
    cap_height_ratio = font.glyph_bbox(ord("H")).height
    fontsize = (badge_h - 2 * padding) / cap_height_ratio

    # badge width
    lookup = [_identify_widgets(page) for page in doc.pages()]
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
    multiline_color = (0.85, 0.4, 0.0)  # dark orange
    for page, page_lookup in zip(doc.pages(), lookup, strict=True):
        for id, widget in page_lookup.items():
            assert widget.rect is not None
            is_multiline = (
                widget.field_type == pymupdf.mupdf.PDF_WIDGET_TYPE_TEXT
                and bool(widget.field_flags & pymupdf.mupdf.PDF_TX_FIELD_IS_MULTILINE)
            )
            color = multiline_color if is_multiline else colors[widget.field_type]

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
        "gemini-4-hydrogen",  # must be fast with medium thinking
        provider=GoogleProvider(api_key=ai_studio_api_key),
    ),
    model_settings=GoogleModelSettings(thinking="medium"),
    instructions=cleandoc(
        """
        You will receive the current date, a company profile (with sensitive values
        redacted as {placeholder} tags and checkbox options marked as "[x]" =
        accepted/selected, "[ ]" = not accepted/unselected, or "[]" =
        undefined/unanswered), and images of PDF form pages.
        Each page is preceded by its key (e.g. page_0, page_1).
        Fillable widgets are outlined and labeled with a 2-letter badge ID
        (red = single-line text, orange = multiline text, blue = checkbox;
        ignore green signature widgets).
        For each widget ID:
        - Text widgets (red and orange): return the text to fill in. You may use the
          exact {placeholder} tags from the profile as Python format placeholders
          (e.g. "{company_name} - {vat_number}"). Escape literal braces as {{ }}.
          Be mindful of each widget's available space in the image:
          - For red (single-line) widgets: if a box is narrow or small, condense,
            abbreviate, or reformulate non-sensitive text to fit cleanly while
            keeping essential meaning (e.g. "MI" instead of "Milano", "Leg. rappr."
            instead of "Legale rappresentante", "V.le" / "P.zza" instead of
            "Viale" / "Piazza", or short date formats). For multi-line areas split
            across consecutive single-line widgets, wrap long text across them to
            fit each line's width.
          - For orange (multiline) widgets: text wraps automatically and newlines
            ("\\n") are supported, so provide complete text without unnecessary
            abbreviations while still respecting the overall box area.
          - Use the provided current date for signing/submission date fields (e.g.
            "Data" or "Luogo e data" near the signature), formatted to match the
            form (e.g. DD/MM/YYYY or split day/month/year boxes). Never use it for
            historical dates missing from the profile (e.g. birth, registration, or
            document issue/expiry dates).
        - Checkboxes: return true or false. Always return true for mandatory
          "must-accept" declarations and consents where the applicant has no
          real choice (e.g. no criminal convictions, not in
          bankruptcy/liquidation, no tax arrears, having read the rules,
          privacy/GDPR consent).
        - If a field cannot be filled (missing info, or it depends on a redacted
          {placeholder} or an undefined "[]" checkbox in the profile), DO NOT guess:
          return an Annotation with a concise note explaining what is needed (and how
          to improve or complete the profile).
        """
    ),
)


def get_profile(session: Session) -> Profile:
    profile = session.exec(select(Profile)).first()
    if not profile:
        profile = Profile(template="", sensitive_data={})
        session.add(profile)
        session.commit()
        session.refresh(profile)
    return profile


async def infer_values(doc: pymupdf.Document, profile: Profile) -> BaseModel | None:
    output_schema = build_output_schema(doc, set(profile.sensitive_data.keys()))
    if not output_schema.model_fields:
        return None

    today = datetime.now(ZoneInfo("Europe/Rome")).date().isoformat()
    prompt_parts: list[str | BinaryContent] = [
        f"Current date: {today}",
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
    for idx, page in enumerate(doc.pages()):
        page_lookup = _identify_widgets(page)
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


def _fill_multiline_widget(
    doc: pymupdf.Document, widget: pymupdf.Widget, text: str
) -> None:
    assert widget.rect is not None
    valid_fonts = {"cour": "Cour", "tiro": "TiRo", "helv": "Helv", "zadb": "ZaDb"}
    fontname = valid_fonts.get((widget.text_font or "").lower(), "Helv")
    color = widget.text_color or (0, 0, 0)
    color_op = {1: "g", 3: "rg", 4: "k"}[len(color)]
    color_da = f"{' '.join(f'{c:g}' for c in color)} {color_op}"

    target_rect = pymupdf.Rect(0, 0, widget.rect.width, widget.rect.height)
    step = 0.5
    with pymupdf.open() as tmp_doc:
        tmp_page = tmp_doc.new_page(
            width=max(MIN_TEXT_WIDTH, target_rect.width),
            height=max(TEXT_HEIGHT, target_rect.height),
        )
        tw = pymupdf.Widget()
        tw.rect = pymupdf.Rect(0, 0, MIN_TEXT_WIDTH, TEXT_HEIGHT)
        tw.field_type = pymupdf.mupdf.PDF_WIDGET_TYPE_TEXT
        tw.field_name = "t"
        tw.field_value = "A"
        tmp_page.add_widget(tw)
        tw = next(tmp_page.widgets())
        tw.update()
        fontsize = float(
            tmp_page.get_text("dict")["blocks"][0]["lines"][0]["spans"][0]["size"]
        )

        tw.rect = target_rect
        tw.border_width = widget.border_width
        tw.field_flags = pymupdf.mupdf.PDF_TX_FIELD_IS_MULTILINE
        tw.update(sync_flags=True)
        margin = float(tmp_page.get_text("words", flags=0)[0][0])
        inner_rect = pymupdf.Rect(
            margin,
            margin,
            target_rect.width - margin,
            target_rect.height - margin,
        )

        tw.field_value = text
        while True:
            tmp_doc.xref_set_key(
                tw.xref, "DA", f"({color_da} /{fontname} {fontsize:g} Tf)"
            )
            tw.update()
            words = tmp_page.get_text("words", flags=0)
            if not words or fontsize <= step:
                break
            if all(inner_rect.contains(pymupdf.Rect(w[:4])) for w in words):
                break
            fontsize -= step

    orig_kind, orig_da = doc.xref_get_key(widget.xref, "DA")
    widget.text_fontsize = fontsize
    doc.xref_set_key(widget.xref, "DA", f"({color_da} /{fontname} {fontsize:g} Tf)")
    widget.field_value = text
    widget.update()
    widget.text_fontsize = 0
    doc.xref_set_key(
        widget.xref,
        "DA",
        "null" if orig_kind == "null" else f"({orig_da})",
    )


def fill_pdf(doc: pymupdf.Document, values: BaseModel, profile: Profile) -> None:
    for page_key, page_model in values:
        page_idx = int(page_key.removeprefix("page_"))
        page = doc[page_idx]
        page_lookup = _identify_widgets(page)

        for wid, val in page_model:
            widget = page_lookup[wid]
            if isinstance(val, Annotation):
                assert widget.rect is not None
                _add_review_annot(page, widget.rect, val.note)
            elif isinstance(val, bool):
                widget.field_value = val
                widget.update()
            elif isinstance(val, str):
                text = val.format(**profile.sensitive_data)
                if (
                    widget.field_flags & pymupdf.mupdf.PDF_TX_FIELD_IS_MULTILINE
                    and widget.text_fontsize == 0
                ):
                    _fill_multiline_widget(doc, widget, text)
                else:
                    widget.field_value = text
                    widget.update()


class TemplateInferrerOutput(BaseModel):
    template: str = Field(description="The inferred or refactored profile template.")
    placeholder_map: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Map of old placeholder names to new placeholder names (without curly "
            "braces) when placeholders from an existing template are renamed to "
            "follow the naming rules (e.g. {'nome_del_dichiarante': 'dichiarante_nome'})."
        ),
    )

    @field_validator("template")
    @classmethod
    def validate_template(cls, value: str) -> str:
        try:
            keys = [
                name for _, name, _, _ in Formatter().parse(value) if name is not None
            ]
        except ValueError as err:
            raise ValueError(f"Invalid format string syntax: {err}") from err

        if invalid := [k for k in keys if not k.isidentifier()]:
            raise ValueError(
                "Placeholders must be valid Python identifiers: "
                f"{', '.join(sorted(set(invalid)))}"
            )
        if bad_parts := [k for k in keys if len(k.split("_")) not in (2, 3)]:
            raise ValueError(
                "Placeholders must consist of 2 or 3 words separated by underscores: "
                f"{', '.join(sorted(set(bad_parts)))}"
            )
        return value

    @field_validator("placeholder_map")
    @classmethod
    def validate_placeholder_map(
        cls, value: dict[str, str], info: ValidationInfo
    ) -> dict[str, str]:
        template = info.data.get("template")
        if template is None:
            return value

        new_keys = {
            name for _, name, _, _ in Formatter().parse(template) if name is not None
        }
        old_keys = (
            info.context.old_keys
            if isinstance(info.context, TemplateInferrerDeps)
            else set()
        )

        for old_k, new_k in value.items():
            if not old_k.isidentifier() or not new_k.isidentifier():
                raise ValueError(
                    "Placeholder map keys and values must be valid identifiers "
                    f"without braces: {old_k!r} -> {new_k!r}"
                )
            if old_keys and old_k not in old_keys:
                raise ValueError(
                    f"Mapped source placeholder {old_k!r} was not in the existing template"
                )
            if new_k not in new_keys:
                raise ValueError(
                    f"Mapped target placeholder {new_k!r} is not present in the new template"
                )
        return value


@dataclass
class TemplateInferrerDeps:
    old_keys: set[str]


template_inferrer = Agent(
    GoogleModel(
        "gemini-4-neon",  # harder than value_inferrer +prefer to keep thinking medium
        provider=GoogleProvider(api_key=ai_studio_api_key),
    ),
    model_settings=GoogleModelSettings(thinking="medium"),
    output_type=TemplateInferrerOutput,
    deps_type=TemplateInferrerDeps,
    validation_context=lambda ctx: ctx.deps,
    instructions=cleandoc(
        """
        You will receive one or more PDF forms, an existing profile template, or both
        (PDFs only to build from scratch, a template only to refactor, or both to
        refactor and expand).

        Your goal is to produce a schematic, general, reusable profile template in
        Italian that generalizes the information required across all provided PDFs
        and any existing template, so the user can fill it once and reuse it to
        populate any similar form.

        ### 1. Structure & Indentation
        - Group related information into thematic sections. Each section begins with
          a descriptive title in ALL CAPS (e.g. `DATI DEL DICHIARANTE`).
        - Start the section's items on the line immediately below its title (no blank
          line after a title). Use a single blank line only to separate sections.
        - Follow this exact hierarchy and space indentation:
          - **Level 1 (bullet)**: column 0, prefix `"- "`. Colons are optional
            (key-value style or direct statements are both fine).
          - **Level 2 (nested bullet OR checkbox)**: 2 spaces indent under a Level 1
            bullet:
            - Nested bullet (`"  - "`) for sub-fields. Cannot have further children.
            - Checkbox (`"  [] "`, `"  [x] "`, or `"  [ ] "`) for selectable options.
              Never add `"- "` before a checkbox. Checkboxes are only allowed at
              Level 2 (never directly under a section title or under a Level 2 item).
          - **Level 3 (detail bullet under a checkbox only)**: 6 spaces indent
            (`"      - "`), aligning with the checkbox label text once marked
            (`"  [x] "` is 6 characters). Allowed only directly under a checkbox to
            capture conditional details for that option; cannot have further
            children.

        Example:
        ```
        DATI DEL DICHIARANTE
        - Nome: {dichiarante_nome}
        - Cognome: {dichiarante_cognome}
        - Nascita:
          - Data: {dichiarante_nascita_data}
          - Luogo: {dichiarante_nascita_luogo}
        - Qualifica:
          [] Legale rappresentante
          [] Procuratore (estremi procura: {dichiarante_qualifica_procura})
              - Data procura: {dichiarante_qualifica_data}
        ```

        ### 2. Placeholders vs. Checkboxes & Granularity
        Use common sense based on how real PDF forms collect each piece of data:
        - **Granularity**: prefer atomic, fine-grained fields over coarse composite
          ones—split composite data into its natural components (e.g. separate
          `Nome` and `Cognome` instead of a single full name; separate `Indirizzo`,
          `Numero civico`, `Comune`, `Provincia`, and `CAP` instead of a single
          address; separate `Data`, `Luogo`, and `Provincia` for birth or
          registration details) so both split and combined form fields can be
          populated unambiguously.
        - **Placeholders (`{placeholder}`)**: use for text inputs. Users either
          replace a placeholder inline with non-sensitive text or keep it and store
          the value in the sensitive data dictionary.
          - Every placeholder must be a lowercase Python identifier made of strictly
            2 or 3 single words separated by underscores (1 or 2 underscores total;
            do not use underscores inside a word).
          - The **first word** must identify the section and be unique to that
            section so placeholders stay alphabetically grouped by section (e.g.
            `dichiarante`, `impresa`, `banca`).
          - Word count follows the item's position in the hierarchy:
            - **2 words** (`{section_field}`): on a Level 1 bullet (`"- "`).
            - **3 words** (`{section_parent_detail}`): on anything nested under a
              Level 1 bullet—Level 2 regular bullets (`"  - "`), Level 2 checkbox
              lines (`"  [] "`), and Level 3 detail bullets under a checkbox
              (`"      - "`)—where the second word identifies the Level 1 bullet
              and the third word identifies the specific detail.
        - **Checkboxes**: use for multiple-choice fields (single or multi-select)
          when the options are few or lengthy, making selection simpler than typing.
          When options are open-ended or numerous, use a `{placeholder}` instead
          (just as real PDFs use a text box).
          - States: `"[]"` = undefined (unanswered), `"[x]"` = accepted/selected,
            `"[ ]"` = not accepted/unselected.
          - Initialize all newly created checkboxes as `"[]"` (never pre-fill new
            options with `"[x]"` or `"[ ]"`).
          - Never include catch-all `"[] ..."` or blank `"[]"` options.

        ### 3. Refactoring & Merging an Existing Template
        - **Re-elaborate the whole template holistically (do not just append)**:
          Treat the existing template and the provided PDFs as a single unified
          set of requirements and redesign the entire template structure to be as
          clean, schematic, general, and non-redundant as if built from scratch.
          Never lazily tack new fields or sections onto the existing template when
          existing sections, bullets, or representations should be reorganized,
          merged, split, or generalized to accommodate the combined information.
        - **Eliminate all redundancy**: Actively deduplicate and unify
          overlapping fields or concepts across the existing template and the
          new PDFs into a single canonical representation, rather than keeping
          separate/redundant entries just to avoid altering existing lines.
        - **Prioritize the best structure over preserving old choices**:
          - Strictly enforce all structure, indentation, checkbox, and placeholder
            naming rules above across the entire output.
          - Re-evaluate every field's representation (`{placeholder}` vs.
            checkboxes vs. nested sub-fields) in light of all inputs combined.
          - If integrating new PDFs makes an open `{placeholder}` cleaner or more
            general than an existing checkbox group (e.g. options became too
            numerous, varied, or open-ended), convert it to a `{placeholder}`—even
            at the cost of discarding the previous checkbox choices.
          - When an existing checkbox group or resolved choice remains the right
            representation, preserve existing user choices as `"[x]"` (accepted)
            or `"[ ]"` (not accepted)—including when converting previously
            resolved choices into checkboxes—while keeping unanswered or newly
            added options as `"[]"`.
        - **Preserve data & map renamed placeholders**:
          - Preserve existing information and already-filled non-sensitive text
            within the newly refactored structure (without duplicating it).
          - Whenever an existing `{placeholder}` is renamed or consolidated
            during refactoring (e.g. `{nome_del_dichiarante}` ->
            `{dichiarante_nome}`), record the mapping in `placeholder_map` using
            bare identifier names without braces (e.g.
            `{"nome_del_dichiarante": "dichiarante_nome"}`) so existing sensitive
            data can be migrated without loss.

        ### 4. Exclusions
        - Ignore mandatory "must-accept" declarations and consents where the
          applicant has no real choice (e.g. no criminal convictions, not in
          bankruptcy/liquidation, no tax arrears, having read the rules,
          privacy/GDPR consent), as well as form-specific procedural fields (e.g.
          signature dates, attachment checklists).
        """
    ),
)


profile_filler_demo = Agent(
    GoogleModel(
        "gemini-4-hydrogen",
        provider=GoogleProvider(api_key=ai_studio_api_key),
    ),
    model_settings=GoogleModelSettings(thinking="medium"),
    output_type=ProfileBase,
    instructions=cleandoc(
        """
        You will receive a profile template (in Italian) containing {placeholder} tags
        and checkbox options ("[]" = undefined, "[x]" = accepted, "[ ]" = not accepted).
        Populate the profile with coherent, realistic Italian fake data without
        restructuring the template.

        Leave as much non-sensitive information visible in `template` as possible,
        storing in `sensitive_data` **only** the truly sensitive core:
        - **Sensitive data** (keep `{placeholder}` in `template` and put the fake
          value in `sensitive_data`): personal or identifying details, contact info,
          tax/ID codes, dates/places of birth, street names/numbers, bank/IBAN
          details, registration/policy/matricola numbers, and similar confidential
          fields (e.g. `{dichiarante_nome}`, `{dichiarante_cf}`, `{impresa_piva}`,
          `{impresa_sede_indirizzo}`, `{impresa_pec}`, `{banca_iban}`).
          - **Surface non-sensitive prefixes/qualifiers inline**: when a sensitive
            value naturally includes a generic, non-sensitive prefix, qualifier, or
            label, write that non-sensitive text directly in `template` around the
            `{placeholder}` and store only the sensitive part in `sensitive_data`
            (e.g. write `Via {impresa_sede_indirizzo}` with `impresa_sede_indirizzo:
            "Noncello"` instead of keeping `"Via Noncello"` in `sensitive_data`;
            write `Tribunale di {impresa_tribunale_sede}` with
            `impresa_tribunale_sede: "Milano"` instead of `"Tribunale di Milano"`;
            write `Agenzia delle Entrate di {agenzia_entrate_ufficio}` with
            `agenzia_entrate_ufficio: "Roma 1"` instead of `"Agenzia delle Entrate
            di Roma 1"`).
        - **Non-sensitive data** (replace the `{placeholder}` completely inline in
          `template` with the realistic Italian fake value, and omit it from
          `sensitive_data`): general, categorical, or descriptive info that does not
          identify or expose sensitive details (e.g. legal form like `S.r.l.`,
          company size like `Micro impresa`, role/title like `Legale rappresentante`,
          contract/account type like `Conto corrente bancario`, duration like
          `A tempo indeterminato`, ATECO/activity description, CCNL name, general
          status or exemption notes, or non-identifying broad values like `Italia`).

        Return a ProfileBase with:
        - template:
          - Keep the exact structure, sections, lines, wording, and indentation of
            the input template unchanged (do not add, remove, reorder, or rename any
            lines, and do not add or rename any `{placeholder}` tags; only inline
            non-sensitive values or surface non-sensitive prefixes/qualifiers around
            sensitive `{placeholder}` tags).
          - Keep sensitive `{placeholder}` tags intact in `template` (with any
            non-sensitive prefix/qualifier surfaced inline outside the braces).
          - Replace non-sensitive `{placeholder}` tags inline with their realistic
            Italian fake values.
          - Resolve every checkbox in the template so no undefined "[]" remains: make
            coherent, realistic selections across each checkbox group (not at random),
            explicitly marking every option as either "[x]" (accepted) or "[ ]" (not
            accepted).
        - sensitive_data:
          - Provide a coherent, realistic Italian fake value for every `{placeholder}`
            that remains in `template` (matching keys exactly; do not include keys
            for placeholders that were replaced inline).
          - Keep `sensitive_data` values as short and compact as realistically
            possible (e.g. short names, short street names, short emails/PECs,
            concise codes) so they fit comfortably even in tight PDF form fields.
        """
    ),
)


def _build_template_prompt_parts(
    pdfs: list[bytes],
    template: str = "",
) -> list[str | BinaryContent]:
    prompt_parts: list[str | BinaryContent] = []
    if template.strip():
        prompt_parts.append(f"Existing profile template:\n{template}")
    for pdf_idx, pdf in enumerate(pdfs):
        prompt_parts.append(f"--- Document {pdf_idx} ---")
        prompt_parts.append(BinaryContent(data=pdf, media_type="application/pdf"))
    return prompt_parts


async def infer_template(
    pdfs: list[bytes], template: str = ""
) -> TemplateInferrerOutput:
    prompt_parts = _build_template_prompt_parts(pdfs, template)
    if not prompt_parts:
        return TemplateInferrerOutput(template="", placeholder_map={})

    try:
        old_keys = {
            name for _, name, _, _ in Formatter().parse(template) if name is not None
        }
    except ValueError:
        old_keys = set()

    result = await template_inferrer.run(
        prompt_parts, deps=TemplateInferrerDeps(old_keys=old_keys)
    )
    return result.output


async def fill_profile_demo(template: str) -> ProfileBase:
    if not template.strip():
        return ProfileBase(template="", sensitive_data={})

    result = await profile_filler_demo.run(f"Profile template:\n{template}")
    output = result.output
    remaining_keys = {
        field_name.split(".")[0].split("[")[0]
        for _, field_name, _, _ in Formatter().parse(output.template)
        if field_name is not None
    }
    output.sensitive_data = {
        k: v for k, v in output.sensitive_data.items() if k in remaining_keys
    }
    return output


# AIGEN ADD END

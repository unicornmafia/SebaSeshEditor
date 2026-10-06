"""Whole-document PDF and SVG export.

Hieroglyphic lines are drawn by hieropy. For PDF, every line is printed onto one
shared reportlab canvas (instead of hieropy's one-canvas-per-fragment), so the output
stays vector with selectable text. For SVG, hieropy's per-line SVGs are nested inside
one document and the fonts used are subsetted and embedded so the file is portable.
"""

import base64
import importlib.resources as resources
import io
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from xml.sax.saxutils import escape

from fontTools import subset
from fontTools.ttLib import TTFont as FTFont
from hieropy import Options
from hieropy.printables import PrintedAny, PrintedPdf
from hieropy.unistructure import Fragment, chars_to_fallback
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

from . import hiero
from .documents import Document, size_of, text_of

FONT_DIR = Path(__file__).resolve().parent.parent / 'fonts'

# Text size relative to the hieroglyphic font size, and spacing between lines.
TEXT_SCALE = 0.5
LINE_GAP = 0.3
PAGE_MARGIN = 50

# mode -> (primary font, fallback font) as (registered name, file)
TEXT_FONTS = {
    'translit': (('SebaTranslit', 'NewAthenaUnicode-Italic.ttf'), ('SebaTranslitFallback', 'NotoSerif-Italic.ttf')),
    'latin': (('SebaSerif', 'NotoSerif-Regular.ttf'), None),
    'bold': (('SebaSerif-Bold', 'NotoSerif-Bold.ttf'), None),
    'italic': (('SebaSerif-Italic', 'NotoSerif-Italic.ttf'), None),
}


def hiero_font_path() -> Path:
    with resources.as_file(resources.files('hieropy.resources').joinpath('NewGardiner.ttf')) as path:
        return Path(path)


@lru_cache(maxsize=None)
def _cmap(filename: str) -> frozenset[int]:
    return frozenset(FTFont(FONT_DIR / filename, lazy=True).getBestCmap())


@lru_cache(maxsize=None)
def _register(name: str, filename: str) -> str:
    pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / filename)))
    return name


def text_runs(mode: str, text: str) -> list[tuple[tuple[str, str], str]]:
    """Split text into runs per font, using the fallback font for glyphs the primary lacks."""
    primary, fallback = TEXT_FONTS[mode]
    runs: list[tuple[tuple[str, str], str]] = []
    for ch in text:
        font = primary
        if fallback and ord(ch) not in _cmap(primary[1]) and ord(ch) in _cmap(fallback[1]):
            font = fallback
        if runs and runs[-1][0] == font:
            runs[-1] = (font, runs[-1][1] + ch)
        else:
            runs.append((font, ch))
    return runs


def text_width(mode: str, text: str, size: float) -> float:
    return sum(pdfmetrics.stringWidth(run, _register(*font), size) for font, run in text_runs(mode, text))


def wrap_text(mode: str, text: str, size: float, max_width: float) -> list[str]:
    lines: list[str] = []
    current = ''
    for word in text.split(' '):
        candidate = f'{current} {word}' if current else word
        if current and text_width(mode, candidate, size) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    lines.append(current)
    return lines


@dataclass
class HieroLine:
    fragment: Fragment
    options: Options


def _hiero_line(source: str, fontsize: int, imagetype: str, warnings: list[str], index: int,
                direction: str = 'hlr') -> HieroLine | None:
    interp = hiero.interpret(source)
    if not interp.ok:
        warnings.append(f'Line {index}: skipped, cannot be rendered ({interp.error})')
        return None
    if not interp.fragment.groups:
        return None
    return HieroLine(interp.fragment, Options(imagetype=imagetype, fontsize=fontsize, transparent=True,
                                              direction=direction))


# ---------------------------------------------------------------- PDF

class CanvasPrintedPdf(PrintedPdf):
    """hieropy PrintedPdf that draws onto an existing canvas instead of creating its own."""

    def __init__(self, canv, w, h, options):
        PrintedAny.__init__(self, w, h, 0, 0, options.rl(), options)
        self.canvas = canv

    def complete(self):
        save = self.canvas.save
        self.canvas.save = lambda: None  # PrintedPdf.complete ends the document; we must not
        try:
            super().complete()
        finally:
            self.canvas.save = save


def export_pdf(doc: Document) -> tuple[bytes, list[str]]:
    warnings: list[str] = []
    buffer = io.BytesIO()
    page_w, page_h = A4
    canv = rl_canvas.Canvas(buffer, pagesize=A4)
    canv.setTitle('SebaSesh document')
    avail_w = page_w - 2 * PAGE_MARGIN
    avail_h = page_h - 2 * PAGE_MARGIN
    y = page_h - PAGE_MARGIN

    def ensure_room(height: float):
        nonlocal y
        if y - height < PAGE_MARGIN and y < page_h - PAGE_MARGIN:
            canv.showPage()
            y = page_h - PAGE_MARGIN

    for i, line in enumerate(doc.lines, 1):
        fontsize = size_of(line, doc)
        gap = fontsize * LINE_GAP
        if line.mode == 'hiero':
            if not line.source.strip():
                y -= fontsize * 0.5
                continue
            hl = _hiero_line(line.source, fontsize, 'pdf', warnings, i, line.direction)
            if hl is None:
                continue
            with hiero.HIEROPY_LOCK:
                frag, options = hl.fragment, hl.options
                frag.format(options)
                w_em, h_em = frag.size(options)
                printed = CanvasPrintedPdf(canv, w_em + options.sep + 2 * options.hmargin,
                                           h_em + options.sep + 2 * options.vmargin, options)
                # Long lines (or tall vertical columns) are scaled down to fit the page.
                scale = min(1.0, avail_w / printed.width(), avail_h / printed.height())
                width, height = printed.width() * scale, printed.height() * scale
                ensure_room(height)
                # Right-to-left lines are set flush right, as in JSesh.
                x = page_w - PAGE_MARGIN - width if options.rl() else PAGE_MARGIN
                canv.saveState()
                canv.translate(x, y - height)
                canv.scale(scale, scale)
                for g in frag.groups:
                    printed.selectable_text += chars_to_fallback(str(g), options)
                    g.print(options, printed)
                printed.complete()
                canv.restoreState()
            if scale < 1:
                warnings.append(f'Line {i}: scaled down to fit the page')
            y -= height + gap
        else:
            size = fontsize * TEXT_SCALE
            leading = size * 1.35
            for sub in wrap_text(line.mode, text_of(line), size, avail_w):
                ensure_room(leading)
                x = PAGE_MARGIN
                baseline = y - size
                for font, run in text_runs(line.mode, sub):
                    name = _register(*font)
                    canv.setFont(name, size)
                    canv.drawString(x, baseline, run)
                    x += pdfmetrics.stringWidth(run, name, size)
                y -= leading
            y -= gap
    canv.save()
    return buffer.getvalue(), warnings


# ---------------------------------------------------------------- SVG

SVG_FONT_FAMILIES = {
    'translit': "SebaTranslit, SebaTranslitFallback, serif",
    'latin': "SebaSerif, serif",
    'bold': "SebaSerif-Bold, serif",
    'italic': "SebaSerif-Italic, serif",
}


def _font_face(family: str, path: Path, chars: set[str]) -> str:
    options = subset.Options()
    options.notdef_outline = True
    options.name_IDs = ['*']
    options.layout_features = ['*']
    font = FTFont(str(path))
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes={ord(c) for c in chars})
    subsetter.subset(font)
    out = io.BytesIO()
    font.save(out)
    data = base64.b64encode(out.getvalue()).decode('ascii')
    return f"@font-face {{ font-family: '{family}'; src: url(data:font/ttf;base64,{data}) format('truetype'); }}"


def export_svg(doc: Document, embed_fonts: bool = True) -> tuple[str, list[str]]:
    warnings: list[str] = []
    margin = doc.fontsize * 0.5
    gap = doc.fontsize * LINE_GAP
    y = margin
    width = 0.0
    # Right-to-left lines are placed flush right once the document width is known.
    body: list[str | tuple[str, float, float]] = []
    hiero_chars: set[str] = set()
    font_chars: dict[tuple[str, str], set[str]] = {}

    for i, line in enumerate(doc.lines, 1):
        fontsize = size_of(line, doc)
        gap = fontsize * LINE_GAP
        if line.mode == 'hiero':
            if not line.source.strip():
                y += fontsize * 0.5
                continue
            hl = _hiero_line(line.source, fontsize, 'svg', warnings, i, line.direction)
            if hl is None:
                continue
            svg, w, h = hiero.render_svg(hl.fragment, fontsize, transparent=True, direction=line.direction)
            hiero_chars.update(c for c in svg if ord(c) > 0x2000)
            if hl.options.rl():
                body.append((svg, w, y))
            else:
                body.append(svg.replace('<svg ', f'<svg x="{margin:g}" y="{y:g}" ', 1))
            width = max(width, w)
            y += h + gap
        else:
            text = text_of(line)
            size = fontsize * TEXT_SCALE
            for font, run in text_runs(line.mode, text):
                font_chars.setdefault(font, set()).update(run)
            body.append(
                f'<text x="{margin:g}" y="{y + size:g}" font-family="{SVG_FONT_FAMILIES[line.mode]}" '
                f'font-size="{size:g}" xml:space="preserve">{escape(text)}</text>')
            width = max(width, text_width(line.mode, text, size))
            y += size * 1.35 + gap

    total_w = width + 2 * margin
    total_h = y - gap + margin
    body = [part if isinstance(part, str) else
            part[0].replace('<svg ', f'<svg x="{total_w - margin - part[1]:g}" y="{part[2]:g}" ', 1)
            for part in body]
    style = ''
    if embed_fonts:
        faces = []
        if hiero_chars:
            faces.append(_font_face('NewGardiner', hiero_font_path(), hiero_chars))
        for (family, filename), chars in font_chars.items():
            faces.append(_font_face(family, FONT_DIR / filename, chars))
        if faces:
            style = '<style>' + '\n'.join(faces) + '</style>'
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="{total_w:g}" height="{total_h:g}" '
           f'viewBox="0 0 {total_w:g} {total_h:g}">{style}'
           f'<rect width="100%" height="100%" fill="white"/>' + ''.join(body) + '</svg>')
    return svg, warnings

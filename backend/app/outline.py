"""Turn text in SVG into glyph outlines, so the SVG needs no fonts.

Used for the copy-to-clipboard SVG: browsers sanitize SVG images on the clipboard and drop
<style> (and with it the embedded @font-face fonts), so text there would depend on fonts the
receiving application may not have.

hieropy draws each sign as a <tspan> positioned at (x+dx, y+dy) inside a <text>, or as its own
<text> with a transform (scaled, mirrored or rotated signs); hidden tspans (font-size 0) carry
the encoding for copy-and-paste and are dropped here. Text lines are shaped with HarfBuzz.
"""

import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

SVG_NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG_NS)
ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
ET.register_namespace('ev', 'http://www.w3.org/2001/xml-events')


class OutlineFont:
    def __init__(self, path: Path):
        self.font = TTFont(str(path))
        self.glyph_set = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap()
        self.upem = self.font['head'].unitsPerEm
        self.order = self.font.getGlyphOrder()
        self.hb_font = hb.Font(hb.Face(hb.Blob.from_file_path(str(path))))

    @lru_cache(maxsize=None)
    def path_d(self, glyph_name: str) -> str:
        pen = SVGPathPen(self.glyph_set)
        self.glyph_set[glyph_name].draw(pen)
        return pen.getCommands()

    def char_path(self, ch: str) -> str | None:
        name = self.cmap.get(ord(ch))
        return self.path_d(name) if name else None

    def shape(self, text: str) -> list[tuple[str, float, float, float]]:
        """(glyph path, x offset, y offset, advance) per glyph, in font units."""
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb_font, buf, {})
        return [(self.path_d(self.order[info.codepoint]), pos.x_offset, pos.y_offset, pos.x_advance)
                for info, pos in zip(buf.glyph_infos, buf.glyph_positions)]


@lru_cache(maxsize=None)
def load_font(path: str) -> OutlineFont:
    return OutlineFont(Path(path))


def glyph_element(d: str, x: float, y: float, size: float, upem: int, fill: str) -> str:
    """A glyph outline with its baseline origin at (x, y), at font size `size` px."""
    if not d:
        return ''
    s = size / upem
    return f'<path d="{d}" transform="translate({x:g},{y:g}) scale({s:g},{-s:g})" fill="{fill}"/>'


def _num(el: ET.Element, attr: str) -> float:
    try:
        return float(el.get(attr, '0'))
    except ValueError:
        return 0.0


def outline_hieropy_svg(svg: str, font_path: Path) -> str:
    """Replaces every <text> in a hieropy SVG with glyph outlines from `font_path`."""
    font = load_font(str(font_path))
    root = ET.fromstring(svg)
    for parent in list(root.iter()):
        for i, child in enumerate(list(parent)):
            if child.tag != f'{{{SVG_NS}}}text':
                continue
            group = ET.Element(f'{{{SVG_NS}}}g')
            if child.get('transform'):
                group.set('transform', child.get('transform'))
            parts: list[str] = []
            fill = child.get('fill', 'black')
            size = _num(child, 'font-size')
            if (child.text or '').strip() and size:  # a sign of its own, drawn at (x, y)
                d = font.char_path(child.text.strip())
                if d:
                    parts.append(glyph_element(d, _num(child, 'x'), _num(child, 'y'), size, font.upem, fill))
            for span in child:
                span_size = _num(span, 'font-size')
                text = (span.text or '').strip()
                if not text or not span_size:
                    continue  # hidden copy text
                d = font.char_path(text)
                if d:
                    x = _num(span, 'x') + _num(span, 'dx')
                    y = _num(span, 'y') + _num(span, 'dy')
                    parts.append(glyph_element(d, x, y, span_size, font.upem, span.get('fill', fill)))
            for el in ET.fromstring(f'<g xmlns="{SVG_NS}">' + ''.join(parts) + '</g>'):
                group.append(el)
            parent.remove(child)
            parent.insert(i, group)
    return ET.tostring(root, encoding='unicode')


def outline_text(runs: list[tuple[Path, str]], x: float, baseline: float, size: float, fill: str = 'black') -> str:
    """Outlines of a text line given as (font file, text) runs, shaped with HarfBuzz."""
    parts = []
    pen_x = x
    for path, run in runs:
        font = load_font(str(path))
        scale = size / font.upem
        for d, x_off, y_off, advance in font.shape(run):
            parts.append(glyph_element(d, pen_x + x_off * scale, baseline - y_off * scale, size, font.upem, fill))
            pen_x += advance * scale
    return ''.join(parts)

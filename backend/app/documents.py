"""Editor documents: import from and export to JSesh .gly, MdC, RES and Unicode text.

A document is a list of lines; each line has one ``mode``:

* ``hiero``    -- hieroglyphic; ``source`` is MdC, Unicode, or a hybrid (see hiero.py)
* ``translit`` -- ASCII transliteration (see translit.py)
* ``latin`` / ``bold`` / ``italic`` -- plain text
"""

import re
from collections import Counter

from hieropy import ResParser, ResUniConverter
from hieropy.uniconstants import UNI_STRING
from pydantic import BaseModel, Field

from . import hiero
from .convert import fragment_to_mdc, fragment_to_res
from .translit import ascii_to_unicode, unicode_to_ascii

MODES = ('hiero', 'translit', 'latin', 'bold', 'italic')
TEXT_MODES = MODES[1:]

# JSesh text markers: +l latin, +b bold, +i italic, +t transliteration, +s back to signs.
MODE_TO_JSESH = {'latin': 'l', 'bold': 'b', 'italic': 'i', 'translit': 't'}
JSESH_TO_MODE = {v: k for k, v in MODE_TO_JSESH.items()}

# Writing direction of a hieroglyphic line, as in hieropy/HieroJax/RES:
# h(orizontal)/v(ertical) + lr (left to right)/rl (right to left).
DIRECTIONS = ('hlr', 'hrl', 'vlr', 'vrl')
DIRECTION_NAMES = {'hlr': 'horizontal left-to-right', 'hrl': 'horizontal right-to-left',
                   'vlr': 'vertical left-to-right', 'vrl': 'vertical right-to-left'}


def make_jsesh_header(direction: str = 'hlr') -> str:
    # JSesh keeps one orientation and direction for the whole document.
    orientation = 'VERTICAL' if direction.startswith('v') else 'HORIZONTAL'
    flow = 'RIGHT_TO_LEFT' if direction.endswith('rl') else 'LEFT_TO_RIGHT'
    return (
        '++JSesh_Info 1.0 +s\n'
        f'++JSesh_page_orientation {orientation} +s\n'
        f'++JSesh_page_direction {flow} +s\n'
        f'++JSesh_text_direction {flow} +s\n'
        f'++JSesh_text_orientation {orientation} +s\n'
    )


def jsesh_direction(content: str) -> str:
    """Direction declared in a JSesh header (text_* settings win over page_*)."""
    def setting(name: str) -> str | None:
        for scope in ('text', 'page'):
            m = re.search(rf'\+\+JSesh_{scope}_{name}\s+(\w+)', content)
            if m:
                return m.group(1).upper()
        return None
    orientation = 'v' if setting('orientation') == 'VERTICAL' else 'h'
    flow = 'rl' if setting('direction') == 'RIGHT_TO_LEFT' else 'lr'
    return orientation + flow


class Line(BaseModel):
    mode: str = Field(default='hiero', pattern='^(hiero|translit|latin|bold|italic)$')
    source: str = ''
    # Per-line size; None means the document's font size.
    fontsize: int | None = Field(default=None, ge=8, le=400)
    # Writing direction (hieroglyphic lines only).
    direction: str = Field(default='hlr', pattern='^(hlr|hrl|vlr|vrl)$')


class Document(BaseModel):
    fontsize: int = Field(default=48, ge=8, le=400)
    lines: list[Line] = []


def size_of(line: Line, doc: 'Document') -> int:
    return line.fontsize or doc.fontsize


def text_of(line: Line) -> str:
    """Display text of a non-hieroglyphic line."""
    return ascii_to_unicode(line.source) if line.mode == 'translit' else line.source


# ---------------------------------------------------------------- export

def _line_to_mdc(line: Line, warnings: list[str], index: int) -> str | None:
    if line.mode != 'hiero':
        text = line.source.replace('\\', '\\\\').replace('+', '\\+')
        return f'+{MODE_TO_JSESH[line.mode]}{text}+s'
    interp = hiero.interpret(line.source)
    if not interp.ok:
        warnings.append(f'Line {index}: skipped, cannot be rendered ({interp.error})')
        return None
    if interp.source_format == 'mdc':
        # Keep the user's own MdC (with 'j' read as 'i'): it is what JSesh understands best.
        return interp.mdc
    with hiero.HIEROPY_LOCK:
        mdc, conv_warnings = fragment_to_mdc(interp.fragment)
    warnings.extend(f'Line {index}: {w}' for w in conv_warnings)
    return mdc


def _non_default_directions(doc: Document) -> list[int]:
    return [i for i, l in enumerate(doc.lines, 1) if l.mode == 'hiero' and l.direction != 'hlr']


def _line_list(numbers: list[int]) -> str:
    shown = ', '.join(map(str, numbers[:10]))
    return shown + (f' and {len(numbers) - 10} more' if len(numbers) > 10 else '')


def export_mdc(doc: Document, jsesh_header: bool) -> tuple[str, list[str]]:
    warnings: list[str] = []
    out = []
    hiero_lines = [(i, l) for i, l in enumerate(doc.lines, 1) if l.mode == 'hiero']
    if jsesh_header:
        counts = Counter(l.direction for _, l in hiero_lines)
        direction = counts.most_common(1)[0][0] if counts else 'hlr'
        differing = [i for i, l in hiero_lines if l.direction != direction]
        if differing:
            warnings.append(f'JSesh has one writing direction per document; written as {DIRECTION_NAMES[direction]}, '
                            f'which differs from line(s) {_line_list(differing)}')
        out.append(make_jsesh_header(direction))
    elif differing := _non_default_directions(doc):
        warnings.append(f'MdC has no writing direction; line(s) {_line_list(differing)} are not horizontal left-to-right')
    for i, line in enumerate(doc.lines, 1):
        mdc = _line_to_mdc(line, warnings, i)
        if mdc is not None:
            out.append(f'{mdc}-!\n')
    return ''.join(out), warnings


def export_res(doc: Document) -> tuple[str, list[str]]:
    warnings: list[str] = []
    out = []
    skipped_text = 0
    for i, line in enumerate(doc.lines, 1):
        if line.mode != 'hiero':
            skipped_text += 1
            continue
        interp = hiero.interpret(line.source)
        if not interp.ok:
            warnings.append(f'Line {i}: skipped, cannot be rendered ({interp.error})')
            continue
        with hiero.HIEROPY_LOCK:
            res, conv_warnings = fragment_to_res(interp.fragment)
        warnings.extend(f'Line {i}: {w}' for w in conv_warnings)
        header = f'[{line.direction}]' if line.direction != 'hlr' else ''
        out.append(header + res + '\n')
    if skipped_text:
        warnings.append(f'{skipped_text} text line(s) omitted: RES encodes hieroglyphs only')
    return ''.join(out), warnings


def export_unicode(doc: Document) -> tuple[str, list[str]]:
    warnings: list[str] = []
    if differing := _non_default_directions(doc):
        warnings.append(f'Unicode text has no writing direction; line(s) {_line_list(differing)} '
                        'are not horizontal left-to-right')
    out = []
    for i, line in enumerate(doc.lines, 1):
        if line.mode == 'hiero':
            interp = hiero.interpret(line.source)
            if not interp.ok:
                warnings.append(f'Line {i}: skipped, cannot be rendered ({interp.error})')
                continue
            out.append(interp.unicode + '\n')
        else:
            out.append(text_of(line) + '\n')
    return ''.join(out), warnings


# ---------------------------------------------------------------- import

def detect_format(filename: str, content: str) -> str:
    name = filename.lower()
    if name.endswith('.gly') or content.lstrip().startswith('++JSesh'):
        return 'gly'
    if name.endswith('.res'):
        return 'res'
    if re.search(UNI_STRING, content) and re.search('[\U00013000-\U000143FF]', content):
        return 'unicode'
    return 'mdc'


def import_document(filename: str, content: str, fmt: str | None = None) -> tuple[list[Line], list[str], str]:
    content = content.lstrip('﻿')
    fmt = fmt or detect_format(filename, content)
    match fmt:
        case 'gly' | 'mdc':
            lines, warnings = import_mdc(content)
            direction = jsesh_direction(content)
            for line in lines:
                if line.mode == 'hiero':
                    line.direction = direction
        case 'res':
            lines, warnings = import_res(content)
        case 'unicode':
            lines, warnings = import_unicode(content)
        case _:
            raise ValueError(f'Unknown format {fmt}')
    return lines, warnings, fmt


def import_mdc(content: str) -> tuple[list[Line], list[str]]:
    """Split JSesh/MdC text into editor lines.

    '!' (and '!!') end a line, as do newlines. ``+x...`` text segments become
    separate text lines; ``++...`` segments (JSesh header/comments) are skipped.
    """
    lines: list[Line] = []
    warnings: list[str] = []
    current: list[str] = []

    def flush():
        seg = ''.join(current).strip(' \t\r\n-_')
        current.clear()
        if seg:
            lines.append(Line(mode='hiero', source=seg))

    i, n = 0, len(content)
    while i < n:
        c = content[i]
        if c == '+' and i + 1 < n:
            marker = content[i + 1]
            if marker == 's':
                i += 2
                continue
            flush()
            j = i + 2
            buf = []
            while j < n and content[j] != '+':
                if content[j] == '\\' and j + 1 < n and content[j + 1] in '+\\':
                    j += 1
                buf.append(content[j])
                j += 1
            text = ''.join(buf).strip()
            if marker != '+' and text:
                lines.append(Line(mode=JSESH_TO_MODE.get(marker, 'latin'), source=text))
            i = j
            continue
        if c in '!\n':
            flush()
            i += 1
            continue
        current.append(c)
        i += 1
    flush()

    for k, line in enumerate(lines, 1):
        if line.mode == 'hiero':
            interp = hiero.interpret(line.source)
            if not interp.ok:
                warnings.append(f'Line {k}: {interp.error}')
            warnings.extend(f'Line {k}: {w}' for w in interp.warnings)
    return lines, warnings


def import_res(content: str) -> tuple[list[Line], list[str]]:
    lines: list[Line] = []
    warnings: list[str] = []
    for k, raw in enumerate(content.splitlines(), 1):
        raw = raw.strip()
        if not raw:
            continue
        with hiero.HIEROPY_LOCK:
            parser = ResParser()
            converter = ResUniConverter()
            try:
                parsed = parser.parse(raw)
                error = parser.last_error
            except Exception as exc:  # hieropy's RES parser can raise on odd arguments
                parsed, error = None, str(exc)
            if parsed is None or error:
                warnings.append(f'Line {k}: cannot parse RES ({error or "syntax error"})')
                continue
            fragment = converter.convert_fragment(parsed)
        warnings.extend(f'Line {k}: {e}' for e in converter.errors)
        lines.append(Line(mode='hiero', source=str(fragment), direction=parsed.direction or 'hlr'))
    return lines, warnings


_TRANSLIT_CHARS = re.compile('[Ꜣ-ꜥꞼꞽḤḥḪḫẖ̱ḲḳṮṯḎḏ]')


def import_unicode(content: str) -> tuple[list[Line], list[str]]:
    lines: list[Line] = []
    for raw in content.splitlines():
        pos = 0
        for m in re.finditer(UNI_STRING, raw):
            if not re.search('[\U00013000-\U000143FF]', m.group(0)):
                continue  # a lone bracket is text, not hieroglyphs
            _add_text_line(lines, raw[pos:m.start()])
            lines.append(Line(mode='hiero', source=m.group(0)))
            pos = m.end()
        _add_text_line(lines, raw[pos:])
    return lines, []


def _add_text_line(lines: list[Line], text: str):
    text = text.strip()
    if not text:
        return
    if _TRANSLIT_CHARS.search(text):
        lines.append(Line(mode='translit', source=unicode_to_ascii(text)))
    else:
        lines.append(Line(mode='latin', source=text))

"""Interpretation of hieroglyphic input and rendering through hieropy.

A hieroglyphic line typed by the user can be:

* plain Manuel de Codage (e.g. ``i-w-r:a``), converted with hieropy's MdC converter;
* Unicode hieroglyphs with Unicode control characters, parsed directly;
* a hybrid of the two: sign codes/mnemonics mixed with Unicode control characters
  (e.g. ``A1𓐰B1`` after clicking the vertical-joiner icon). Sign codes are replaced
  by their Unicode characters and a few MdC operators are mapped onto their Unicode
  counterparts before parsing.

hieropy's parsers are module-level PLY singletons and are not thread-safe, so all
use of hieropy goes through ``HIEROPY_LOCK``.
"""

import re
import threading
from dataclasses import dataclass, field

from hieropy import MdcUniConverter, Options, UniParser
from hieropy import mdcnames, uninames
from hieropy.uniconstants import (
    BEGIN_SEGMENT, END_SEGMENT, FULL_BLANK, FULL_LOST, HALF_BLANK, HALF_LOST,
    HOR, MIRROR, PLACEHOLDER, VER,
)
from hieropy.unistructure import Fragment

HIEROPY_LOCK = threading.RLock()

# Font size used for on-screen SVG; the client scales the SVG through its viewBox.
DISPLAY_FONTSIZE = 64

# Unicode hieroglyphs, Egyptian format controls, variation selectors, brackets used by hieropy.
_UNI_CHAR = re.compile('[\U00013000-\U000143FF︀-️]')

_HYBRID_OPERATORS = {
    ':': VER,
    '*': HOR,
    '(': BEGIN_SEGMENT,
    ')': END_SEGMENT,
    '\\': MIRROR,
}

_HYBRID_TOKEN = re.compile(r'\.\.|\.|//|/|[A-Za-z]+[0-9]*[A-Za-z]*|[0-9]+|.', re.S)


@dataclass
class Interpretation:
    fragment: Fragment | None
    unicode: str = ''
    source_format: str = 'empty'  # 'empty' | 'mdc' | 'unicode' | 'hybrid'
    error: str = ''
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.error


def contains_unicode_hieroglyphs(text: str) -> bool:
    return bool(_UNI_CHAR.search(text))


def sign_to_char(token: str) -> str | None:
    """Resolve a Gardiner code (A1, aa1, N35a) or mnemonic (nfr, ra) to a Unicode sign."""
    ch = uninames.name_to_char(uninames.name_to_name_insensitive(token))
    if ch:
        return ch
    for lookup in (uninames.mnemonic_to_name, mdcnames.mnemonic_to_name):
        name = lookup(token)
        if name:
            ch = uninames.name_to_char(name)
            if ch:
                return ch
    chars = mdcnames.name_to_chars(token)
    if chars and len(chars) == 1:
        return chars
    return None


def interpret(text: str) -> Interpretation:
    text = text.strip()
    if not text:
        return Interpretation(fragment=Fragment([]), source_format='empty')
    with HIEROPY_LOCK:
        if contains_unicode_hieroglyphs(text):
            return _interpret_unicode(text)
        return _interpret_mdc(text)


def _interpret_unicode(text: str) -> Interpretation:
    pieces = []
    hybrid = False
    for match in _HYBRID_TOKEN.finditer(text):
        tok = match.group(0)
        if _UNI_CHAR.match(tok) or tok in '[]{}⟨⟩⟦⟧⸢⸣':
            pieces.append(tok)
        elif tok.isspace() or tok == '-':
            hybrid = True
        elif tok in _HYBRID_OPERATORS:
            pieces.append(_HYBRID_OPERATORS[tok])
            hybrid = True
        elif tok == '..':
            pieces.append(FULL_BLANK)
            hybrid = True
        elif tok == '.':
            pieces.append(HALF_BLANK)
            hybrid = True
        elif tok == '//':
            pieces.append(FULL_LOST)
            hybrid = True
        elif tok == '/':
            pieces.append(HALF_LOST)
            hybrid = True
        elif re.fullmatch(r'[A-Za-z0-9]+', tok):
            ch = sign_to_char(tok)
            if ch is None:
                return Interpretation(None, source_format='hybrid', error=f'Unknown sign code "{tok}"')
            pieces.append(ch)
            hybrid = True
        else:
            return Interpretation(None, source_format='hybrid', error=f'Unexpected character "{tok}"')
    encoding = ''.join(pieces)
    source_format = 'hybrid' if hybrid else 'unicode'
    parser = UniParser()
    fragment = parser.parse(encoding)
    if parser.last_error or fragment is None:
        return Interpretation(None, source_format=source_format, error=parser.last_error or 'Cannot parse')
    return Interpretation(fragment, unicode=str(fragment), source_format=source_format)


def _interpret_mdc(text: str) -> Interpretation:
    converter = MdcUniConverter()
    # Line breaks inside one editor line carry no meaning; MdC line ends ('!') are dropped too.
    fragments = converter.convert(text.replace('\n', ' '))
    fatal = [e for e in converter.errors if 'Cannot parse' in e or 'Syntax error' in e
             or 'Unexpected end' in e or 'Illegal character' in e]
    if fatal:
        return Interpretation(None, source_format='mdc', error=_strip_line_prefix(fatal[0]))
    groups = [g for f in fragments for g in f.groups]
    fragment = Fragment(groups)
    encoding = str(fragment)
    if PLACEHOLDER in encoding:
        unknown = [tok for tok in re.findall(r'[A-Za-z]+[0-9]*[A-Za-z]*|[0-9]+', text)
                   if sign_to_char(tok) is None and not mdcnames.name_to_chars(tok)]
        detail = f' "{unknown[0]}"' if unknown else ''
        return Interpretation(None, source_format='mdc', error=f'Unknown sign code{detail}')
    warnings = [_strip_line_prefix(e) for e in converter.errors]
    return Interpretation(fragment, unicode=encoding, source_format='mdc', warnings=warnings)


def _strip_line_prefix(message: str) -> str:
    return re.sub(r'^\(Line \d+\): ', '', message)


def render_svg(fragment: Fragment, fontsize: int = DISPLAY_FONTSIZE, transparent: bool = True,
               direction: str = 'hlr') -> tuple[str, float, float]:
    """Render a fragment to SVG. Returns (svg, width, height) in px; the SVG gets a viewBox."""
    with HIEROPY_LOCK:
        printed = fragment.print(Options(imagetype='svg', fontsize=fontsize, transparent=transparent,
                                         direction=direction))
        svg = printed.get_svg()
    width = float(re.search(r'width="([0-9.]+)"', svg).group(1))
    height = float(re.search(r'height="([0-9.]+)"', svg).group(1))
    svg = svg.replace('<svg ', f'<svg viewBox="0 0 {width:g} {height:g}" ', 1)
    return svg, width, height

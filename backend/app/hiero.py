"""Interpretation of hieroglyphic input and rendering through hieropy.

A hieroglyphic line typed by the user can be:

* plain Manuel de Codage (e.g. ``i-w-r:a``), converted with hieropy's MdC converter;
* Unicode hieroglyphs with Unicode control characters, parsed directly;
* a hybrid of the two: sign codes/mnemonics mixed with Unicode control characters
  (e.g. ``A1𓐰B1`` after clicking the vertical-joiner icon). Sign codes are replaced
  by their Unicode characters and a few MdC operators are mapped onto their Unicode
  counterparts before parsing.

Any of these may contain JSesh line references (``|B237``): drawn by the editor as a
vertical bar with the label on top, kept in MdC/.gly export and left out of other output.

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

from .brackets import normalize_brackets

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


# A JSesh line reference: '|' and a label, which may contain spaces (|G 1, |AOS,R, 3), up
# to the next '-' or '!' (or line end, text segment, reference or Unicode hieroglyph).
_REFERENCE = re.compile('\\|([^\\-!+|\n\U00013000-\U000143FF]*)')


@dataclass
class Part:
    """Piece of a line with references: hieroglyphs (`fragment`) or a reference label (`ref`)."""
    fragment: Fragment | None = None
    ref: str | None = None


@dataclass
class Interpretation:
    fragment: Fragment | None
    unicode: str = ''
    source_format: str = 'empty'  # 'empty' | 'mdc' | 'unicode' | 'hybrid'
    error: str = ''
    warnings: list[str] = field(default_factory=list)
    # For MdC input: the MdC with 'j' read as 'i' in sign names (what .gly export writes).
    mdc: str = ''
    # For lines with references: hieroglyphs and references in order (else empty).
    # `fragment`/`unicode` above hold the hieroglyphs without the references.
    parts: list[Part] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.error

    @property
    def sign_notes(self) -> list[str]:
        """Warnings about unknown sign codes shown with stand-ins (repeated by exports)."""
        return [w for w in self.warnings if w.startswith('Unknown sign code')]


def contains_unicode_hieroglyphs(text: str) -> bool:
    return bool(_UNI_CHAR.search(text))


def sign_to_char(token: str) -> str | None:
    """Resolve a Gardiner code (A1, aa1, N35a) or mnemonic (nfr, ra) to a Unicode sign.

    'j' may be typed for 'i' in any sign name (jnj = ini, jb = ib); names as typed win.
    """
    return _sign_to_char_exact(token) or (_sign_to_char_exact(token.replace('j', 'i')) if 'j' in token else None)


def _sign_to_char_exact(token: str) -> str | None:
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


# A sign name in MdC: not preceded by a backslash (modifiers such as \R90) or another name character.
_MDC_SIGN_NAME = re.compile(r'(?<![\\A-Za-z0-9])[A-Za-z]+[0-9]*[A-Za-z]*')


def substitute_j(mdc: str) -> str:
    """Rewrites sign names in MdC that are only known with 'i' for 'j' (jnj -> ini)."""
    def replace(match: re.Match) -> str:
        name = match.group(0)
        if 'j' not in name or _sign_to_char_exact(name) or mdcnames.name_to_chars(name):
            return name
        alt = name.replace('j', 'i')
        return alt if _sign_to_char_exact(alt) or mdcnames.name_to_chars(alt) else name
    return _MDC_SIGN_NAME.sub(replace, mdc)


def interpret(text: str) -> Interpretation:
    text = text.strip()
    if '|' not in text:
        return _interpret_glyphs(text)
    pieces = _REFERENCE.split(text)
    segments = [seg.strip(' \t\r\n-_') for seg in pieces[0::2]]
    refs = [' '.join(ref.split()) for ref in pieces[1::2]]
    # Each run of hieroglyphs between references, for the display ...
    runs = [_interpret_glyphs(seg) for seg in segments]
    # ... and all of them as one line, which exports and copying use.
    # Joined as each kind of input separates groups: MdC by '-' (a space breaks e.g. '$b $r'),
    # hybrid input by a space ('-' is not a joiner there), Unicode not at all.
    formats = {r.source_format for r in runs} - {'empty'}
    joiner = '-' if formats <= {'mdc'} else '' if formats == {'unicode'} else ' '
    whole = _interpret_glyphs(joiner.join(s for s in segments if s))
    if not whole.ok:
        return whole
    if not all(r.ok for r in runs):
        whole.warnings.append('Line references not shown: a bracket or group spans one')
        return whole
    parts: list[Part] = []
    mdc: list[str] = []
    for k, run in enumerate(runs):
        if run.source_format != 'empty':
            parts.append(Part(fragment=run.fragment))
            mdc.append(run.mdc)
        if k < len(refs):
            parts.append(Part(ref=refs[k]))
            mdc.append('|' + refs[k])
    whole.parts = parts
    whole.mdc = '-'.join(mdc)
    return whole


def _interpret_glyphs(text: str) -> Interpretation:
    if not text:
        return Interpretation(fragment=Fragment([]), source_format='empty')
    with HIEROPY_LOCK:
        if contains_unicode_hieroglyphs(text):
            return _interpret_unicode(text)
        return _interpret_mdc(text)


def _interpret_unicode(text: str) -> Interpretation:
    pieces = []
    sign_warnings: list[str] = []
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
                similar = stand_in_for(tok)
                if similar:
                    ch = sign_to_char(similar)
                    sign_warnings.append(f'Unknown sign code "{tok}": shown as {similar}')
                else:
                    ch = FULL_LOST
                    sign_warnings.append(f'Unknown sign code "{tok}": shown as a lost sign')
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
    fragment, warnings = normalize_brackets(fragment)
    return Interpretation(fragment, unicode=str(fragment), source_format=source_format,
                          warnings=sign_warnings + warnings)


# JSesh's shading of a sign's quarters (A2#1234, also after '_': A2_#1234), which hieropy
# reads as A2\shading1234 (before any '_').
_SIGN_SHADING = re.compile(r'(_*)#([1-4]+)')

# MdC for a fully lost sign: what an unknown sign code is shown as.
_LOST_SIGN_MDC = '//'


def _is_known_mdc(name: str) -> bool:
    return sign_to_char(name) is not None or bool(mdcnames.name_to_chars(name))


def stand_in_for(name: str) -> str | None:
    """For an unknown sign code: the same code without a final letter (M43B -> M43), if known."""
    if len(name) > 1 and name[-1].isalpha() and name[:-1][-1:].isdigit() and _is_known_mdc(name[:-1]):
        return name[:-1]
    return None


# A sign name that may be replaced: not a modifier (\\R90), shading (#b, #e) or ink ($r, $b).
_MDC_REPLACEABLE_NAME = re.compile(r'(?<![\\#$A-Za-z0-9])[A-Za-z]+[0-9]*[A-Za-z]*')


def _replace_unknown_signs(text: str) -> tuple[str, list[str]]:
    """Replaces unknown sign codes by a similar sign (see stand_in_for), else by a lost sign."""
    warnings: list[str] = []

    def replace(match: re.Match) -> str:
        name = match.group(0)
        if _is_known_mdc(name):
            return name
        similar = stand_in_for(name)
        if similar:
            warnings.append(f'Unknown sign code "{name}": shown as {similar}')
            return similar
        warnings.append(f'Unknown sign code "{name}": shown as a lost sign')
        return _LOST_SIGN_MDC
    return _MDC_REPLACEABLE_NAME.sub(replace, text), warnings


def _interpret_mdc(text: str) -> Interpretation:
    # Line breaks inside one editor line carry no meaning; MdC line ends ('!') are dropped too.
    text = substitute_j(text)
    parse_text = _SIGN_SHADING.sub(r'\\shading\2\1', text.replace('\n', ' '))
    fragments, errors = _convert_mdc(parse_text)
    sign_warnings: list[str] = []
    if errors is None:  # unknown sign codes: try again with stand-ins
        parse_text, sign_warnings = _replace_unknown_signs(parse_text)
        fragments, errors = _convert_mdc(parse_text)
    if errors is None:
        return Interpretation(None, source_format='mdc', error='Unknown sign code')
    fatal = [e for e in errors if 'Cannot parse' in e or 'Syntax error' in e
             or 'Unexpected end' in e or 'Illegal character' in e]
    if fatal:
        return Interpretation(None, source_format='mdc', error=_strip_line_prefix(fatal[0]))
    groups = [g for f in fragments for g in f.groups]
    fragment, bracket_warnings = normalize_brackets(Fragment(groups))
    warnings = sign_warnings + [_strip_line_prefix(e) for e in errors] + bracket_warnings
    # The MdC as typed (with 'j' read as 'i') is kept for .gly export, unknown codes included.
    return Interpretation(fragment, unicode=str(fragment), source_format='mdc', warnings=warnings,
                          mdc=' '.join(text.split()))


def _convert_mdc(text: str) -> tuple[list[Fragment], list[str] | None]:
    """hieropy's MdC conversion; errors is None if the result has unknown signs (placeholders)."""
    converter = MdcUniConverter()
    fragments = converter.convert(text)
    if any(PLACEHOLDER in str(f) for f in fragments):
        return fragments, None
    return fragments, converter.errors


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

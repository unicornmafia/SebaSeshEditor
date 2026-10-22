"""The sign list for the hieroglyph picker: signs by Gardiner category, with their readings.

Names, categories, readings and descriptions come from hieropy's tables (Unicode names, which
follow Gardiner's list, extended for the newer Unicode signs). A sign's MdC code is the code
that MdC reads back as that same sign; JSesh's codes differ from the Unicode names for many
of the newer signs (JSesh's A64 is another sign than Unicode's A64), and some signs have no
MdC code at all: those are inserted as Unicode.
"""

import html
import re
from functools import lru_cache

from hieropy import uninames, uniproperties

from . import hiero


def _mdc_code(name: str, char: str) -> str | None:
    variants = [name, re.sub(r'(\d)([a-z]+)$', lambda m: m[1] + m[2].upper(), name), name.upper()]
    for code in dict.fromkeys(variants):
        interp = hiero.interpret(code)
        if interp.ok and interp.unicode == char and not interp.sign_notes:
            return code
    return None


_ALLOWED_TAG = re.compile(r'&lt;(/?)(ul|li|b|i)&gt;')


def _clean_info(info: str | None) -> str:
    """hieropy's description of a sign (a short HTML list), keeping only its list and emphasis tags."""
    if not info:
        return ''
    return _ALLOWED_TAG.sub(r'<\1\2>', html.escape(info, quote=False))


@lru_cache(maxsize=1)
def sign_list() -> list[dict]:
    readings: dict[str, list[str]] = {}
    uniproperties.cache_translit()
    for translit, chars in uniproperties._translit_to_chars.items():
        for ch in chars:
            readings.setdefault(ch, []).append(translit)
    categories = []
    for cat in uninames.UNI_CATEGORIES:
        signs = []
        for extended, chars in ((False, uninames.cat_to_chars(cat)), (True, uninames.cat_to_chars_ext(cat))):
            for ch in chars:
                name = uninames.char_to_name(ch)
                if name is None:
                    continue
                signs.append({
                    'name': name,
                    'char': ch,
                    'extended': extended,
                    'mdc': _mdc_code(name, ch),
                    'mnemonics': uninames.name_to_mnemonics(name),
                    'readings': readings.get(ch, []),
                })
        signs.sort(key=lambda s: uninames.name_to_tuple(s['name']))
        categories.append({'id': cat, 'description': uninames.cat_to_description(cat), 'signs': signs})
    return categories


def sign_info(char: str) -> str:
    return _clean_info(uniproperties.char_to_info(char))

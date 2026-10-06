"""ASCII (Manuel de Codage style) transliteration to Unicode Egyptological transliteration.

Follows hieropy.translit; a '^' before a letter capitalises it (e.g. ``^imn`` -> ``Ꞽmn``).
Must stay in sync with frontend/src/translit.ts.
"""

_LOWER = {
    'A': 'ꜣ', 'i': 'ꞽ', 'a': 'ꜥ', 'H': 'ḥ', 'x': 'ḫ',
    'X': 'ẖ', 'S': 'š', 'K': 'ḳ', 'T': 'ṯ', 'D': 'ḏ',
}
_UPPER = {
    'A': 'Ꜣ', 'i': 'Ꞽ', 'a': 'Ꜥ', 'H': 'Ḥ', 'x': 'Ḫ',
    'X': 'H̱', 'S': 'Š', 'K': 'Ḳ', 'T': 'Ṯ', 'D': 'Ḏ',
}


def ascii_to_unicode(s: str) -> str:
    out = []
    upper = False
    for ch in s:
        if ch == '^' and not upper:
            upper = True
            continue
        if upper:
            out.append(_UPPER.get(ch, ch.upper()))
            upper = False
        else:
            out.append(_LOWER.get(ch, ch))
    if upper:
        out.append('^')
    return ''.join(out)


_REVERSE = {v: k for k, v in _LOWER.items()} | {v: '^' + k for k, v in _UPPER.items()}


def unicode_to_ascii(s: str) -> str:
    """Inverse of ascii_to_unicode, used when importing Unicode transliteration."""
    out = []
    i = 0
    while i < len(s):
        pair = s[i:i + 2]
        if pair in _REVERSE:
            out.append(_REVERSE[pair])
            i += 2
            continue
        ch = s[i]
        if ch in _REVERSE:
            out.append(_REVERSE[ch])
        elif ch.isascii() and ch.isupper():
            out.append('^' + ch.lower())
        else:
            out.append(ch)
        i += 1
    return ''.join(out)

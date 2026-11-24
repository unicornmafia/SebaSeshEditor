"""Client for SebaShem, the machine transliteration and translation service.

SebaShem turns MdC into a transliteration (/v1/transliterate) and a transliteration into
English (/v1/translate). The editor asks for one line at a time; SebaShem may divide a line
into several segments (at '!'), whose results are joined again. Line references (|B276) are
passed along: SebaShem echoes them in place in its output.

The service's address is SEBASHEM_URL (default http://localhost:8000).
"""

import json
import os
import urllib.error
import urllib.request

from .documents import join_suffixes

TIMEOUT = 120


class SebaShemError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def base_url() -> str:
    return os.environ.get('SEBASHEM_URL', 'http://localhost:8000').rstrip('/')


def _post(path: str, text: str) -> dict:
    req = urllib.request.Request(base_url() + path, data=json.dumps({'text': text}).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as err:
        try:
            detail = json.load(err).get('detail')
        except Exception:
            detail = None
        if not isinstance(detail, str):
            detail = f'error {err.code}'
        # Its 422 (nothing to translate) is the caller's problem, anything else is the service's.
        raise SebaShemError(f'SebaShem: {detail}', 422 if err.code == 422 else 502) from None
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        reason = getattr(err, 'reason', err)
        raise SebaShemError(f'SebaShem is not reachable at {base_url()} ({reason})', 503) from None


def _joined(segments: list[dict], field: str) -> str:
    """The segments' results, each with its line references in place when it has any."""
    return ' '.join((seg.get('marked') or {}).get(field) or seg[field] for seg in segments).strip()


def transliterate(mdc: str) -> str:
    data = _post('/v1/transliterate', mdc)
    return join_suffixes(_joined(data['segments'], 'transliteration'))


def translate(translit: str) -> str:
    data = _post('/v1/translate', translit)
    text = _joined(data['segments'], 'translation')
    # The model writes lower case; start the sentence with a capital (after any reference).
    words = text.split(' ')
    for i, word in enumerate(words):
        if word and not word.startswith('|'):
            words[i] = word[0].upper() + word[1:]
            break
    return ' '.join(words)

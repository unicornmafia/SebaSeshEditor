"""Cutting, copying and pasting groups of signs within and between hieroglyphic lines.

A line is seen as a list of items: its top-level groups (as drawn: a quadrat, a cartouche, a
single sign) and its line references (|B237). Positions are indexes into that list.

Edits keep the user's own text where they can: the source is split into its top-level pieces
(between '-' or spaces), and if each piece accounts for whole items, pieces are cut and pasted
as typed. Otherwise the line is written anew: MdC lines by the MdC writer (Gardiner codes),
others as Unicode.
"""

from dataclasses import dataclass, field

from hieropy.unistructure import Fragment

from . import hiero
from .convert import fragment_to_mdc


@dataclass
class Item:
    group: object | None = None  # a hieropy top-level group, or
    ref: str | None = None       # a line reference label


def items_of(interp: hiero.Interpretation) -> list[Item]:
    if not interp.parts:
        return [Item(group=g) for g in interp.fragment.groups]
    items: list[Item] = []
    for part in interp.parts:
        if part.ref is not None:
            items.append(Item(ref=part.ref))
        else:
            items.extend(Item(group=g) for g in part.fragment.groups)
    return items


def item_unicode(item: Item) -> str:
    return str(Fragment([item.group])) if item.ref is None else ''


def _runs(items: list[Item]):
    """Consecutive groups as fragments, and references, in order."""
    run: list = []
    for item in items:
        if item.ref is None:
            run.append(item.group)
            continue
        if run:
            yield Fragment(run)
            run = []
        yield item.ref
    if run:
        yield Fragment(run)


def to_mdc(items: list[Item], warnings: list[str]) -> str:
    out = []
    with hiero.HIEROPY_LOCK:
        for run in _runs(items):
            if isinstance(run, str):
                out.append('|' + run)
            else:
                mdc, conv_warnings = fragment_to_mdc(run)
                warnings.extend(conv_warnings)
                out.append(mdc)
    return '-'.join(out)


def to_unicode(items: list[Item]) -> str:
    """Unicode, with references as |label (a label ends at the next hieroglyph)."""
    return ''.join(f'|{run}-' if isinstance(run, str) else str(run) for run in _runs(items)).rstrip('-')


def _segments(source: str) -> list[str]:
    """The source's top-level pieces: split at '-' and spaces outside (), <> and references."""
    pieces: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    while i < len(source):
        c = source[i]
        if c == '|' and depth == 0:  # a reference, up to the next '-' or '!' (it may contain spaces)
            if buf:
                pieces.append(''.join(buf))
                buf = []
            j = i + 1
            while j < len(source) and source[j] not in '-!|':
                j += 1
            pieces.append(source[i:j].strip())
            i = j
            continue
        if c in '(<':
            depth += 1
        elif c in ')>' and depth:
            depth -= 1
        if depth == 0 and (c == '-' or c.isspace()):
            if buf:
                pieces.append(''.join(buf))
                buf = []
        else:
            buf.append(c)
        i += 1
    if buf:
        pieces.append(''.join(buf))
    return pieces


def _piece_counts(pieces: list[str], total: int) -> list[int] | None:
    """Items each piece accounts for (0 for e.g. '$r' or '[['), or None if they do not add up."""
    counts = []
    for piece in pieces:
        if piece.startswith('|'):
            counts.append(1)
            continue
        interp = hiero.interpret(piece)
        counts.append(len(items_of(interp)) if interp.ok else 0)
    return counts if sum(counts) == total else None


def _piece_range(counts: list[int], start: int, end: int) -> tuple[int, int] | None:
    """Pieces [first, last) holding exactly items [start, end), or None if a piece is split."""
    pos = 0
    first = last = None
    for k, n in enumerate(counts):
        if n and pos == start and first is None:
            first = k
        pos += n
        if n and pos == end and first is not None:
            last = k + 1
            break
        if first is None and pos > start or pos > end:
            return None
    return (first, last) if first is not None and last is not None else None


def _insert_index(counts: list[int], at: int) -> int | None:
    """The piece to insert before so the new items come at item `at`, or None if inside a piece."""
    pos = 0
    for k, n in enumerate(counts):
        if pos == at and n:
            return k
        pos += n
        if pos > at:
            return None
    return len(counts) if pos == at else None


@dataclass
class EditResult:
    ok: bool
    error: str = ''
    source: str = ''
    # For copy and cut: what was taken, as MdC (for the clipboard).
    mdc: str = ''
    # For paste: how many items were inserted.
    count: int = 0
    warnings: list[str] = field(default_factory=list)


def edit(source: str, op: str, start: int = 0, end: int = 0, text: str = '') -> EditResult:
    """copy/cut items [start, end) of the line, or paste `text` (MdC or Unicode) before item `start`."""
    interp = hiero.interpret(source)
    if not interp.ok:
        return EditResult(False, error=f'The line cannot be rendered ({interp.error})')
    items = items_of(interp)
    warnings: list[str] = []
    as_mdc = interp.source_format in ('mdc', 'empty')
    pieces = _segments(source.strip()) if as_mdc else []
    counts = _piece_counts(pieces, len(items)) if as_mdc else None

    if op in ('copy', 'cut'):
        if not 0 <= start < end <= len(items):
            return EditResult(False, error='Nothing selected')
        span = _piece_range(counts, start, end) if counts else None
        if span:  # the user's own text
            first, last = span
            taken = '-'.join(pieces[first:last])
            rest = '-'.join(pieces[:first] + pieces[last:])
        else:
            taken = to_mdc(items[start:end], warnings)
            rest_items = items[:start] + items[end:]
            rest = to_mdc(rest_items, warnings) if as_mdc else to_unicode(rest_items)
        return EditResult(True, source=rest if op == 'cut' else source, mdc=taken, warnings=warnings)

    if op == 'paste':
        pasted = hiero.interpret(text)
        new_items = items_of(pasted) if pasted.ok else []
        if not new_items:
            return EditResult(False, error=f'Cannot paste: not hieroglyphs ({pasted.error or "empty"})')
        if not 0 <= start <= len(items):
            return EditResult(False, error='Invalid position')
        warnings.extend(pasted.sign_notes)
        if interp.source_format == 'empty':  # an empty line takes the kind of what is pasted
            as_mdc = pasted.source_format == 'mdc'
            counts, pieces = [], []
        at = _insert_index(counts, start) if counts is not None and as_mdc else None
        if at is not None:
            insert = text.strip() if pasted.source_format == 'mdc' else to_mdc(new_items, warnings)
            return EditResult(True, source='-'.join(pieces[:at] + [insert] + pieces[at:]),
                              count=len(new_items), warnings=warnings)
        combined = items[:start] + new_items + items[start:]
        return EditResult(True, source=to_mdc(combined, warnings) if as_mdc else to_unicode(combined),
                          count=len(new_items), warnings=warnings)
    return EditResult(False, error=f'Unknown operation {op}')

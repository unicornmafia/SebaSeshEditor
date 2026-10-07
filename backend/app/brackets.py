"""Move philological brackets to positions hieropy can render.

hieropy's printer only formats an opening bracket that starts a top-level group and a closing
bracket that ends one. Its MdC converter, however, can attach a bracket elsewhere: JSesh's
``D21_:X1_*[[-X1`` ("a bracket opens before the next group") becomes ``D21:(X1*[)-X1``, and
``A1*[[-B1`` becomes ``(A1*[)-B1``. Printing such a fragment crashes (the bracket was never
positioned). This module moves misplaced brackets to the nearest top-level group boundary,
following the MdC reading: an opening bracket that ends a group opens the next group, a closing
bracket that starts a group closes the previous one, and any other misplaced bracket moves to
the start/end of its own top-level group.
"""

from hieropy.mdcconversion import (
    add_close_bracket, add_open_bracket, can_add_close_bracket, can_add_open_bracket,
)
from hieropy.unistructure import (
    Basic, BracketClose, BracketOpen, Enclosure, Fragment, Horizontal, Vertical,
)

BRACKETS = (BracketOpen, BracketClose)


def normalize_brackets(fragment: Fragment) -> tuple[Fragment, list[str]]:
    """Returns a fragment whose brackets hieropy can print, and notes on any it had to drop."""
    if not _has_misplaced(fragment):
        return fragment, []
    warnings: list[str] = []
    groups = []
    carried_open: list[BracketOpen] = []  # opening brackets that belong to the next group
    for group in fragment.groups:
        moved: list[tuple[str, BracketOpen | BracketClose]] = []
        group = _strip(group, moved, top=True)
        for bracket in carried_open + [b for where, b in moved if where == 'start']:
            group = _add_open(group, bracket, warnings)
        carried_open = [b for where, b in moved if where == 'next']
        for where, bracket in moved:
            if where == 'previous' and groups:
                groups[-1] = _add_close(groups[-1], bracket, warnings)
            elif where in ('previous', 'end'):
                group = _add_close(group, bracket, warnings)
        groups.append(group)
    for bracket in carried_open:
        warnings.append(f'Opening bracket {bracket.ch} at the end of the line was dropped')
    return Fragment(groups, color=fragment.color), warnings


def _has_misplaced(fragment: Fragment) -> bool:
    def misplaced(group, top: bool) -> bool:
        match group:
            case Horizontal():
                last = len(group.groups) - 1
                for i, g in enumerate(group.groups):
                    if isinstance(g, BracketOpen) and not (top and i == 0):
                        return True
                    if isinstance(g, BracketClose) and not (top and i == last):
                        return True
                    if not isinstance(g, BRACKETS) and misplaced(g, False):
                        return True
                return False
            case Vertical():
                return any(misplaced(g, False) for g in group.groups)
            case Enclosure():
                return any(misplaced(g, False) for g in group.groups)
            case Basic():
                return any(misplaced(g, False) for g in group.insertions.values())
            case BracketOpen() | BracketClose():
                return not top
        return False
    return any(misplaced(g, True) for g in fragment.groups)


def _strip(group, moved: list, top: bool):
    """Removes misplaced brackets from `group`, recording where each should go."""
    match group:
        case Horizontal():
            items = []
            last = len(group.groups) - 1
            for i, g in enumerate(group.groups):
                if isinstance(g, BracketOpen):
                    if top and i == 0:
                        items.append(g)
                    else:
                        moved.append(('next' if i == last else 'start', g))
                elif isinstance(g, BracketClose):
                    if top and i == last:
                        items.append(g)
                    else:
                        moved.append(('previous' if i == 0 else 'end', g))
                else:
                    items.append(_strip(g, moved, top=False))
            return items[0] if len(items) == 1 else Horizontal(items)
        case Vertical():
            return Vertical([_strip(g, moved, top=False) for g in group.groups])
        case Enclosure():
            return Enclosure(group.typ, [_strip(g, moved, top=False) for g in group.groups],
                             group.delim_open, group.damage_open, group.delim_close, group.damage_close)
        case Basic():
            return Basic(group.core, {p: _strip(g, moved, top=False) for p, g in group.insertions.items()})
    return group


def _add_open(group, bracket: BracketOpen, warnings: list[str]):
    if can_add_open_bracket(group):
        return add_open_bracket(bracket, group)
    warnings.append(f'Opening bracket {bracket.ch} could not be placed and was dropped')
    return group


def _add_close(group, bracket: BracketClose, warnings: list[str]):
    if can_add_close_bracket(group):
        return add_close_bracket(group, bracket)
    warnings.append(f'Closing bracket {bracket.ch} could not be placed and was dropped')
    return group

"""Conversion of hieropy Unicode structures to Manuel de Codage (JSesh dialect) and RES.

hieropy converts MdC and RES *to* Unicode; these classes go the other way, mirroring
hieropy.mdcconversion and hieropy.resconversion so that round trips are faithful
wherever the target encoding can express the construct. Anything that cannot be
expressed is approximated and reported in ``warnings``.
"""

from hieropy.uniconstants import num_to_corners, num_to_rotate
from hieropy.uninames import char_to_name, char_to_name_cap
from hieropy.unistructure import (
    Basic, Blank, BracketClose, BracketOpen, Enclosure, Fragment, Horizontal,
    Literal, Lost, Overlay, Singleton, Vertical,
)

_OPEN_BOX = '\U00013379'
_CLOSE_BOX = '\U0001337A'


def _is_composite(group) -> bool:
    return isinstance(group, (Vertical, Horizontal, Basic, Enclosure))


class UniMdcConverter:
    MDC_OPEN_BRACKETS = {'[': '[[', '{': '[{', '⟨': '[&', '⟦': '["', '⸢': '[?'}
    MDC_CLOSE_BRACKETS = {']': ']]', '}': '}]', '⟩': '&]', '⟧': '"]', '⸣': '?]'}
    # Enclosure delimiters -> begin/end codes of JSesh's <..-...-..> notation.
    PLAIN_OPEN = {None: '0', '\U00013379': '1', '\U0001342F': '2',
                  '\U00013258': 'h1', '\U00013259': 'h2', '\U0001325A': 'h3'}
    PLAIN_CLOSE = {None: '0', '\U0001337B': '1', '\U0001337A': '2', '\U0001325D': 'h1',
                   '\U0001325C': 'h2', '\U0001325B': 'h3', '\U00013282': 's2'}
    WALLED_OPEN = {None: 'f0', '\U00013288': 'f1', '\U00013286': 'f1'}
    WALLED_CLOSE = {None: 'f0', '\U00013289': 'f1', '\U00013287': 'f1'}

    def __init__(self):
        self.warnings: list[str] = []

    def warn(self, message: str):
        if message not in self.warnings:
            self.warnings.append(message)

    def convert(self, fragment: Fragment) -> str:
        return self.top_groups(fragment.groups)

    def top_groups(self, groups) -> str:
        return '-'.join(s for s in (self.group(g, 'top') for g in groups) if s)

    def group(self, g, ctx: str) -> str:
        match g:
            case Vertical():
                s = ':'.join(self.group(x, 'ver') for x in g.groups)
                return f'({s})' if ctx in ('hor', 'ins') else s
            case Horizontal():
                return self.horizontal(g, ctx)
            case Enclosure():
                return self.enclosure(g)
            case Basic():
                return self.basic(g, ctx)
            case Overlay():
                return self.overlay(g)
            case Literal():
                return self.literal(g)
            case Singleton():
                self.warn('Standalone enclosure delimiters have no MdC code; dropped')
                return ''
            case Blank():
                return '..' if g.dim == 1 else '.'
            case Lost():
                if g.width == 1 and g.height == 1:
                    return '//'
                if g.width == 0.5 and g.height == 1:
                    return 'v/'
                if g.width == 1 and g.height == 0.5:
                    return 'h/'
                return '/'
            case BracketOpen():
                return self.MDC_OPEN_BRACKETS.get(g.ch, '[[')
            case BracketClose():
                return self.MDC_CLOSE_BRACKETS.get(g.ch, ']]')
        self.warn(f'Cannot convert {type(g).__name__}')
        return ''

    def horizontal(self, g: Horizontal, ctx: str) -> str:
        segments: list[str] = []
        run: list[str] = []
        for x in g.groups:
            if isinstance(x, (BracketOpen, BracketClose)):
                if ctx == 'top':
                    if run:
                        segments.append('*'.join(run))
                        run = []
                    segments.append(self.group(x, 'top'))
                else:
                    self.warn('Brackets inside nested groups are not supported in MdC')
            else:
                run.append(self.group(x, 'hor'))
        if run:
            segments.append('*'.join(run))
        if ctx == 'top':
            return '-'.join(segments)
        s = '*'.join(segments)
        return f'({s})' if ctx in ('hor', 'ins') else s

    def enclosure(self, g: Enclosure) -> str:
        if g.damage_open or g.damage_close:
            self.warn('Damage to enclosure delimiters is not converted to MdC')
        inner = self.top_groups(g.groups)
        o, c = g.delim_open, g.delim_close
        if g.typ == 'walled':
            if o in ('\U00013288', '\U00013286') and c in ('\U00013289', '\U00013287'):
                begin, end = 'F', ''
            else:
                begin, end = self.WALLED_OPEN.get(o, 'f1'), self.WALLED_CLOSE.get(c, 'f1')
        elif (o, c) == (_OPEN_BOX, _CLOSE_BOX):
            begin, end = '', ''
        elif (o, c) == ('\U00013258', '\U00013282'):
            begin, end = 'S', ''
        elif (o, c) == ('\U00013258', '\U0001325C'):
            begin, end = 'H', ''
        else:
            begin, end = self.PLAIN_OPEN.get(o, '1'), self.PLAIN_CLOSE.get(c, '2')
        return f'<{begin}-{inner}-{end}>' if inner else f'<{begin}--{end}>'

    def basic(self, g: Basic, ctx: str) -> str:
        core = self.group(g.core, 'core')
        start = [p for p in ('ts', 'bs') if p in g.insertions]
        end = [p for p in ('te', 'be') if p in g.insertions]
        other = [p for p in ('m', 't', 'b') if p in g.insertions]
        if other:
            self.warn('MdC has no middle/top/bottom insertion; approximated by corner insertion')
            for p in other:
                (start if not start else end).append(p)
        if len(start) > 1 or len(end) > 1:
            self.warn('MdC allows at most one insertion per side; extra insertions dropped')
        s = core
        if start:
            s = self.group(g.insertions[start[0]], 'ins') + '^^^' + s
        if end:
            s = s + '&&&' + self.group(g.insertions[end[0]], 'ins')
        return f'({s})' if ctx == 'ins' else s

    def overlay(self, g: Overlay) -> str:
        if len(g.lits1) > 1 or len(g.lits2) > 1:
            self.warn('MdC overlays combine two signs only; extra signs dropped')
        return self.literal(g.lits1[0]) + '##' + self.literal(g.lits2[0])

    def literal(self, lit: Literal) -> str:
        s = self.sign_name(char_to_name(lit.ch), lit.ch)
        rot = num_to_rotate(lit.vs)
        if rot:
            s += f'\\R{rot}'
        if lit.mirror:
            s += '\\'
        return s + self.damage(lit.damage)

    def sign_name(self, name: str, ch: str) -> str:
        if name:
            return name
        self.warn(f'No MdC code for U+{ord(ch):04X}')
        return f'"{ch}"'

    @staticmethod
    def damage(num: int) -> str:
        if not num:
            return ''
        corners = num_to_corners(num)
        digits = ''.join(d for d, c in (('1', 'ts'), ('2', 'te'), ('3', 'bs'), ('4', 'be')) if corners[c])
        return '#' + digits


class UniResConverter:
    RES_OPEN_BRACKETS = {'[': '"["', '{': '"{"', '⟨': '"<"'}
    RES_CLOSE_BRACKETS = {']': '"]"', '}': '"}"', '⟩': '">"'}
    # (typ, open, close) -> (RES box name, mirrored)
    BOXES = {
        ('plain', '\U00013379', '\U0001337A'): ('cartouche', False),
        ('plain', '\U0001342F', '\U0001337B'): ('cartouche', True),
        ('plain', '\U00013379', '\U0001337B'): ('oval', False),
        ('plain', '\U00013258', '\U00013282'): ('serekh', False),
        ('walled', '\U00013288', '\U00013289'): ('inb', False),
        ('plain', '\U00013258', '\U0001325D'): ('rectangle', False),
        ('plain', '\U0001325A', '\U0001325D'): ('Hwtopenover', False),
        ('plain', '\U00013258', '\U0001325B'): ('Hwtcloseover', False),
        ('plain', '\U00013259', '\U0001325D'): ('Hwtopenunder', False),
        ('plain', '\U00013258', '\U0001325C'): ('Hwtcloseunder', False),
    }

    def __init__(self):
        self.warnings: list[str] = []

    def warn(self, message: str):
        if message not in self.warnings:
            self.warnings.append(message)

    def convert(self, fragment: Fragment) -> str:
        return '-'.join(s for s in (self.group(g, 'top') for g in fragment.groups) if s)

    def group(self, g, ctx: str) -> str:
        match g:
            case Vertical():
                s = ':'.join(self.group(x, 'ver') for x in g.groups)
                return f'({s})' if ctx == 'hor' else s
            case Horizontal():
                s = '*'.join(self.group(x, 'hor') for x in g.groups)
                return f'({s})' if ctx == 'hor' else s
            case Enclosure():
                return self.enclosure(g)
            case Basic():
                return self.basic(g)
            case Overlay():
                s1 = '*'.join(self.literal(x) for x in g.lits1)
                s2 = ':'.join(self.literal(x) for x in g.lits2)
                return f'stack({s1},{s2})'
            case Literal():
                return self.literal(g)
            case Singleton():
                return self.named(char_to_name_cap(g.ch) or 'V11a', self.shading(g.damage))
            case Blank():
                return 'empty' if g.dim == 1 else 'empty[width=0.5,height=0.5]'
            case Lost():
                args = ['shade']
                if g.width != 1 or g.height != 1:
                    args += [f'width={g.width:g}', f'height={g.height:g}']
                return 'empty[' + ','.join(args) + ']'
            case BracketOpen():
                if g.ch not in self.RES_OPEN_BRACKETS:
                    self.warn(f'Bracket {g.ch} approximated by [ in RES')
                return self.RES_OPEN_BRACKETS.get(g.ch, '"["')
            case BracketClose():
                if g.ch not in self.RES_CLOSE_BRACKETS:
                    self.warn(f'Bracket {g.ch} approximated by ] in RES')
                return self.RES_CLOSE_BRACKETS.get(g.ch, '"]"')
        self.warn(f'Cannot convert {type(g).__name__}')
        return ''

    def enclosure(self, g: Enclosure) -> str:
        key = (g.typ, g.delim_open, g.delim_close)
        if key in self.BOXES:
            name, mirrored = self.BOXES[key]
        else:
            self.warn('Enclosure shape approximated in RES')
            name, mirrored = ('inb', False) if g.typ == 'walled' else ('cartouche', False)
        args = ['mirror'] if mirrored else []
        if g.damage_open or g.damage_close:
            args.append('shade')
            self.warn('Partial damage to enclosure approximated as full shading in RES')
        inner = '-'.join(s for s in (self.group(x, 'top') for x in g.groups) if s)
        return name + (f'[{",".join(args)}]' if args else '') + f'({inner})'

    def basic(self, g: Basic) -> str:
        s = self.group(g.core, 'core')
        for place in ('ts', 'bs', 'te', 'be', 'm', 't', 'b'):
            if place in g.insertions:
                head = 'insert' if place == 'm' else f'insert[{place}]'
                s = f'{head}({s},{self.group(g.insertions[place], "ins")})'
        return s

    def literal(self, lit: Literal) -> str:
        args = []
        if lit.mirror:
            args.append('mirror')
        rot = num_to_rotate(lit.vs)
        if lit.mirror and rot:
            rot = (360 - rot) % 360
        if rot:
            args.append(f'rotate={rot}')
        args += self.shading(lit.damage)
        name = char_to_name(lit.ch)
        if not name:
            self.warn(f'No RES name for U+{ord(lit.ch):04X}')
            name = '"?"'
        return self.named(name, args)

    @staticmethod
    def named(name: str, args: list[str]) -> str:
        return name + (f'[{",".join(args)}]' if args else '')

    @staticmethod
    def shading(num: int) -> list[str]:
        if not num:
            return []
        if num == 15:
            return ['shade']
        corners = num_to_corners(num)
        return [c for c in ('ts', 'bs', 'te', 'be') if corners[c]]


def fragment_to_mdc(fragment: Fragment) -> tuple[str, list[str]]:
    converter = UniMdcConverter()
    return converter.convert(fragment), converter.warnings


def fragment_to_res(fragment: Fragment) -> tuple[str, list[str]]:
    converter = UniResConverter()
    return converter.convert(fragment), converter.warnings

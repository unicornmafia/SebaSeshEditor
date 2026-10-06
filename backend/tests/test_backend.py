import json

import pytest
from fastapi.testclient import TestClient
from hieropy import MdcUniConverter, ResParser, ResUniConverter, UniParser

from hieropy.uninames import name_to_char

from app import hiero
from app.convert import fragment_to_mdc, fragment_to_res
from app.documents import Document, Line, export_mdc, import_document
from app.main import app
from app.translit import ascii_to_unicode, unicode_to_ascii

client = TestClient(app)

A1, B1, C1 = (name_to_char(n) for n in ('A1', 'B1', 'C1'))
VER, HOR = '\U00013430', '\U00013431'

# Unicode encodings covering the constructs the converters must handle.
UNICODE_SAMPLES = [
    A1 + HOR + B1,
    '\U000133CF' + VER + '\U000133CF',
    A1 + VER + B1 + HOR + C1,
    '\U00013379\U0001343C\U000131F3\U00013430\U000133E0\U0001343D\U0001337A',  # cartouche
    '\U00013258\U0001343C\U000131F3\U0001343D\U00013282',  # serekh
    A1 + '\U00013440',  # mirrored
    A1 + '\U0001344B',  # damaged (ts? whichever)
    A1 + '\U00013455',  # fully damaged
    '\U00013441\U00013442\U00013443\uFE00',  # blanks & (expanding) lost: MdC/RES lost is expanding
    '[' + A1 + ']',
    '\U000131CB\U00013436\U000133CF',  # overlay
    '\U00013171\U00013433\U000133CF',  # insertion at bottom-start (w + t)
    '\U00013171\U00013433\U000133CF' + HOR + A1,
]


def parse_uni(s):
    return UniParser().parse(s)


# ---------------------------------------------------------------- interpretation

@pytest.mark.parametrize('text,fmt', [
    ('i-w-r:a', 'mdc'),
    ('<-ra:mn-xpr->', 'mdc'),
    (A1 + HOR + B1, 'unicode'),
    ('A1' + HOR + 'B1', 'hybrid'),
    ('nfr' + VER + 'f', 'hybrid'),
    ('A1:B1*C1', 'mdc'),
])
def test_interpret_ok(text, fmt):
    interp = hiero.interpret(text)
    assert interp.ok, interp.error
    assert interp.source_format == fmt
    assert interp.unicode


def test_hybrid_matches_mdc_precedence():
    hybrid = hiero.interpret('A1' + VER + 'B1' + HOR + 'C1')
    mdc = hiero.interpret('A1:B1*C1')
    assert hybrid.unicode == mdc.unicode == A1 + VER + B1 + HOR + C1


@pytest.mark.parametrize('text', ['i-w-r:', 'nf', 'A1' + VER, 'A1-B1-zzzq', 'A1' + HOR])
def test_interpret_incomplete_is_error(text):
    interp = hiero.interpret(text)
    assert not interp.ok
    assert interp.error


def test_empty_is_ok():
    interp = hiero.interpret('   ')
    assert interp.ok and interp.fragment.groups == []


def test_render_svg_has_viewbox():
    svg, w, h = hiero.render_svg(hiero.interpret('A1-B1').fragment)
    assert svg.startswith('<svg viewBox="0 0 ')
    assert w > h > 0
    assert 'NewGardiner' in svg


# ---------------------------------------------------------------- converters

@pytest.mark.parametrize('encoding', [s for s in UNICODE_SAMPLES if parse_uni(s) is not None])
def test_unicode_to_mdc_round_trip(encoding):
    fragment = parse_uni(encoding)
    mdc, _ = fragment_to_mdc(fragment)
    converter = MdcUniConverter()
    back = ''.join(str(f) for f in converter.convert(mdc))
    assert back == str(fragment), (mdc, converter.errors)


@pytest.mark.parametrize('encoding', [s for s in UNICODE_SAMPLES if parse_uni(s) is not None])
def test_unicode_to_res_round_trip(encoding):
    fragment = parse_uni(encoding)
    res, _ = fragment_to_res(fragment)
    parser = ResParser()
    parsed = parser.parse(res)
    assert not parser.last_error, (res, parser.last_error)
    back = str(ResUniConverter().convert_fragment(parsed))
    assert back == str(fragment), res


def test_singleton_res_round_trip_and_mdc_warning():
    fragment = parse_uni('\U0001337A')
    res, _ = fragment_to_res(fragment)
    assert str(ResUniConverter().convert_fragment(ResParser().parse(res))) == '\U0001337A'
    mdc, warnings = fragment_to_mdc(fragment)
    assert mdc == '' and warnings


def test_mdc_rotation_and_damage():
    fragment = parse_uni(A1 + '︀')  # rotated 90
    mdc, _ = fragment_to_mdc(fragment)
    assert mdc == 'A1\\R90'
    fragment = parse_uni(A1 + '\U00013455')
    assert fragment_to_mdc(fragment)[0] == 'A1#1234'


# ---------------------------------------------------------------- transliteration

def test_translit():
    assert ascii_to_unicode('nfr') == 'nfr'
    assert ascii_to_unicode('Axt') == 'ꜣḫt'
    assert ascii_to_unicode('^imn') == 'Ꞽmn'
    assert unicode_to_ascii(ascii_to_unicode('^imn-Htp sA=f Dd')) == '^imn-Htp sA=f Dd'


# ---------------------------------------------------------------- documents

GLY = (
    '++JSesh_Info 1.0 +s\n'
    '++JSesh_page_orientation HORIZONTAL +s\n'
    'i-w-r:a-!\n'
    '+tiw ra+s-!\n'
    '+lHello world+s-!\n'
    '+bBold+s-<-ra:mn->-!\n'
)


def test_import_gly():
    lines, warnings, fmt = import_document('x.gly', GLY)
    assert fmt == 'gly'
    assert [(l.mode, l.source) for l in lines] == [
        ('hiero', 'i-w-r:a'),
        ('translit', 'iw ra'),
        ('latin', 'Hello world'),
        ('bold', 'Bold'),
        ('hiero', '<-ra:mn->'),
    ]
    assert warnings == []


def test_gly_round_trip():
    doc = Document(lines=[
        Line(mode='hiero', source='i-w-r:a'),
        Line(mode='hiero', source=A1 + HOR + B1),
        Line(mode='translit', source='sA=f'),
        Line(mode='italic', source='a + b'),
    ])
    text, warnings = export_mdc(doc, jsesh_header=True)
    assert text.startswith('++JSesh_Info')
    lines, _, _ = import_document('x.gly', text)
    assert [l.mode for l in lines] == ['hiero', 'hiero', 'translit', 'italic']
    assert lines[1].source == 'A1*B1'
    assert lines[3].source == 'a + b'


def test_import_res():
    lines, warnings, fmt = import_document('x.res', 'A1-B1:C1\ncartouche(ra-mn)\n')
    assert fmt == 'res'
    assert len(lines) == 2
    assert lines[0].source == A1 + B1 + VER + C1


def test_import_unicode_splits_text():
    lines, _, fmt = import_document('x.txt', A1 + HOR + B1 + ' the man\nꜣḫt\n')
    assert fmt == 'unicode'
    assert [(l.mode, l.source) for l in lines] == [
        ('hiero', A1 + HOR + B1), ('latin', 'the man'), ('translit', 'Axt')]


# ---------------------------------------------------------------- API

def test_api_render():
    r = client.post('/api/render', json={'text': 'i-w-r:a'}).json()
    assert r['ok'] and r['unicode'] and r['sourceFormat'] == 'mdc'
    r = client.post('/api/render', json={'text': 'i-w-r:'}).json()
    assert not r['ok'] and r['error']


@pytest.mark.parametrize('fmt', ['gly', 'mdc', 'res', 'unicode', 'pdf', 'svg'])
def test_api_export(fmt):
    doc = {'fontsize': 40, 'lines': [
        {'mode': 'hiero', 'source': '<-ra:mn-xpr->-i-w-r:a'},
        {'mode': 'translit', 'source': '^imn-Htp'},
        {'mode': 'latin', 'source': 'Amenhotep'},
        {'mode': 'bold', 'source': 'Bold'},
        {'mode': 'hiero', 'source': 'zzzq'},
    ]}
    r = client.post('/api/export', json={'format': fmt, 'document': doc})
    assert r.status_code == 200
    warnings = json.loads(r.headers['X-Export-Warnings'])
    assert any('Line 5' in w for w in warnings)
    if fmt == 'pdf':
        assert r.content.startswith(b'%PDF')
    elif fmt == 'svg':
        assert '@font-face' in r.text and 'Ꞽ' in r.text
    elif fmt == 'unicode':
        assert 'Ꞽmn-ḥtp' in r.text


def test_api_import():
    r = client.post('/api/import', files={'file': ('a.gly', GLY.encode())}).json()
    assert r['format'] == 'gly' and len(r['lines']) == 5


def test_fonts_served():
    assert client.get('/fonts/NewGardiner.ttf').status_code == 200
    assert client.get('/fonts/NewAthenaUnicode-Italic.ttf').status_code == 200
    assert client.get('/fonts/../app/main.py').status_code == 404


def test_per_line_fontsize_in_exports():
    from app.render import export_svg
    import re as _re
    small = Document(fontsize=40, lines=[Line(mode='hiero', source='A1'), Line(mode='latin', source='x')])
    big = Document(fontsize=40, lines=[Line(mode='hiero', source='A1', fontsize=96), Line(mode='latin', source='x')])
    height = lambda svg: float(_re.search(r'height="([0-9.]+)"', svg).group(1))
    assert height(export_svg(big, embed_fonts=False)[0]) > height(export_svg(small, embed_fonts=False)[0]) + 40
    r = client.post('/api/export', json={'format': 'pdf', 'document': {
        'fontsize': 40, 'lines': [{'mode': 'translit', 'source': 'nfr', 'fontsize': 80}]}})
    assert r.status_code == 200 and r.content.startswith(b'%PDF')


# ---------------------------------------------------------------- writing direction

def test_res_direction_round_trip():
    from app.documents import export_res
    doc = Document(lines=[Line(source='A1-B1', direction='hrl'), Line(source='A1:B1', direction='vrl'),
                          Line(source='C1')])
    text, _ = export_res(doc)
    assert text.splitlines()[0].startswith('[hrl]') and text.splitlines()[1].startswith('[vrl]')
    assert not text.splitlines()[2].startswith('[')
    lines, warnings, _ = import_document('x.res', text)
    assert [l.direction for l in lines] == ['hrl', 'vrl', 'hlr']


def test_gly_header_direction():
    doc = Document(lines=[Line(source='A1', direction='vrl'), Line(source='B1', direction='vrl'),
                          Line(source='C1'), Line(mode='latin', source='text')])
    text, warnings = export_mdc(doc, jsesh_header=True)
    assert '++JSesh_text_orientation VERTICAL' in text and '++JSesh_text_direction RIGHT_TO_LEFT' in text
    assert any('line(s) 3' in w for w in warnings)
    lines, _, _ = import_document('x.gly', text)
    assert [l.direction for l in lines if l.mode == 'hiero'] == ['vrl', 'vrl', 'vrl']
    assert lines[3].direction == 'hlr'  # text lines keep the default


def test_plain_mdc_and_unicode_warn_on_direction():
    from app.documents import export_unicode
    doc = Document(lines=[Line(source='A1', direction='hrl')])
    assert export_mdc(doc, jsesh_header=False)[1]
    assert export_unicode(doc)[1]


@pytest.mark.parametrize('direction', ['hlr', 'hrl', 'vlr', 'vrl'])
def test_pdf_svg_directions(direction):
    from app.render import export_pdf, export_svg
    doc = Document(lines=[Line(source='i-w-r:a-nfr-f-r', direction=direction), Line(mode='latin', source='x')])
    pdf, warnings = export_pdf(doc)
    assert pdf.startswith(b'%PDF') and not warnings
    svg, _ = export_svg(doc, embed_fonts=False)
    assert svg.count('<svg') == 2


def test_invalid_direction_rejected():
    r = client.post('/api/export', json={'format': 'pdf', 'document': {'lines': [{'source': 'A1', 'direction': 'up'}]}})
    assert r.status_code == 422

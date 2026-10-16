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


@pytest.mark.parametrize('text', ['i-w-r:', 'A1' + VER, 'A1' + HOR])
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


def test_line_references_stay_on_the_hieroglyphic_line():
    lines, warnings, _ = import_document('x.gly', '|B237-i-w-|B238-r:a-!\n')
    assert [(l.mode, l.source) for l in lines] == [('hiero', '|B237-i-w-|B238-r:a')]
    assert warnings == []
    r = client.post('/api/render', json={'text': lines[0].source}).json()
    plain = client.post('/api/render', json={'text': 'i-w-r:a'}).json()
    assert r['ok'] and r['unicode'] == plain['unicode']
    iw = client.post('/api/render', json={'text': 'i-w'}).json()['unicode']
    ra = client.post('/api/render', json={'text': 'r:a'}).json()['unicode']
    assert r['parts'] == [{'unicode': None, 'ref': 'B237'}, {'unicode': iw, 'ref': None},
                          {'unicode': None, 'ref': 'B238'}, {'unicode': ra, 'ref': None}]
    assert plain['parts'] == []


def test_line_reference_labels_may_contain_spaces():
    r = client.post('/api/render', json={'text': 'i-w-|G 1-ra-|AOS,R, 3 -n'}).json()
    assert r['ok'] and r['warnings'] == []
    assert [p['ref'] for p in r['parts'] if p['ref'] is not None] == ['G 1', 'AOS,R, 3']


def test_line_reference_between_ink_changes():
    r = client.post('/api/render', json={'text': 'A1-$b-|B200-$r-B1'}).json()
    assert r['ok'], r['error']


def test_line_references_in_exports():
    doc = Document(lines=[Line(source='i-w-|B238-r:a'), Line(source=A1 + '|7' + B1 + HOR + C1),
                          Line(source='|B239')])
    gly, warnings = export_mdc(doc, jsesh_header=False)
    assert gly == 'i-w-|B238-r:a-!\nA1-|7-B1*C1-!\n|B239-!\n' and warnings == []
    text = client.post('/api/export', json={'format': 'unicode', 'document': doc.model_dump()}).text
    assert '|' not in text and 'B238' not in text
    for fmt in ('pdf', 'svg', 'res'):
        assert client.post('/api/export', json={'format': fmt, 'document': doc.model_dump()}).status_code == 200


def test_pdf_draws_line_references(monkeypatch):
    from reportlab.pdfgen.canvas import Canvas
    from app.render import export_pdf
    labels = []
    original = Canvas.drawCentredString
    monkeypatch.setattr(Canvas, 'drawCentredString', lambda self, x, y, text, *a, **k: (
        labels.append(text), original(self, x, y, text, *a, **k))[1])
    doc = Document(lines=[Line(source='|B237-i-w-|B238-r:a'), Line(source='A1-|7-B1', direction='hrl'),
                          Line(source='|9'), Line(source='i-w-|5-r:a', direction='vlr')])
    pdf, warnings = export_pdf(doc)
    assert pdf.startswith(b'%PDF') and warnings == []
    assert labels == ['B237', 'B238', '7', '9', '5']


@pytest.mark.parametrize('text, shown_as, note', [
    ('M17-M43B-N33', 'M17-M43-N33', 'shown as M43'),
    ('M17:X1-W59A-Z1', 'M17:X1-W59-Z1', 'shown as W59'),
    ('X1-[{*A280*}]-#b-A2-#e', 'X1-[{*//*}]-#b-A2-#e', 'shown as a lost sign'),
])
def test_unknown_signs_get_stand_ins(text, shown_as, note):
    interp = hiero.interpret(text)
    assert interp.ok, interp.error
    assert interp.unicode == hiero.interpret(shown_as).unicode
    assert any(note in w for w in interp.warnings)
    gly, _ = export_mdc(Document(lines=[Line(source=text)]), jsesh_header=False)
    assert gly == text + '-!\n'  # saved as typed


def test_unknown_sign_in_hybrid_input():
    interp = hiero.interpret(A1 + ' M43B')
    assert interp.ok and any('shown as M43' in w for w in interp.warnings)


def test_jsesh_sign_shading():
    interp = hiero.interpret('A2_#1234-Q3')
    assert interp.ok and interp.unicode == hiero.interpret('A2\\shading1234-Q3').unicode


def test_unrenderable_mdc_is_saved_as_typed():
    gly, warnings = export_mdc(Document(lines=[Line(source='A1-(B1')]), jsesh_header=False)
    assert gly == 'A1-(B1-!\n' and 'written as typed' in warnings[0]


def test_line_reference_inside_a_cartouche_is_not_shown():
    r = client.post('/api/render', json={'text': '<-ra-|5-mn->'}).json()
    assert r['ok'] and r['unicode'] == client.post('/api/render', json={'text': '<-ra-mn->'}).json()['unicode']
    assert r['parts'] == [] and any('not shown' in w for w in r['warnings'])


def test_import_keeps_blank_lines():
    gly = '++JSesh_Info 1.0 +s\n++JSesh_page_orientation HORIZONTAL +s\ni-w-!\n!\n\nr:a-!\n+lText+s-!\n\nra-!\n\n\n'
    lines, warnings, _ = import_document('x.gly', gly)
    assert [(l.mode, l.source) for l in lines] == [
        ('hiero', 'i-w'), ('hiero', ''), ('hiero', ''), ('hiero', 'r:a'),
        ('latin', 'Text'), ('hiero', ''), ('hiero', 'ra'),
    ]
    assert warnings == []
    lines, _, _ = import_document('x.res', 'A1\n\nB1\n\n')
    assert [l.source for l in lines] == [A1, '', B1]
    lines, _, _ = import_document('x.txt', A1 + '\n\n the man\n\n')
    assert [(l.mode, l.source) for l in lines] == [('hiero', A1), ('hiero', ''), ('latin', 'the man')]


def test_lone_period_ends_the_line_before():
    gly = ('+tsDm.n=f+s-!\n.-!\n+lHe heard+s-!\n.\ni-w-!\n.-!\n\n.-!\n'
           '+bTitle+s-.-+iBy me+s-!\n+tdone.+s-!\n.-!\n..-!\n')
    lines, _, _ = import_document('x.gly', gly)
    assert [(l.mode, l.source) for l in lines] == [
        ('translit', 'sDm.n=f.'), ('latin', 'He heard.'), ('hiero', 'i-w'), ('hiero', ''),
        ('bold', 'Title'), ('italic', 'By me'), ('translit', 'done.'), ('hiero', '..'),
    ]


def test_period_text_segment_ends_the_line_before():
    gly = '+timn nb nst tAwi+s-+l.  +s-+tsbk+s-!\n+tra+s-!\n+l.+s-!\nA1-+l.+s-!\n'
    lines, _, _ = import_document('x.gly', gly)
    assert [(l.mode, l.source) for l in lines] == [
        ('translit', 'imn nb nst tAwi.'), ('translit', 'sbk'), ('translit', 'ra.'), ('hiero', 'A1'),
    ]


def test_import_attaches_dotted_words_in_transliteration():
    lines, _, _ = import_document('x.gly', '+tHdb .n .i Hr wAt+s-!\n+t.n sw+s-!\n+lsee .n here+s-!\n')
    assert [(l.mode, l.source) for l in lines] == [
        ('translit', 'Hdb.n.i Hr wAt'), ('translit', '.n sw'), ('latin', 'see .n here'),
    ]
    lines, _, _ = import_document('x.txt', 'ḥdb .n .i\n', 'unicode')
    assert [(l.mode, l.source) for l in lines] == [('translit', 'Hdb.n.i')]


def test_blank_lines_round_trip():
    doc = Document(lines=[Line(source='i-w'), Line(source=''), Line(mode='latin', source=''),
                          Line(mode='latin', source='x'), Line(source='ra')])
    text, _ = export_mdc(doc, jsesh_header=True)
    lines, _, _ = import_document('x.gly', text)
    assert [(l.mode, l.source) for l in lines] == [(l.mode, l.source) for l in doc.lines]


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
    assert client.get('/api/fonts/NewGardiner.ttf').status_code == 200
    assert client.get('/api/fonts/NewAthenaUnicode-Italic.ttf').status_code == 200
    assert client.get('/api/fonts/../app/main.py').status_code == 404


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


# ---------------------------------------------------------------- brackets hieropy cannot print

@pytest.mark.parametrize('mdc,expected', [
    # JSesh: a bracket opening after a group belongs to the next group
    ('D21_:X1_*[[-X1-Q3:D36-]]', 'D21:X1-[X1-(Q3:D36)]'),
    ('A1*[[-B1-]]', 'A1-[B1]'),
    ('[[-A1-]]*B1', '[A1]-B1'),
    ('A1-[[-B1:C1-]]', 'A1-[(B1:C1)]'),  # already printable: unchanged
])
def test_misplaced_brackets_are_moved_and_printable(mdc, expected):
    from hieropy import Options
    interp = hiero.interpret(mdc)
    assert interp.ok
    assert repr(interp.fragment) == expected
    interp.fragment.print(Options(imagetype='svg'))  # hieropy used to crash here
    parser = UniParser()
    assert parser.parse(interp.unicode) is not None and not parser.last_error


def test_export_with_misplaced_brackets():
    doc = {'lines': [{'mode': 'hiero', 'source': 'D21_:X1_*[[-X1-Q3:D36-]]'}]}
    for fmt in ('pdf', 'svg'):
        assert client.post('/api/export', json={'format': fmt, 'document': doc}).status_code == 200


# ---------------------------------------------------------------- j for i in sign names

@pytest.mark.parametrize('with_j,with_i', [
    ('jnj', 'ini'), ('j-w-r:a', 'i-w-r:a'), ('jb-Hwj', 'ib-Hwi'), ('jj', 'ii'), ('A1\\R90-jnj', 'A1\\R90-ini'),
])
def test_j_means_i_in_mdc(with_j, with_i):
    a, b = hiero.interpret(with_j), hiero.interpret(with_i)
    assert a.ok and b.ok and a.unicode == b.unicode


def test_j_means_i_in_hybrid_input():
    assert hiero.interpret('jnj' + HOR + 'A1').unicode == hiero.interpret('ini' + HOR + 'A1').unicode


def test_gly_export_writes_i_for_j():
    text, _ = export_mdc(Document(lines=[Line(source='jnj-j-w')]), jsesh_header=False)
    assert text == 'ini-i-w-!\n'


def test_outlined_svg_export_needs_no_fonts():
    doc = {'fontsize': 40, 'lines': [
        {'mode': 'hiero', 'source': '<-ra:mn->-A1\\-[[-B1-]]'}, {'mode': 'hiero', 'source': 'i-w', 'direction': 'hrl'},
        {'mode': 'translit', 'source': '^imn-Htp Xnmw'}, {'mode': 'bold', 'source': 'Bold'}]}
    r = client.post('/api/export', json={'format': 'svg', 'document': doc, 'outline': True})
    assert r.status_code == 200
    assert '<text' not in r.text and '<style' not in r.text and '@font-face' not in r.text
    assert r.text.count('<path') >= 10
    plain = client.post('/api/export', json={'format': 'svg', 'document': doc})
    assert '<text' in plain.text and '@font-face' in plain.text  # the normal export is unchanged


# ---------------------------------------------------------------- cut and paste

def _edit(**kw):
    return client.post('/api/edit', json=kw).json()


def test_render_lists_items():
    r = client.post('/api/render', json={'text': 'i-w-|B1-r:a'}).json()
    assert [i['ref'] or 'g' for i in r['items']] == ['g', 'g', 'B1', 'g']
    assert r['items'][3]['unicode'] == hiero.interpret('r:a').unicode


def test_cut_and_paste_keep_the_mdc_as_typed():
    cut = _edit(source='i-w-r:a-<-ra-mn->-n:f', op='cut', start=1, end=4)
    assert cut['ok'] and cut['mdc'] == 'w-r:a-<-ra-mn->' and cut['source'] == 'i-n:f'
    pasted = _edit(source='A1-B1', op='paste', start=1, text=cut['mdc'])
    assert pasted['ok'] and pasted['source'] == 'A1-w-r:a-<-ra-mn->-B1'
    assert _edit(source='A1-B1', op='paste', start=2, text='nfr')['source'] == 'A1-B1-nfr'


def test_ink_marks_stay_put():
    r = _edit(source='$r-A1-B1-$b-C1', op='cut', start=0, end=2)
    assert r['mdc'] == 'A1-B1' and r['source'] == '$r-$b-C1'


def test_copy_with_references():
    r = _edit(source='i-w-|G 1-r:a', op='copy', start=1, end=4)
    assert r['ok'] and r['source'] == 'i-w-|G 1-r:a' and r['mdc'] == 'w-|G 1-r:a'
    assert _edit(source='n:f', op='paste', start=1, text=r['mdc'])['source'] == 'n:f-w-|G 1-r:a'


def test_unicode_line_stays_unicode():
    r = _edit(source=A1 + B1 + C1, op='cut', start=1, end=2)
    assert r['source'] == A1 + C1 and r['mdc'] == 'B1'
    assert _edit(source=A1, op='paste', start=0, text='B1')['source'] == B1 + A1
    assert _edit(source='', op='paste', start=0, text='r:a')['source'] == 'r:a'


def test_paste_keeps_typed_groups_whole():
    r = _edit(source='A1*B1-C1', op='paste', start=1, text='D1')
    assert r['ok'] and r['source'] == 'A1*B1-D1-C1'


def test_cut_inside_a_typed_piece_rewrites_the_line():
    # Unicode signs typed without separators are one piece: cutting one of them rewrites the line.
    r = _edit(source=A1 + B1 + '-C1', op='cut', start=1, end=2)
    assert r['ok'] and r['mdc'] == 'B1' and hiero.interpret(r['source']).unicode == A1 + C1


def test_paste_rejects_non_hieroglyphs():
    r = _edit(source='A1', op='paste', start=1, text='i-w-r:')
    assert not r['ok'] and 'Cannot paste' in r['error']

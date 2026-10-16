import json
import os
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import documents, editing, hiero, render
from .documents import Document, Line

app = FastAPI(title='SebaSesh')

MAX_UPLOAD_BYTES = 5 * 1024 * 1024


class RenderRequest(BaseModel):
    text: str = Field(max_length=10_000)


class RenderBatchRequest(BaseModel):
    texts: list[str] = Field(max_length=5_000)


class RenderPart(BaseModel):
    """Hieroglyphs (`unicode`) or a JSesh line reference (`ref`)."""
    unicode: str | None = None
    ref: str | None = None


class RenderResult(BaseModel):
    ok: bool
    error: str = ''
    warnings: list[str] = []
    unicode: str = ''
    sourceFormat: str = 'empty'
    # Only for lines with line references: hieroglyphs and references in order.
    parts: list[RenderPart] = []
    # The line's top-level groups and references, one by one (what can be selected and cut).
    items: list[RenderPart] = []


class ExportRequest(BaseModel):
    format: str = Field(pattern='^(gly|mdc|res|unicode|pdf|svg)$')
    document: Document
    filename: str = Field(default='document', max_length=200)
    # SVG only: glyph outlines instead of text with embedded fonts (used for the clipboard,
    # where browsers strip the fonts).
    outline: bool = False


class ImportResult(BaseModel):
    format: str
    lines: list[Line]
    warnings: list[str]


def render_text(text: str) -> RenderResult:
    interp = hiero.interpret(text)
    if not interp.ok:
        return RenderResult(ok=False, error=interp.error, sourceFormat=interp.source_format)
    # The browser draws the Unicode encoding with HieroJax; hieropy is used for
    # interpretation here and for rendering exports.
    parts = [RenderPart(ref=p.ref) if p.ref is not None else RenderPart(unicode=str(p.fragment))
             for p in interp.parts]
    items = [RenderPart(ref=i.ref) if i.ref is not None else RenderPart(unicode=editing.item_unicode(i))
             for i in editing.items_of(interp)]
    return RenderResult(ok=True, warnings=interp.warnings, unicode=interp.unicode,
                        sourceFormat=interp.source_format, parts=parts, items=items)


class EditRequest(BaseModel):
    source: str = Field(max_length=10_000)
    op: str = Field(pattern='^(copy|cut|paste)$')
    # copy/cut: items [start, end); paste: before item `start`.
    start: int = Field(ge=0)
    end: int = Field(default=0, ge=0)
    text: str = Field(default='', max_length=10_000)


class EditResponse(BaseModel):
    ok: bool
    error: str = ''
    source: str = ''
    mdc: str = ''
    count: int = 0
    warnings: list[str] = []


@app.post('/api/edit', response_model=EditResponse)
def edit_line(req: EditRequest):
    r = editing.edit(req.source, req.op, req.start, req.end, req.text)
    return EditResponse(ok=r.ok, error=r.error, source=r.source, mdc=r.mdc, count=r.count,
                        warnings=r.warnings)


@app.get('/api/health')
def health():
    return {'status': 'ok'}


@app.post('/api/render', response_model=RenderResult)
def render_line(req: RenderRequest):
    return render_text(req.text)


@app.post('/api/render-batch', response_model=list[RenderResult])
def render_batch(req: RenderBatchRequest):
    return [render_text(t) for t in req.texts]


EXPORTS = {
    'gly': ('gly', 'application/octet-stream'),
    'mdc': ('mdc', 'text/plain; charset=utf-8'),
    'res': ('res', 'text/plain; charset=utf-8'),
    'unicode': ('txt', 'text/plain; charset=utf-8'),
    'pdf': ('pdf', 'application/pdf'),
    'svg': ('svg', 'image/svg+xml'),
}


@app.post('/api/export')
def export(req: ExportRequest):
    doc = req.document
    match req.format:
        case 'gly':
            content, warnings = documents.export_mdc(doc, jsesh_header=True)
        case 'mdc':
            content, warnings = documents.export_mdc(doc, jsesh_header=False)
        case 'res':
            content, warnings = documents.export_res(doc)
        case 'unicode':
            content, warnings = documents.export_unicode(doc)
        case 'pdf':
            content, warnings = render.export_pdf(doc)
        case 'svg':
            content, warnings = render.export_svg(doc, outline=req.outline)
    ext, media_type = EXPORTS[req.format]
    stem = ''.join(c for c in req.filename if c.isalnum() or c in '-_ ').strip() or 'document'
    headers = {
        'Content-Disposition': f'attachment; filename="{stem}.{ext}"',
        # ASCII-only JSON so it is a valid header value.
        'X-Export-Warnings': json.dumps(warnings[:50]),
        'Access-Control-Expose-Headers': 'X-Export-Warnings, Content-Disposition',
    }
    return Response(content=content, media_type=media_type, headers=headers)


@app.post('/api/import', response_model=ImportResult)
async def import_file(file: UploadFile = File(...), format: str | None = Form(default=None)):
    if format is not None and format not in ('gly', 'mdc', 'res', 'unicode'):
        raise HTTPException(400, 'Unknown format')
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, 'File too large')
    content = None
    for encoding in ('utf-8', 'cp1252', 'latin-1'):
        try:
            content = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    lines, warnings, fmt = documents.import_document(file.filename or '', content, format)
    return ImportResult(format=fmt, lines=lines, warnings=warnings[:200])


# ---------------------------------------------------------------- fonts & frontend

FONT_FILES = {p.name: p for p in render.FONT_DIR.glob('*.ttf')}


@app.get('/api/fonts/{name}')
def font(name: str):
    if name == 'NewGardiner.ttf':
        path = render.hiero_font_path()
    elif name in FONT_FILES:
        path = FONT_FILES[name]
    else:
        raise HTTPException(404)
    return FileResponse(path, media_type='font/ttf', headers={'Cache-Control': 'public, max-age=604800'})


STATIC_DIR = Path(os.environ.get('STATIC_DIR', Path(__file__).resolve().parent.parent / 'static'))
if STATIC_DIR.is_dir():
    app.mount('/', StaticFiles(directory=STATIC_DIR, html=True), name='frontend')

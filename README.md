# Seba-Sesh Hieroglyphic Editor

A web editor for ancient Egyptian hieroglyphic text, transliteration and Latin text, in the spirit of
[JSesh](https://jsesh.qenherkhopeshef.org/). It is styled like the Seba-Seba Egyptian Dictionary; transliteration is set in New Athena Unicode Italic.

* **Frontend:** React + TypeScript (Vite) with Bootstrap 5 and Font Awesome. Hieroglyphs in the main window
  are drawn by [HieroJax](https://nederhof.github.io/hierojax/).
* **Backend:** Python (FastAPI) using [hieropy](../hieropy) to interpret Manuel de Codage, RES and Unicode,
  and to render the PDF and SVG exports.

## Running

```bash
docker compose up --build        # then open http://localhost:8080
```

The image installs hieropy from the `../hieropy` checkout, passed as a named build context.
Without compose, run:

```bash
docker build --build-context hieropy=../hieropy -t sebasesh .
docker run -p 8080:8000 sebasesh
```

## Using the editor

The document is a list of lines. You type each line in the input bar at the bottom, and it renders in
the main window on every keystroke. When a hieroglyphic line can't be rendered yet (for example,
`i-w-r:` with an unfinished group), the status bar shows why. The line keeps showing its last valid
rendering, dimmed. As soon as the text is valid again, it renders.

| Line type | What you type | Example |
| --- | --- | --- |
| Hieroglyphs | Manuel de Codage | `<-ra:mn-xpr->-i-w-r:a` |
| | Unicode hieroglyphs and format controls | `𓀀𓐱𓁐` |
| | Sign codes or mnemonics mixed with control characters | `A1𓐰B1𓐱nfr` |
| Transliteration | ASCII MdC transliteration (`^` capitalises) | `^imn-Htp sA=f` → Ꞽmn-ḥtp sꜣ=f |
| Latin / Bold / Italic | plain text | |

* **Left sidebar:** Unicode control characters (joiners, insertions, enclosures, blanks/lacunae,
  mirroring, rotation, damage). Clicking one inserts it at the caret.
* **Toolbar:** show/hide the control-character panel, undo/redo, line type for the current line,
  orientation (Horizontal/Vertical) and direction (L→R/R→L) of hieroglyphic lines, font size, New, Open, Export.
* **Writing direction:** each hieroglyphic line is horizontal left-to-right unless set otherwise. The
  orientation and direction buttons act on the current line, or on all selected hieroglyphic lines.
  Right-to-left lines are mirrored and set flush right; vertical lines are columns. A new line keeps the
  direction of the line it follows.
* **Undo/redo:** ⌘Z / Ctrl+Z and ⇧⌘Z / Ctrl+Y, or the toolbar buttons. Up to 100 steps are kept
  (`DEFAULT_UNDO_LIMIT` in `frontend/src/history.ts`). Typing in one line counts as one step until you pause
  for a second; every other edit (control icons, line type, new/deleted/moved lines, font size, New, Open) is
  its own step. History lasts for the browser session.
* **Font size:** with nothing selected it applies to the whole document. Select text in the main window
  (drag, shift-click, Cmd/Ctrl-click a line, or Shift+↑/↓ in the input line) and it applies only to the
  selected lines; Esc or the × on the "lines selected" chip clears the selection. Sizes carry into PDF/SVG export.
* **Keys:** Enter adds a new line, ↑/↓ move between lines, and Backspace on an empty line deletes it.
  You can also click any line to edit it.
* The document is saved automatically in the browser (localStorage).

In mixed input, `:` `*` `(` `)` `\` `.` `..` `/` `//` keep their MdC meanings, and spaces or `-` separate
groups. As in MdC, signs must be separated: `B1-nfr`, not `B1nfr`.

### Open (import)

| Format | Notes |
| --- | --- |
| JSesh `.gly` / MdC | The JSesh header's orientation/direction applies to all hieroglyphic lines. `!` ends a line. `+l` `+b` `+i` `+t` text segments become Latin, bold, italic or transliteration lines. The MdC source is kept as typed. |
| RES `.res` | One fragment per line, converted to Unicode with hieropy; a `[hrl]`-style header sets the line's direction. |
| Unicode text | Hieroglyphic runs become hieroglyph lines. Text containing Egyptological characters becomes a transliteration line; other text becomes a Latin line. |

### Export

| Format | Notes |
| --- | --- |
| JSesh `.gly` | JSesh header (one direction for the whole document: the most common one, with a note if lines differ) and MdC lines ending in `-!`; text lines use `+l`, `+b`, `+i` or `+t`. Lines typed in MdC are written exactly as typed. |
| MdC `.mdc` | Same content without the JSesh header. |
| RES `.res` | Hieroglyphic lines only, since RES has no text lines; non-default directions are written as `[hrl]` etc. |
| Unicode `.txt` | One line per editor line (no writing direction; noted if any line isn't horizontal left-to-right). |
| PDF | A4, vector, with selectable text. Hieroglyphs are drawn by hieropy. |
| SVG | One image; the fonts are subset and embedded, so the file is portable. |

Anything a target format can't express (for example, MdC has no middle insertion) is approximated, and
listed in a notice after export. Lines that can't be rendered are skipped and reported the same way.

## Development

```bash
# backend tests (Python 3.12 is required: hieropy's RES parser uses int.is_integer)
docker build --build-context hieropy=../hieropy --target test -t sebasesh-test . && docker run --rm sebasesh-test

# frontend dev server (proxies /api and /fonts to the backend; set BACKEND_URL to change the target)
cd frontend && npm install && BACKEND_URL=http://localhost:8080 npm run dev
```

Layout:

```
backend/app/hiero.py      input interpretation (MdC / Unicode / mixed) via hieropy
backend/app/convert.py    Unicode -> MdC (JSesh) and Unicode -> RES writers
backend/app/documents.py  .gly / MdC / RES / Unicode import and text exports
backend/app/render.py     PDF and SVG document export
backend/app/translit.py   ASCII -> Unicode transliteration (mirrored in frontend/src/translit.ts)
frontend/src/             React app; frontend/public/ holds HieroJax and its NewGardiner.otf
```

## Licences

* hieropy and HieroJax (M.-J. Nederhof) are GPL-3.0; see `frontend/public/HIEROJAX-LICENSE.txt`.
* New Athena Unicode (Society for Classical Studies) is under the SIL OFL 1.1, as stated in the font itself.
* Noto Sans and Noto Serif are under the SIL OFL (`backend/fonts/OFL-Noto.txt`).
* The favicon comes from the Seba-Seba Egyptian Dictionary.

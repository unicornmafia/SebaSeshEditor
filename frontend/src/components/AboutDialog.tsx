interface Props {
  onClose: () => void;
}

interface Source {
  name: string;
  url: string;
  by: string;
  licence?: string;
  use: string;
}

const SOURCES: Source[] = [
  {
    name: 'hieropy',
    url: 'https://github.com/nederhof/hieropy',
    by: 'Mark-Jan Nederhof',
    licence: 'GPL-3.0',
    use: 'Python library behind the server: reads Manuel de Codage, RES and Unicode, converts between them, and draws the PDF and SVG exports.',
  },
  {
    name: 'HieroJax',
    url: 'https://nederhof.github.io/hierojax/',
    by: 'Mark-Jan Nederhof',
    licence: 'GPL-3.0',
    use: 'JavaScript library that draws the hieroglyphs in the main window from their Unicode encoding.',
  },
  {
    name: 'NewGardiner and NewGardinerOmni fonts',
    url: 'https://github.com/nederhof/newgardiner',
    by: 'Mark-Jan Nederhof',
    use: 'The hieroglyphic font used throughout; the Omni builds lay out groups through OpenType.',
  },
  {
    name: 'RES (Revised Encoding Scheme)',
    url: 'https://mjn.host.cs.st-andrews.ac.uk/egyptian/res/',
    by: 'Mark-Jan Nederhof',
    use: 'One of the import and export formats.',
  },
  {
    name: 'JSesh',
    url: 'https://jsesh.qenherkhopeshef.org/',
    by: 'Serge Rosmorduc',
    use: 'The model for this editor: its .gly file format and Manuel de Codage conventions are what Seba-Sesh reads and writes.',
  },
  {
    name: 'Unicode Egyptian Hieroglyphs',
    url: 'https://www.unicode.org/charts/PDF/U13000.pdf',
    by: 'The Unicode Consortium',
    use: 'The signs and format controls (joiners, insertions, enclosures, damage) the editor works in.',
  },
  {
    name: 'New Athena Unicode',
    url: 'https://apagreekkeys.org/NAUdownload.html',
    by: 'Society for Classical Studies',
    licence: 'SIL OFL 1.1',
    use: 'Font for transliteration.',
  },
  {
    name: 'Noto Serif',
    url: 'https://fonts.google.com/noto/specimen/Noto+Serif',
    by: 'Google',
    licence: 'SIL OFL 1.1',
    use: 'Font for Latin, bold and italic text lines.',
  },
  {
    name: 'React, Vite, Bootstrap, Font Awesome, FastAPI, ReportLab, fontTools',
    url: 'https://github.com/unicornmafia/SebaSeshEditor',
    by: 'their respective authors',
    use: 'The application framework, interface and PDF/font tooling.',
  },
];

export default function AboutDialog({ onClose }: Props) {
  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="about-title"
        onKeyDown={(e) => e.key === 'Escape' && onClose()} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
          <div className="modal-content">
            <div className="modal-header modal-header-seba">
              <h5 className="modal-title" id="about-title">
                <span className="about-glyph" aria-hidden="true">{'\u{13080}'}</span> About Seba-Sesh
              </h5>
              <button type="button" className="btn-close btn-close-white" aria-label="Close" onClick={onClose} autoFocus />
            </div>
            <div className="modal-body about-body">
              <p>
                Seba-Sesh is a web editor for ancient Egyptian texts, in the spirit of JSesh. A document is a list of
                lines, each of which is hieroglyphic, transliteration, or Latin text (plain, bold or italic).
                Hieroglyphs can be typed in Manuel de Codage, as Unicode, or as a mix of sign codes and Unicode
                format controls, which the panel on the left inserts. Each line is drawn as you type.
              </p>
              <p>
                Documents can be opened from JSesh <code>.gly</code>, Manuel de Codage, RES and Unicode text files, and
                exported to those formats as well as PDF and SVG. Hieroglyphic lines can be horizontal or vertical,
                left-to-right or right-to-left, and each line has its own size.
              </p>
              <p>
                Seba-Sesh is a companion to the{' '}
                <a href="https://sebaseba.marshbot.com" target="_blank" rel="noopener noreferrer">Seba-Seba Egyptian Dictionary</a>.
                The source code is on{' '}
                <a href="https://github.com/unicornmafia/SebaSeshEditor" target="_blank" rel="noopener noreferrer">GitHub</a>.
              </p>

              <h6 className="about-heading">Sources</h6>
              <ul className="about-sources">
                {SOURCES.map((s) => (
                  <li key={s.name}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
                    <span className="text-muted"> — {s.by}{s.licence ? ` (${s.licence})` : ''}</span>
                    <div className="small">{s.use}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn search-submit" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}

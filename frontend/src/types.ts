export type Mode = 'hiero' | 'translit' | 'latin' | 'bold' | 'italic';

/** Writing direction of a hieroglyphic line: h(orizontal)/v(ertical) + lr/rl. Default 'hlr'. */
export type Direction = 'hlr' | 'hrl' | 'vlr' | 'vrl';
export type Orientation = 'h' | 'v';
export type Flow = 'lr' | 'rl';

export const orientationOf = (d: Direction): Orientation => d[0] as Orientation;
export const flowOf = (d: Direction): Flow => d.slice(1) as Flow;
export const makeDirection = (o: Orientation, f: Flow): Direction => `${o}${f}` as Direction;

/** `icon` is a Font Awesome class; `glyph`, when given, is shown as text instead. */
export const MODES: { mode: Mode; label: string; short: string; icon: string; glyph?: string }[] = [
  { mode: 'hiero', label: 'Hieroglyphs', short: 'Glyphs', icon: 'fa-solid fa-ankh' },
  // ṯ: the transliteration of MdC 'T'
  { mode: 'translit', label: 'Transliteration', short: 'Translit', icon: '', glyph: '\u1E6F' },
  { mode: 'latin', label: 'Latin', short: 'Latin', icon: 'fa-solid fa-font' },
  { mode: 'bold', label: 'Bold', short: 'Bold', icon: 'fa-solid fa-bold' },
  { mode: 'italic', label: 'Italic', short: 'Italic', icon: 'fa-solid fa-italic' },
];

/** Result of interpreting a hieroglyphic line on the server (hieropy). */
export interface RenderResult {
  ok: boolean;
  error: string;
  warnings: string[];
  unicode: string;
  sourceFormat: 'empty' | 'mdc' | 'unicode' | 'hybrid';
}

export interface Line {
  id: string;
  mode: Mode;
  source: string;
  /** Per-line font size; undefined means the document's size. */
  fontsize?: number;
  /** Writing direction of a hieroglyphic line; undefined means 'hlr'. */
  direction?: Direction;
  /** Latest server result for `source` (hieroglyphic lines only). */
  result?: RenderResult;
  /** Unicode of the last source that could be rendered; what the display box shows. */
  rendered?: string;
}

export interface StoredDocument {
  fontsize: number;
  lines: { mode: Mode; source: string; fontsize?: number; direction?: Direction }[];
}

export type ExportFormat = 'gly' | 'mdc' | 'res' | 'unicode' | 'pdf' | 'svg';
export type ImportFormat = 'gly' | 'mdc' | 'res' | 'unicode';

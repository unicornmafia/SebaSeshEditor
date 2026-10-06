import type { MODES } from '../types';

/** Icon of a line type: a Font Awesome icon, or a text glyph (ṯ for transliteration). */
export default function ModeIcon({ mode, className = '' }: { mode: (typeof MODES)[number]; className?: string }) {
  if (mode.glyph) {
    return <span className={`mode-glyph ${className}`} aria-hidden="true">{mode.glyph}</span>;
  }
  return <i className={`${mode.icon} ${className}`} aria-hidden="true" />;
}

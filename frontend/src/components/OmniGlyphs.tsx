import type { Direction } from '../types';

interface Props {
  unicode: string;
  fontsize: number;
  /** CSS font family of the chosen NewGardinerOmni build. */
  family: string;
  direction: Direction;
}

/**
 * A hieroglyphic line drawn as text in a NewGardinerOmni font: the font's own OpenType
 * features turn the Unicode format controls into quadrats, so no HieroJax layout is involved.
 * Only left-to-right is supported by these fonts; right-to-left lines are drawn by HieroJax.
 */
export default function OmniGlyphs({ unicode, fontsize, family, direction }: Props) {
  const vertical = direction.startsWith('v');
  return (
    <span className={`omni-text${vertical ? ' omni-vertical' : ''}`} style={{ fontFamily: `'${family}'`, fontSize: fontsize }}>
      {unicode}
    </span>
  );
}

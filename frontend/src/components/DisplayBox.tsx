import { forwardRef, useEffect, useRef } from 'react';
import { asciiToUnicode } from '../translit';
import { HIERO_FONTS, type HieroFont, type Line } from '../types';
import HieroGlyphs from './HieroGlyphs';
import OmniGlyphs from './OmniGlyphs';

interface Props {
  lines: Line[];
  activeIndex: number;
  selectedIds: Set<string>;
  fontsize: number;
  hieroFont: HieroFont;
  onLineClick: (index: number, e: React.MouseEvent) => void;
  onMove: (index: number, delta: number) => void;
  onDelete: (index: number) => void;
  onCopy: (index: number) => void;
}

/** Safari (WebKit without Chrome); its text shaping differs for the NewGardinerOmni fonts. */
const IS_SAFARI = /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);

/** Text is set smaller than hieroglyphs, as in printed editions (matches the PDF export). */
export const TEXT_SCALE = 0.5;

/** The main window. Lines carry data-line-id so a text selection can be mapped back to lines. */
const DisplayBox = forwardRef<HTMLDivElement, Props>(function DisplayBox(
  { lines, activeIndex, selectedIds, fontsize, hieroFont, onLineClick, onMove, onDelete, onCopy },
  ref,
) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div className="display-box" role="list" ref={ref}>
      {lines.map((line, i) => {
        const active = i === activeIndex;
        const selected = selectedIds.has(line.id);
        const stale = line.mode === 'hiero' && line.result !== undefined && !line.result.ok;
        const classes = ['display-line', `mode-${line.mode}`];
        if (active) classes.push('active');
        if (selected) classes.push('selected');
        if (stale) classes.push('stale');
        // Right-to-left hieroglyphic lines are set flush right, as in JSesh.
        if (line.mode === 'hiero' && line.direction?.endsWith('rl')) classes.push('rtl');
        return (
          <div
            key={line.id}
            ref={active ? activeRef : undefined}
            role="listitem"
            data-line-id={line.id}
            className={classes.join(' ')}
            onClick={(e) => onLineClick(i, e)}
          >
            <span className="line-number" title={stale ? `Cannot be rendered: ${line.result?.error}` : undefined}>{i + 1}</span>
            <div className="line-content">
              <LineContent line={line} fontsize={line.fontsize ?? fontsize} hieroFont={hieroFont} />
            </div>
            <div className="line-actions" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="btn btn-sm btn-link" onClick={() => onCopy(i)}
                title={line.mode === 'hiero' ? 'Copy line (as image and text)' : 'Copy line text'}
                aria-label="Copy line" disabled={!line.source.trim()}>
                <i className="fa-regular fa-copy" />
              </button>
              <button type="button" className="btn btn-sm btn-link" title="Move up" disabled={i === 0} onClick={() => onMove(i, -1)}>
                <i className="fa-solid fa-arrow-up" />
              </button>
              <button type="button" className="btn btn-sm btn-link" title="Move down" disabled={i === lines.length - 1} onClick={() => onMove(i, 1)}>
                <i className="fa-solid fa-arrow-down" />
              </button>
              <button type="button" className="btn btn-sm btn-link text-danger" title="Delete line" disabled={lines.length === 1} onClick={() => onDelete(i)}>
                <i className="fa-solid fa-trash-can" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default DisplayBox;

function LineContent({ line, fontsize, hieroFont }: { line: Line; fontsize: number; hieroFont: HieroFont }) {
  if (line.mode === 'hiero') {
    if (!line.rendered) {
      return <span className="line-placeholder" style={{ height: fontsize }}>{line.source.trim() ? '' : ' '}</span>;
    }
    const direction = line.direction ?? 'hlr';
    const omniFamily = HIERO_FONTS.find((f) => f.value === hieroFont)?.family;
    // The Omni fonts only do left-to-right, so right-to-left lines stay with HieroJax; so do
    // vertical lines in Safari, whose text engine garbles the Omni fonts' vertical layout.
    if (omniFamily && direction.endsWith('lr') && !(IS_SAFARI && direction.startsWith('v'))) {
      return <OmniGlyphs unicode={line.rendered} fontsize={fontsize} family={omniFamily} direction={direction} />;
    }
    return <HieroGlyphs unicode={line.rendered} fontsize={fontsize} direction={direction} />;
  }
  const text = line.mode === 'translit' ? asciiToUnicode(line.source) : line.source;
  return (
    <span className={`text-line text-${line.mode}`} style={{ fontSize: fontsize * TEXT_SCALE }}>
      {text || ' '}
    </span>
  );
}

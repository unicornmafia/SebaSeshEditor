import { forwardRef, useEffect, useRef } from 'react';
import { asciiToUnicode } from '../translit';
import type { Line } from '../types';
import HieroGlyphs from './HieroGlyphs';

interface Props {
  lines: Line[];
  activeIndex: number;
  selectedIds: Set<string>;
  fontsize: number;
  onLineClick: (index: number, e: React.MouseEvent) => void;
  onMove: (index: number, delta: number) => void;
  onDelete: (index: number) => void;
}

/** Text is set smaller than hieroglyphs, as in printed editions (matches the PDF export). */
export const TEXT_SCALE = 0.5;

/** The main window. Lines carry data-line-id so a text selection can be mapped back to lines. */
const DisplayBox = forwardRef<HTMLDivElement, Props>(function DisplayBox(
  { lines, activeIndex, selectedIds, fontsize, onLineClick, onMove, onDelete },
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
              <LineContent line={line} fontsize={line.fontsize ?? fontsize} />
            </div>
            <div className="line-actions" onClick={(e) => e.stopPropagation()}>
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

function LineContent({ line, fontsize }: { line: Line; fontsize: number }) {
  if (line.mode === 'hiero') {
    if (!line.rendered) {
      return <span className="line-placeholder" style={{ height: fontsize }}>{line.source.trim() ? '' : ' '}</span>;
    }
    return <HieroGlyphs unicode={line.rendered} fontsize={fontsize} direction={line.direction} />;
  }
  const text = line.mode === 'translit' ? asciiToUnicode(line.source) : line.source;
  return (
    <span className={`text-line text-${line.mode}`} style={{ fontSize: fontsize * TEXT_SCALE }}>
      {text || ' '}
    </span>
  );
}

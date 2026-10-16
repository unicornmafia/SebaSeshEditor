import { Fragment, forwardRef, useEffect, useRef } from 'react';
import { splitMatches } from '../search';
import { asciiToUnicode } from '../translit';
import { HIERO_FONTS, type Direction, type GlyphCursor, type HieroFont, type Line, type RenderPart } from '../types';
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
  /** Lines matching the search, and the text to mark in text lines. */
  matchIds?: Set<string>;
  highlight?: string;
  /** Selected glyphs or paste position on the current line. */
  glyphCursor: GlyphCursor | null;
  /** Pointer pressed on item `index` of the current line (`shift`: extend the selection). */
  onItemDown: (index: number, shift: boolean) => void;
  /** Pointer moved onto item `index` while pressed (dragging a selection). */
  onItemEnter: (index: number) => void;
  /** Pointer pressed in the gap before item `at`. */
  onGapDown: (at: number) => void;
}

/** Handlers for the clickable glyphs of the current line. */
interface GlyphHandlers {
  cursor: GlyphCursor | null;
  onItemDown: Props['onItemDown'];
  onItemEnter: Props['onItemEnter'];
  onGapDown: Props['onGapDown'];
}

/** Safari (WebKit without Chrome); its text shaping differs for the NewGardinerOmni fonts. */
const IS_SAFARI = /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);

/** Text is set smaller than hieroglyphs, as in printed editions (matches the PDF export). */
export const TEXT_SCALE = 0.5;

/** The main window. Lines carry data-line-id so a text selection can be mapped back to lines. */
const DisplayBox = forwardRef<HTMLDivElement, Props>(function DisplayBox(
  { lines, activeIndex, selectedIds, fontsize, hieroFont, onLineClick, onMove, onDelete, onCopy, matchIds, highlight = '',
    glyphCursor, onItemDown, onItemEnter, onGapDown },
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
        if (matchIds?.has(line.id)) classes.push('search-match');
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
              <LineContent line={line} fontsize={line.fontsize ?? fontsize} hieroFont={hieroFont}
                highlight={matchIds?.has(line.id) ? highlight : ''}
                glyphs={active ? { cursor: glyphCursor?.lineId === line.id ? glyphCursor : null, onItemDown, onItemEnter, onGapDown } : null} />
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

function LineContent({ line, fontsize, hieroFont, highlight, glyphs }: {
  line: Line; fontsize: number; hieroFont: HieroFont; highlight: string;
  /** Set for the current line: its groups can be clicked, selected and cut. */
  glyphs: GlyphHandlers | null;
}) {
  if (line.mode === 'hiero') {
    if (!line.rendered && !line.renderedParts) {
      return <span className="line-placeholder" style={{ height: fontsize }}>{line.source.trim() ? '' : ' '}</span>;
    }
    const direction = line.direction ?? 'hlr';
    if (glyphs && line.renderedItems?.length) {
      return <GlyphItems items={line.renderedItems} fontsize={fontsize} hieroFont={hieroFont} direction={direction} {...glyphs} />;
    }
    if (line.renderedParts) {
      // JSesh line references (|B237): a bar with the label on top, between runs of hieroglyphs.
      return (
        <span className={`ref-line ref-line-${direction}`}>
          {line.renderedParts.map((part, k) => part.ref !== null
            ? <RefMark key={k} label={part.ref} fontsize={fontsize} />
            : <Glyphs key={k} unicode={part.unicode ?? ''} fontsize={fontsize} hieroFont={hieroFont} direction={direction} />)}
        </span>
      );
    }
    return <Glyphs unicode={line.rendered ?? ''} fontsize={fontsize} hieroFont={hieroFont} direction={direction} />;
  }
  const text = line.mode === 'translit' ? asciiToUnicode(line.source) : line.source;
  // A transliteration found by its ASCII (nTr) is marked where it shows (nṯr).
  const mark = line.mode === 'translit' && highlight && !text.toLowerCase().includes(highlight.toLowerCase())
    ? asciiToUnicode(highlight) : highlight;
  return (
    <span className={`text-line text-${line.mode}`} style={{ fontSize: fontsize * TEXT_SCALE }}>
      {text ? splitMatches(text, mark).map((part, k) => (k % 2 ? <mark key={k}>{part}</mark> : part)) : ' '}
    </span>
  );
}

function RefMark({ label, fontsize }: { label: string; fontsize: number }) {
  return (
    <span className="line-ref" style={{ fontSize: fontsize * REF_SCALE }}>
      <span className="line-ref-label">{label}</span>
      <span className="line-ref-bar" />
    </span>
  );
}

/**
 * The current hieroglyphic line drawn group by group, so groups can be selected (click,
 * shift-click, drag) and a paste position set (click between groups).
 */
function GlyphItems({ items, fontsize, hieroFont, direction, cursor, onItemDown, onItemEnter, onGapDown }: GlyphHandlers & {
  items: RenderPart[]; fontsize: number; hieroFont: HieroFont; direction: Direction;
}) {
  const [from, to] = cursor?.kind === 'items'
    ? [Math.min(cursor.anchor, cursor.head), Math.max(cursor.anchor, cursor.head)] : [-1, -2];
  const caret = cursor?.kind === 'caret' ? cursor.at : -1;
  // The press is handled here, not by the line (which would move the focus to the input bar).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  // The focus stays where the editor put it (see App), rather than moving to the page.
  const keepFocus = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  const gap = (at: number) => (
    <span className={`glyph-gap${caret === at ? ' caret' : ''}`} title="Paste here (⌘V)"
      onPointerDown={(e) => { stop(e); onGapDown(at); }} onMouseDown={keepFocus} onClick={stop} />
  );
  return (
    <span className={`ref-line ref-line-${direction} glyph-items`}>
      {items.map((item, k) => (
        <Fragment key={k}>
          {gap(k)}
          <span className={`glyph-item${k >= from && k <= to ? ' selected' : ''}`}
            onPointerDown={(e) => { stop(e); onItemDown(k, e.shiftKey); }} onMouseDown={keepFocus}
            onPointerEnter={(e) => { if (e.buttons & 1) onItemEnter(k); }} onClick={stop}>
            {item.ref !== null
              ? <RefMark label={item.ref} fontsize={fontsize} />
              : <Glyphs unicode={item.unicode ?? ''} fontsize={fontsize} hieroFont={hieroFont} direction={direction} />}
          </span>
        </Fragment>
      ))}
      {gap(items.length)}
    </span>
  );
}

/** Size of a line reference's label relative to the hieroglyphs. */
const REF_SCALE = 0.3;

function Glyphs({ unicode, fontsize, hieroFont, direction }: {
  unicode: string; fontsize: number; hieroFont: HieroFont; direction: Direction;
}) {
  const omniFamily = HIERO_FONTS.find((f) => f.value === hieroFont)?.family;
  // The Omni fonts only do left-to-right, so right-to-left lines stay with HieroJax; so do
  // vertical lines in Safari, whose text engine garbles the Omni fonts' vertical layout.
  if (omniFamily && direction.endsWith('lr') && !(IS_SAFARI && direction.startsWith('v'))) {
    return <OmniGlyphs unicode={unicode} fontsize={fontsize} family={omniFamily} direction={direction} />;
  }
  return <HieroGlyphs unicode={unicode} fontsize={fontsize} direction={direction} />;
}

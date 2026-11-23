import { Fragment, forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  /** Lines dragged by their number: move them (the dragged line, or all selected lines with it) before line `at`. */
  onReorder: (ids: string[], at: number) => void;
  /** The current line edited in place when it is Latin text (plain, bold or italic). */
  textEditorRef: React.RefObject<HTMLTextAreaElement | null>;
  onTextChange: (value: string) => void;
  onTextKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}

/** Lines whose text is edited in place in the main window (the text shown is the text typed). */
export const EDIT_IN_PLACE = new Set(['latin', 'bold', 'italic']);

/** Pointer travel before pressing a line number becomes a drag. */
const DRAG_THRESHOLD = 4;

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
    glyphCursor, onItemDown, onItemEnter, onGapDown, onReorder, textEditorRef, onTextChange, onTextKeyDown, onTextPaste },
  ref,
) {
  const activeRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Dragging lines by their number: which lines, and where they would go (before line `at`).
  const [drag, setDragState] = useState<{ ids: Set<string>; at: number } | null>(null);
  const dragRef = useRef(drag);
  const setDrag = (d: typeof drag) => {
    dragRef.current = d;
    setDragState(d);
  };
  const press = useRef<{ index: number; y: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  /** Where dropping at height `y` puts the lines: before the first line whose middle is below it. */
  const dropIndex = (y: number) => {
    const els = [...(boxRef.current?.querySelectorAll<HTMLElement>(':scope > [data-line-id]') ?? [])];
    const k = els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return k < 0 ? els.length : k;
  };

  /** Scrolls the main window while dragging near its top or bottom edge. */
  const autoScroll = (y: number) => {
    const scroller = boxRef.current?.closest('.editor-center');
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    if (y < r.top + 40) scroller.scrollBy(0, -20);
    else if (y > r.bottom - 40) scroller.scrollBy(0, 20);
  };

  const dragHandlers = (i: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      press.current = { index: i, y: e.clientY, moved: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p) return;
      if (!p.moved && Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return;
      if (!p.moved) {
        p.moved = true;
        document.getSelection()?.removeAllRanges();
      }
      const id = lines[p.index].id;
      // A selected line takes the other selected lines along.
      const ids = selectedIds.has(id) && selectedIds.size > 1 ? new Set(selectedIds) : new Set([id]);
      autoScroll(e.clientY);
      setDrag({ ids, at: dropIndex(e.clientY) });
    },
    onPointerUp: () => {
      const p = press.current;
      press.current = null;
      if (!p?.moved) return;
      justDragged.current = true;
      const d = dragRef.current;
      setDrag(null);
      if (d) onReorder([...d.ids], d.at);
    },
    onPointerCancel: () => {
      press.current = null;
      setDrag(null);
    },
  });

  return (
    <div className={`display-box${drag ? ' dragging-lines' : ''}`} role="list"
      ref={(el) => {
        boxRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}>
      {lines.map((line, i) => {
        const active = i === activeIndex;
        const selected = selectedIds.has(line.id);
        const stale = line.mode === 'hiero' && line.result !== undefined && !line.result.ok;
        const classes = ['display-line', `mode-${line.mode}`];
        if (active) classes.push('active');
        if (selected) classes.push('selected');
        if (stale) classes.push('stale');
        if (matchIds?.has(line.id)) classes.push('search-match');
        if (drag?.ids.has(line.id)) classes.push('dragging');
        if (drag && drag.at === i) classes.push('drop-before');
        if (drag && drag.at === lines.length && i === lines.length - 1) classes.push('drop-after');
        // Right-to-left hieroglyphic lines are set flush right, as in JSesh.
        if (line.mode === 'hiero' && line.direction?.endsWith('rl')) classes.push('rtl');
        return (
          <div
            key={line.id}
            ref={active ? activeRef : undefined}
            role="listitem"
            data-line-id={line.id}
            className={classes.join(' ')}
            onClick={(e) => {
              if (justDragged.current) {
                justDragged.current = false;
                return;
              }
              onLineClick(i, e);
            }}
            // On a Mac, Ctrl-click opens the context menu instead of clicking: it selects lines too.
            onContextMenu={(e) => {
              if (!e.ctrlKey) return;
              e.preventDefault();
              onLineClick(i, e);
            }}
          >
            <span className="line-number" {...dragHandlers(i)}
              title={stale ? `Cannot be rendered: ${line.result?.error}` : 'Drag to move the line (with the other selected lines)'}>
              {i + 1}
            </span>
            <div className="line-content">
              {active && EDIT_IN_PLACE.has(line.mode) ? (
                <TextEditor line={line} fontsize={line.fontsize ?? fontsize} editorRef={textEditorRef}
                  onChange={onTextChange} onKeyDown={onTextKeyDown} onPaste={onTextPaste} />
              ) : (
                <LineContent line={line} fontsize={line.fontsize ?? fontsize} hieroFont={hieroFont}
                  highlight={matchIds?.has(line.id) ? highlight : ''}
                  glyphs={active ? { cursor: glyphCursor?.lineId === line.id ? glyphCursor : null, onItemDown, onItemEnter, onGapDown } : null} />
              )}
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

/** The current Latin line, edited where it is shown (the input bar edits the same text). */
function TextEditor({ line, fontsize, editorRef, onChange, onKeyDown, onPaste }: {
  line: Line; fontsize: number; editorRef: Props['textEditorRef'];
  onChange: Props['onTextChange']; onKeyDown: Props['onTextKeyDown']; onPaste: Props['onTextPaste'];
}) {
  // As tall as its text, so long lines wrap as they do when not being edited.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
  }, [line.source, fontsize, editorRef]);
  return (
    <textarea ref={editorRef} className={`text-line text-${line.mode} inline-text-editor`} rows={1}
      style={{ fontSize: fontsize * TEXT_SCALE }} value={line.source} spellCheck
      aria-label="Line text" onChange={(e) => onChange(e.target.value.replace(/\r?\n/g, ' '))}
      onKeyDown={onKeyDown} onPaste={onPaste} onClick={(e) => e.stopPropagation()} />
  );
}

/**
 * Offset of the character at (x, y) in the text of `container` (where the click is in a text
 * line), or null if the point is not in its text.
 */
export function textOffsetAt(container: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const range = document.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || !container.contains(node)) return null;
  // Text before the point, across the pieces the text is split into (search marks).
  let total = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t === node) return total + offset;
    total += t.textContent?.length ?? 0;
  }
  return null;
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
  // Ctrl/Cmd-clicks select whole lines: those are left to the line.
  const lineClick = (e: React.MouseEvent | React.PointerEvent) => e.metaKey || e.ctrlKey;
  const gap = (at: number) => (
    <span className={`glyph-gap${caret === at ? ' caret' : ''}`} title="Paste here (⌘V)"
      onPointerDown={(e) => { if (lineClick(e)) return; stop(e); onGapDown(at); }}
      onMouseDown={(e) => { if (!lineClick(e)) keepFocus(e); }} onClick={(e) => { if (!lineClick(e)) stop(e); }} />
  );
  return (
    <span className={`ref-line ref-line-${direction} glyph-items`}>
      {items.map((item, k) => (
        <Fragment key={k}>
          {gap(k)}
          <span className={`glyph-item${k >= from && k <= to ? ' selected' : ''}`}
            onPointerDown={(e) => { if (lineClick(e)) return; stop(e); onItemDown(k, e.shiftKey); }}
            onMouseDown={(e) => { if (!lineClick(e)) keepFocus(e); }}
            onPointerEnter={(e) => { if (e.buttons & 1) onItemEnter(k); }} onClick={(e) => { if (!lineClick(e)) stop(e); }}>
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

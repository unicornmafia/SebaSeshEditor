import { useEffect, useRef, useState } from 'react';
import { HIERO_FONTS, MODES, type ExportFormat, type Flow, type HieroFont, type Mode, type Orientation } from '../types';
import ModeIcon from './ModeIcon';
import { CAN_OPEN_WITH_PICKER, clearRecent, listRecent, type RecentFile } from '../files';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** How long Open must be held to list the recent files. */
const LONG_PRESS_MS = 500;

/** When a recent file was opened: a time today, else a date. */
function formatWhen(t: number): string {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const FONT_SIZES = [16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 128];

/** The next size up (delta 1) or down (delta -1) from `size` in FONT_SIZES. */
export function stepFontsize(size: number, delta: number): number {
  if (delta > 0) return FONT_SIZES.find((s) => s > size) ?? FONT_SIZES[FONT_SIZES.length - 1];
  return [...FONT_SIZES].reverse().find((s) => s < size) ?? FONT_SIZES[0];
}

const ORIENTATIONS: { value: Orientation; label: string; short: string; icon: string }[] = [
  { value: 'h', label: 'Horizontal', short: 'Hor', icon: 'fa-solid fa-arrows-left-right' },
  { value: 'v', label: 'Vertical', short: 'Vert', icon: 'fa-solid fa-arrows-up-down' },
];

const FLOWS: { value: Flow; label: string; title: string; icon: string }[] = [
  { value: 'lr', label: 'L→R', title: 'Left to right', icon: 'fa-solid fa-arrow-right-long' },
  { value: 'rl', label: 'R→L', title: 'Right to left', icon: 'fa-solid fa-arrow-left-long' },
];

/** Direction of the hieroglyphic line(s) the direction buttons act on; null parts are mixed. */
export interface DirectionState {
  orientation: Orientation | null;
  flow: Flow | null;
  /** No hieroglyphic line to act on (the buttons are then hidden). */
  disabled: boolean;
}

const EXPORTS: { format: ExportFormat; label: string; icon: string }[] = [
  { format: 'gly', label: 'JSesh document (.gly)', icon: 'fa-solid fa-file-code' },
  { format: 'mdc', label: 'Manuel de Codage (.mdc)', icon: 'fa-solid fa-file-lines' },
  { format: 'res', label: 'RES (.res)', icon: 'fa-solid fa-file-lines' },
  { format: 'unicode', label: 'Unicode text (.txt)', icon: 'fa-solid fa-file-word' },
  { format: 'pdf', label: 'PDF', icon: 'fa-solid fa-file-pdf' },
  { format: 'svg', label: 'SVG image', icon: 'fa-solid fa-file-image' },
];

interface Props {
  mode: Mode;
  /** Size shown in the control: of the selected lines, or the document; null when the selection is mixed. */
  fontsize: number | null;
  /** Number of selected lines; 0 means font size and direction apply to the current line. */
  selectionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  direction: DirectionState;
  hieroFont: HieroFont;
  /** Whether the glyph font and orientation/direction controls are expanded. */
  hieroOptionsOpen: boolean;
  busy: boolean;
  onMode: (mode: Mode) => void;
  onFontsize: (size: number) => void;
  /** Steps the size of each target line up (+1) or down (-1) through FONT_SIZES. */
  onFontsizeStep: (delta: number) => void;
  onClearSelection: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOrientation: (o: Orientation) => void;
  onHieroFont: (font: HieroFont) => void;
  onToggleHieroOptions: () => void;
  onFlow: (f: Flow) => void;
  onNew: () => void;
  onImport: (file: File) => void;
  /** Opens a file through the browser's picker (only where CAN_OPEN_WITH_PICKER). */
  onOpenPicker: () => void;
  onOpenRecent: (entry: RecentFile) => void;
  onExport: (format: ExportFormat) => void;
  onPrint: () => void;
  onSave: () => void;
}

export default function Toolbar({
  mode, fontsize, selectionCount, canUndo, canRedo, direction, hieroFont, hieroOptionsOpen, busy,
  onMode, onFontsize, onFontsizeStep, onClearSelection, onUndo, onRedo, onOrientation, onFlow, onHieroFont, onToggleHieroOptions,
  onNew, onImport, onOpenPicker, onOpenRecent, onExport, onPrint, onSave,
}: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<RecentFile[] | null>(null); // shown while not null
  const recentRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  const showRecent = () => {
    listRecent().then(setRecent);
  };
  const open = () => {
    if (CAN_OPEN_WITH_PICKER) onOpenPicker();
    else fileRef.current?.click();
  };
  // A long press (or right click) on Open lists the recent files; a click opens a file.
  const pressStart = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    longPressed.current = false;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      showRecent();
    }, LONG_PRESS_MS);
  };
  const pressEnd = () => window.clearTimeout(pressTimer.current);

  useEffect(() => {
    if (!recent) return;
    const close = (e: MouseEvent) => {
      if (!recentRef.current?.contains(e.target as Node)) setRecent(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRecent(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [recent]);

  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportOpen]);

  return (
    <div className="editor-toolbar">
      <div className="toolbar-actions">
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onNew} title="New document">
          <i className="fa-solid fa-file" /><span className="ms-1 d-none d-xl-inline">New</span>
        </button>
        <div className="dropdown" ref={recentRef}>
          <button type="button" className="btn btn-sm btn-outline-secondary open-button" disabled={busy}
            title="Open a JSesh .gly, MdC, RES or Unicode text file (hold for recent files)"
            onPointerDown={pressStart} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd}
            onContextMenu={(e) => { e.preventDefault(); pressEnd(); showRecent(); }}
            onClick={() => {
              if (longPressed.current) longPressed.current = false; // the press opened the list
              else open();
            }}>
            <i className="fa-solid fa-folder-open" /><span className="ms-1 d-none d-xl-inline">Open</span>
          </button>
          <ul className={`dropdown-menu recent-menu${recent ? ' show' : ''}`} data-bs-popper="static">
            <li><h6 className="dropdown-header">Recent files</h6></li>
            {recent?.length === 0 && <li><span className="dropdown-item-text text-secondary">No recent files</span></li>}
            {recent?.map((r) => (
              <li key={r.name}>
                <button type="button" className="dropdown-item" title={r.name}
                  onClick={() => { setRecent(null); onOpenRecent(r); }}>
                  <i className="fa-regular fa-file-lines me-2 text-secondary" />
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-when">{formatWhen(r.opened)}</span>
                </button>
              </li>
            ))}
            {!!recent?.length && (
              <>
                <li><hr className="dropdown-divider" /></li>
                <li>
                  <button type="button" className="dropdown-item text-secondary"
                    onClick={() => { clearRecent(); setRecent(null); }}>
                    <i className="fa-solid fa-eraser me-2" />Clear list
                  </button>
                </li>
              </>
            )}
          </ul>
        </div>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onSave} disabled={busy}
          title={`Save as JSesh .gly (${MOD}S)`} aria-label="Save">
          <i className="fa-solid fa-floppy-disk" /><span className="ms-1 d-none d-xl-inline">Save</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          className="d-none"
          accept=".gly,.mdc,.res,.txt,.uni,text/plain"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onImport(file);
          }}
        />
        <div className="dropdown" ref={exportRef}>
          <button type="button" className="btn btn-sm search-submit dropdown-toggle" disabled={busy}
            aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)} title="Export" aria-label="Export">
            <i className={busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-file-export'} />
            <span className="ms-1 label-text">Export</span>
          </button>
          {/* data-bs-popper activates Bootstrap's static positioning (normally set by its JS, which we don't load) */}
          <ul className={`dropdown-menu${exportOpen ? ' show' : ''}`} data-bs-popper="static">
            {EXPORTS.map((e) => (
              <li key={e.format}>
                <button type="button" className="dropdown-item" onClick={() => { setExportOpen(false); onExport(e.format); }}>
                  <i className={`${e.icon} me-2 text-secondary`} />{e.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onPrint} disabled={busy}
          title={`Print (${MOD}P)`} aria-label="Print">
          <i className="fa-solid fa-print" /><span className="ms-1 d-none d-xl-inline">Print</span>
        </button>
      </div>

      <div className="btn-group btn-group-sm" role="group" aria-label="Undo and redo">
        <button type="button" className="btn btn-outline-secondary" onMouseDown={(e) => e.preventDefault()}
          onClick={onUndo} disabled={!canUndo} title={`Undo (${MOD}Z)`} aria-label="Undo">
          <i className="fa-solid fa-rotate-left" />
        </button>
        <button type="button" className="btn btn-outline-secondary" onMouseDown={(e) => e.preventDefault()}
          onClick={onRedo} disabled={!canRedo} title={`Redo (${MOD}⇧Z)`} aria-label="Redo">
          <i className="fa-solid fa-rotate-right" />
        </button>
      </div>

      <div className="btn-group" role="group" aria-label="Line type">
        {MODES.map((m) => (
          <span key={m.mode} className="d-contents">
            <input
              type="radio"
              className="btn-check"
              name="mode"
              id={`mode-${m.mode}`}
              checked={mode === m.mode}
              onChange={() => onMode(m.mode)}
            />
            <label className="btn btn-outline-primary search_config" htmlFor={`mode-${m.mode}`} title={`${m.label} line`}
              onMouseDown={(e) => e.preventDefault() /* keep focus in the input line */}>
              <ModeIcon mode={m} className="me-1" />
              <span className="label-full">{m.label}</span>
              <span className="label-short">{m.short}</span>
            </label>
          </span>
        ))}
      </div>

      {/* Layout toggle: font size (any line) plus, for hieroglyphic lines (the current line, or a
          selection that includes some), glyph font, orientation and direction. */}
      <button
        type="button"
        className={`btn btn-sm hiero-options-toggle${hieroOptionsOpen ? ' open' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleHieroOptions}
        aria-expanded={hieroOptionsOpen}
        aria-label="Size and layout"
        title={hieroOptionsOpen ? 'Hide size and layout controls' : 'Show size and layout controls'}
      >
        <i className="fa-solid fa-sliders" />
        <span className="ms-1 label-text">Layout</span>
        <i className={`fa-solid ${hieroOptionsOpen ? 'fa-chevron-left' : 'fa-chevron-right'} ms-1 toggle-chevron`} />
        {/* Marks a line set to something other than horizontal left-to-right while collapsed. */}
        {!hieroOptionsOpen && !direction.disabled && (direction.orientation !== 'h' || direction.flow !== 'lr') && (
          <span className="hiero-options-dot" aria-hidden="true" />
        )}
      </button>
      {hieroOptionsOpen && (
        <div className="input-group input-group-sm fontsize-group"
          title={selectionCount ? `Font size of the ${selectionCount} selected line${selectionCount === 1 ? '' : 's'}` : 'Font size of the current line'}>
          <button type="button" className="btn btn-outline-secondary" onMouseDown={(e) => e.preventDefault()} onClick={() => onFontsizeStep(-1)} aria-label="Smaller">
            <i className="fa-solid fa-minus" />
          </button>
          <span className="input-group-text"><i className="fa-solid fa-text-height" /></span>
          <select className="form-select" value={fontsize ?? ''} onChange={(e) => onFontsize(Number(e.target.value))} aria-label="Font size">
            {fontsize === null && <option value="" disabled>mixed</option>}
            {fontsize !== null && !FONT_SIZES.includes(fontsize) && <option value={fontsize}>{fontsize}px</option>}
            {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
          </select>
          <button type="button" className="btn btn-outline-secondary" onMouseDown={(e) => e.preventDefault()} onClick={() => onFontsizeStep(1)} aria-label="Larger">
            <i className="fa-solid fa-plus" />
          </button>
        </div>
      )}
      {!direction.disabled && hieroOptionsOpen && (
        <>
          <div className="input-group input-group-sm glyphfont-group"
            title="Hieroglyph font for the main window (PDF/SVG export always uses NewGardiner)">
            <span className="input-group-text glyphfont-icon" aria-hidden="true">{'\u{13000}'}</span>
            <select className="form-select" value={hieroFont} aria-label="Hieroglyph font"
              onChange={(e) => onHieroFont(e.target.value as HieroFont)}>
              {HIERO_FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>

          <div className="btn-group" role="group" aria-label="Orientation of hieroglyphic lines">
            {ORIENTATIONS.map((o) => (
              <span key={o.value} className="d-contents">
                <input type="radio" className="btn-check" name="orientation" id={`orientation-${o.value}`}
                  checked={direction.orientation === o.value}
                  onChange={() => onOrientation(o.value)} />
                <label className="btn btn-outline-primary search_config" htmlFor={`orientation-${o.value}`}
                  title={`${o.label} hieroglyphic line${selectionCount ? 's (selected)' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}>
                  <i className={`${o.icon} me-1`} />
                  <span className="label-full">{o.label}</span>
                  <span className="label-short">{o.short}</span>
                </label>
              </span>
            ))}
          </div>

          <div className="btn-group" role="group" aria-label="Direction of hieroglyphic lines">
            {FLOWS.map((f) => (
              <span key={f.value} className="d-contents">
                <input type="radio" className="btn-check" name="flow" id={`flow-${f.value}`}
                  checked={direction.flow === f.value}
                  onChange={() => onFlow(f.value)} />
                <label className="btn btn-outline-primary search_config" htmlFor={`flow-${f.value}`}
                  title={`${f.title}${selectionCount ? ' (selected hieroglyphic lines)' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}>
                  <i className={`${f.icon} me-1`} /><span className="label-text">{f.label}</span>
                </label>
              </span>
            ))}
          </div>
        </>
      )}

      {selectionCount > 0 && (
        <span className="selection-chip" role="status">
          <i className="fa-solid fa-i-cursor me-1" />
          {selectionCount} line{selectionCount === 1 ? '' : 's'} selected
          <button type="button" className="btn-close btn-close-white ms-2" aria-label="Clear selection"
            title="Clear selection (Esc): font size and direction then apply to the current line" onClick={onClearSelection} />
        </span>
      )}

    </div>
  );
}

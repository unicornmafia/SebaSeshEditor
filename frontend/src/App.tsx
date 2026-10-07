import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as api from './api';
import DisplayBox from './components/DisplayBox';
import ImportDialog from './components/ImportDialog';
import InputBar from './components/InputBar';
import Notices, { type Notice } from './components/Notices';
import Sidebar from './components/Sidebar';
import LoadingOverlay from './components/LoadingOverlay';
import Toolbar, { stepFontsize } from './components/Toolbar';
import { useUndoHistory, type EditKind, type Snapshot } from './history';
import {
  flowOf, HIERO_FONTS, makeDirection, orientationOf,
  type Direction, type HieroFont, type ExportFormat, type Flow, type Line, type Mode, type Orientation, type RenderResult, type StoredDocument,
} from './types';

const STORAGE_KEY = 'sebasesh.document.v1';
const SIDEBAR_KEY = 'sebasesh.sidebarOpen';
const HIERO_FONT_KEY = 'sebasesh.hieroFont';
const DEFAULT_FONTSIZE = 48;
const EMPTY_RESULT: RenderResult = { ok: true, error: '', warnings: [], unicode: '', sourceFormat: 'empty' };

let nextId = 0;
const newId = () => `line-${++nextId}`;
const makeLine = (mode: Mode = 'hiero', source = '', fontsize?: number, direction?: Direction): Line => ({
  id: newId(), mode, source, fontsize, direction: direction === 'hlr' ? undefined : direction,
});

function loadStored(): StoredDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as StoredDocument;
    return Array.isArray(doc.lines) && doc.lines.length > 0 ? doc : null;
  } catch {
    return null;
  }
}

function saveStored(doc: StoredDocument) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // Storage may be unavailable (private mode, quota); the document still works in memory.
  }
}

function initialState(): { lines: Line[]; fontsize: number } {
  const stored = loadStored();
  if (!stored) return { lines: [makeLine()], fontsize: DEFAULT_FONTSIZE };
  return {
    lines: stored.lines.map((l) => makeLine(l.mode, l.source, l.fontsize, l.direction)),
    fontsize: stored.fontsize || DEFAULT_FONTSIZE,
  };
}

function loadHieroFont(): HieroFont {
  try {
    const value = localStorage.getItem(HIERO_FONT_KEY);
    return HIERO_FONTS.some((f) => f.value === value) ? (value as HieroFont) : 'newgardiner';
  } catch {
    return 'newgardiner';
  }
}

function loadSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false';
  } catch {
    return true;
  }
}

const toStored = (lines: Line[], fontsize: number): StoredDocument => ({
  fontsize,
  lines: lines.map(({ mode, source, fontsize: size, direction }) => ({
    mode,
    source,
    ...(size ? { fontsize: size } : {}),
    ...(direction && direction !== 'hlr' ? { direction } : {}),
  })),
});

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Resolves once HieroJax has drawn every hieroglyphic line in the main window. HieroJax may
 * draw asynchronously (it first waits for its font); it replaces an element's text with its
 * drawing, so an element that still holds only text has not been drawn yet. Gives up after
 * `timeoutMs` so a line HieroJax cannot draw never leaves the spinner up.
 */
async function waitForHieroglyphs(root: () => HTMLElement | null, timeoutMs = 60_000): Promise<void> {
  // Fonts still downloading (e.g. a newly chosen Omni font) must arrive first.
  await document.fonts.ready;
  const started = performance.now();
  const undrawn = () => [...(root()?.querySelectorAll<HTMLElement>('.hiero-host > .hierojax') ?? [])]
    .some((el) => el.firstElementChild === null && el.textContent !== '');
  return new Promise((resolve) => {
    const check = () => {
      if (!undrawn() || performance.now() - started > timeoutMs) {
        // A short delay (not requestAnimationFrame, which never fires in a background tab)
        // so the drawn lines are painted before the spinner goes.
        setTimeout(resolve, 16);
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function App() {
  const [initial] = useState(initialState);
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [fontsize, setFontsize] = useState(initial.fontsize);
  const [activeIndex, setActiveIndex] = useState(initial.lines.length - 1);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /** Message of the loading spinner over the main window, or null when hidden. */
  const [loading, setLoading] = useState<string | null>(() =>
    // Shown from the first paint when a saved document has hieroglyphs to draw.
    initial.lines.some((l) => l.mode === 'hiero' && l.source.trim()) ? 'Loading document…' : null);
  // Each time the spinner is shown it gets a new ticket; whatever finishes that load hides it
  // only if no newer load has replaced it.
  const loadingTicket = useRef(0);
  // Ticket of a load whose batch results have been applied: the spinner is hidden once the
  // render that draws them with HieroJax has been committed and every line is drawn.
  const hideAfterRender = useRef<number | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [importing, setImporting] = useState<{ filename: string; result: api.ImportResult } | null>(null);
  // Lines selected in the main window; font size changes apply to these (or to everything when empty).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebarOpen);
  const [hieroFont, setHieroFont] = useState<HieroFont>(loadHieroFont);

  const inputRef = useRef<HTMLInputElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const history = useUndoHistory();
  const controllers = useRef(new Map<string, AbortController>());

  const active = lines[Math.min(activeIndex, lines.length - 1)];

  // ------------------------------------------------------------ notices

  const notify = useCallback((notice: Omit<Notice, 'id'>) => {
    const id = Date.now() + Math.random();
    setNotices((ns) => [...ns, { ...notice, id }]);
    if (notice.kind === 'success') setTimeout(() => setNotices((ns) => ns.filter((n) => n.id !== id)), 4000);
  }, []);

  // ------------------------------------------------------------ rendering

  /** Applies a server result to a line, unless the line has changed since the request. */
  const applyResult = useCallback((id: string, source: string, result: RenderResult) => {
    setLines((ls) => ls.map((l) =>
      l.id === id && l.source === source && l.mode === 'hiero'
        ? { ...l, result, rendered: result.ok ? result.unicode : l.rendered }
        : l));
  }, []);

  /** Interprets one hieroglyphic line on every keystroke; stale requests are aborted. */
  const renderOne = useCallback((id: string, source: string) => {
    controllers.current.get(id)?.abort();
    if (!source.trim()) {
      controllers.current.delete(id);
      setPending((p) => { const n = new Set(p); n.delete(id); return n; });
      applyResult(id, source, EMPTY_RESULT);
      return;
    }
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setPending((p) => new Set(p).add(id));
    api.renderLine(source, controller.signal)
      .then((result) => applyResult(id, source, result))
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') {
          applyResult(id, source, { ...EMPTY_RESULT, ok: false, error: 'Server unavailable' });
        }
      })
      .finally(() => {
        if (controllers.current.get(id) === controller) {
          controllers.current.delete(id);
          setPending((p) => { const n = new Set(p); n.delete(id); return n; });
        }
      });
  }, [applyResult]);

  /** Shows the spinner; returns its ticket. */
  const showLoading = useCallback((message: string) => {
    setLoading(message);
    return ++loadingTicket.current;
  }, []);

  /** Hides the spinner if it still belongs to `ticket`. */
  const hideLoading = useCallback((ticket: number) => {
    if (loadingTicket.current === ticket) setLoading(null);
  }, []);

  /**
   * Interprets many lines at once (after loading or importing a document). With `message`,
   * the loading spinner is shown until the lines have been drawn.
   */
  const renderMany = useCallback((targets: Line[], message?: string) => {
    const ticket = message ? showLoading(message) : null;
    const hiero = targets.filter((l) => l.mode === 'hiero' && l.source.trim());
    if (hiero.length === 0) {
      if (ticket !== null) hideLoading(ticket);
      return;
    }
    api.renderBatch(hiero.map((l) => l.source))
      .then((results) => {
        const byId = new Map(hiero.map((l, i) => [l.id, { source: l.source, result: results[i] }]));
        // One state update for all lines (one per line would re-render the document each time).
        setLines((ls) => ls.map((l) => {
          const r = byId.get(l.id);
          return r && l.source === r.source && l.mode === 'hiero'
            ? { ...l, result: r.result, rendered: r.result.ok ? r.result.unicode : l.rendered }
            : l;
        }));
        // Only the current load may schedule hiding; a superseded load's results arriving
        // later must not overwrite the current load's pending ticket.
        if (ticket !== null && ticket === loadingTicket.current) hideAfterRender.current = ticket;
      })
      .catch(() => {
        notify({ kind: 'danger', title: 'Could not reach the rendering server' });
        if (ticket !== null) hideLoading(ticket);
      });
  }, [notify, showLoading, hideLoading]);

  useEffect(() => {
    const ticket = hideAfterRender.current;
    if (ticket === null) return;
    hideAfterRender.current = null;
    // Not cancelled when the lines change again (typing, a line's result arriving): the ticket
    // decides whether this spinner is still the current one.
    waitForHieroglyphs(() => displayRef.current).then(() => hideLoading(ticket));
  }, [lines, hideLoading]);

  useEffect(() => {
    renderMany(initial.lines, 'Loading document…');
  }, [initial, renderMany]);

  useEffect(() => {
    saveStored(toStored(lines, fontsize));
  }, [lines, fontsize]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen));
    } catch {
      // not essential
    }
  }, [sidebarOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(HIERO_FONT_KEY, hieroFont);
    } catch {
      // not essential
    }
  }, [hieroFont]);

  // ------------------------------------------------------------ selection

  /*
   * Text selected with the mouse (or shift-click) in the main window selects the lines it touches.
   * The selection is kept in state, so it survives the browser clearing its highlight when the
   * font-size control takes focus; it is cleared explicitly (click on a line, Esc, typing).
   */
  useEffect(() => {
    const onSelectionChange = () => {
      const box = displayRef.current;
      const sel = document.getSelection();
      if (!box || !sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!box.contains(range.commonAncestorContainer)) return;
      const ids = new Set(
        [...box.querySelectorAll<HTMLElement>('[data-line-id]')]
          .filter((el) => range.intersectsNode(el))
          .map((el) => el.dataset.lineId!),
      );
      setSelectedIds((prev) => (sameSet(prev, ids) ? prev : ids));
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const clearSelection = () => {
    setSelectedIds((prev) => (prev.size ? new Set() : prev));
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed && displayRef.current?.contains(sel.anchorNode)) sel.removeAllRanges();
  };

  const selectedLines = lines.filter((l) => selectedIds.has(l.id));

  /** Lines the font size control acts on: the selected ones, else the current line (like direction). */
  const fontsizeTargets = selectedLines.length > 0 ? selectedLines : [active];

  /** Size shown in the toolbar: the target lines' common size, or null if they differ. */
  const shownFontsize = (() => {
    const sizes = new Set(fontsizeTargets.map((l) => l.fontsize ?? fontsize));
    return sizes.size === 1 ? [...sizes][0] : null;
  })();

  // ------------------------------------------------------------ undo / redo

  const snapshot = (): Snapshot => ({ lines, fontsize, activeIndex });
  /** Records the current state as an undo step; call before applying an edit. */
  const recordEdit = (kind: EditKind, lineId?: string) => history.record(snapshot(), kind, lineId);

  const restore = (snap: Snapshot) => {
    // Re-interpret hieroglyphic lines whose text differs from what is on screen now,
    // since a request for the text being replaced may still have been in flight.
    const current = new Map(lines.map((l) => [l.id, l]));
    const changed = snap.lines.filter((l) => {
      const c = current.get(l.id);
      return !c || c.source !== l.source || c.mode !== l.mode;
    });
    clearSelection();
    setLines(snap.lines);
    setFontsize(snap.fontsize);
    setActiveIndex(Math.min(snap.activeIndex, snap.lines.length - 1));
    renderMany(changed);
    focusInput();
  };

  const undo = () => {
    const snap = history.undo(snapshot());
    if (snap) restore(snap);
  };

  const redo = () => {
    const snap = history.redo(snapshot());
    if (snap) restore(snap);
  };

  // Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z or Ctrl+Y redoes, wherever the focus is
  // (this also replaces the input's native undo, which cannot follow React updates).
  const undoRedoRef = useRef({ undo, redo });
  undoRedoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRedoRef.current.undo();
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.metaKey)) {
        e.preventDefault();
        undoRedoRef.current.redo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const changeFontsize = (size: number) => {
    if (size === shownFontsize) return;
    const ids = new Set(fontsizeTargets.map((l) => l.id));
    recordEdit('fontsize');
    setLines((ls) => ls.map((l) => (ids.has(l.id) ? { ...l, fontsize: size } : l)));
  };

  /** +/−: each target line moves one size step from its own size (keeps differences between lines). */
  const stepTargetsFontsize = (delta: number) => {
    const next = new Map(fontsizeTargets.map((l) => [l.id, stepFontsize(l.fontsize ?? fontsize, delta)]));
    if (fontsizeTargets.every((l) => next.get(l.id) === (l.fontsize ?? fontsize))) return; // at the limit
    recordEdit('fontsize');
    setLines((ls) => ls.map((l) => (next.has(l.id) ? { ...l, fontsize: next.get(l.id) } : l)));
  };

  // ------------------------------------------------------------ writing direction

  /** Hieroglyphic lines the direction buttons act on: the selected ones, else the current line. */
  const directionTargets = (selectedLines.length > 0 ? selectedLines : [active]).filter((l) => l.mode === 'hiero');

  const directionState = (() => {
    const dirs = directionTargets.map((l) => l.direction ?? 'hlr');
    const common = <T,>(values: T[]) => (values.length > 0 && values.every((v) => v === values[0]) ? values[0] : null);
    return {
      orientation: common(dirs.map(orientationOf)),
      flow: common(dirs.map(flowOf)),
      disabled: directionTargets.length === 0,
    };
  })();

  const changeDirection = (orientation?: Orientation, flow?: Flow) => {
    if (directionTargets.length === 0) return;
    const ids = new Set(directionTargets.map((l) => l.id));
    recordEdit('direction');
    setLines((ls) => ls.map((l) => {
      if (!ids.has(l.id)) return l;
      const current = l.direction ?? 'hlr';
      const next = makeDirection(orientation ?? orientationOf(current), flow ?? flowOf(current));
      return { ...l, direction: next === 'hlr' ? undefined : next };
    }));
    focusInput('keep');
  };

  // Where the mouse went down in the main window, to tell a click from a drag-selection.
  const mouseDownAt = useRef<{ x: number; y: number } | null>(null);

  const onLineClick = (index: number, e: React.MouseEvent) => {
    const down = mouseDownAt.current;
    const dragged = down !== null && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
    if (dragged || e.shiftKey || e.detail > 1) {
      return; // selecting text (drag, shift-click, double/triple-click), not choosing a line to edit
    }
    const id = lines[index].id;
    if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl-click adds or removes a line from the selection.
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    clearSelection();
    setActiveIndex(index);
    focusInput();
  };

  // ------------------------------------------------------------ editing

  // Caret to restore in the input line once React has committed the next render
  // (a controlled input moves its caret to the end when its value is replaced).
  const pendingCaret = useRef<number | 'end' | 'keep' | null>(null);
  const [caretTick, setCaretTick] = useState(0);

  /** Focuses the input line, placing the caret at `caret`, at the end, or ('keep') where it was. */
  const focusInput = (caret?: number | 'keep') => {
    pendingCaret.current = caret ?? 'end';
    setCaretTick((t) => t + 1);
  };

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || pendingCaret.current === null) return;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    el.focus();
    if (caret === 'keep') return; // an input keeps its selection while blurred
    const pos = caret === 'end' ? el.value.length : caret;
    el.setSelectionRange(pos, pos);
  }, [caretTick]);

  useEffect(() => {
    focusInput();
  }, [activeIndex]);

  const setSource = (value: string, kind: EditKind = 'type') => {
    const line = active;
    if (value === line.source) return;
    recordEdit(kind, line.id);
    clearSelection();
    setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, source: value } : l)));
    if (line.mode === 'hiero') renderOne(line.id, value);
  };

  const setMode = (mode: Mode) => {
    const line = active;
    if (mode === line.mode) return;
    recordEdit('mode', line.id);
    setLines((ls) => ls.map((l) =>
      l.id === line.id ? { ...l, mode, result: undefined, rendered: mode === 'hiero' ? l.rendered : undefined } : l));
    if (mode === 'hiero') renderOne(line.id, line.source);
    focusInput();
  };

  const insertAtCaret = (text: string) => {
    const el = inputRef.current;
    const value = active.source;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setSource(value.slice(0, start) + text + value.slice(end), 'insert');
    focusInput(start + text.length);
  };

  const newLineAfter = (index: number) => {
    // The new line continues the current line's type, size and direction.
    const { mode = 'hiero', fontsize: size, direction } = lines[index] ?? {};
    recordEdit('newline');
    setLines((ls) => [...ls.slice(0, index + 1), makeLine(mode, '', size, direction), ...ls.slice(index + 1)]);
    setActiveIndex(index + 1);
  };

  const deleteLine = (index: number) => {
    if (lines.length <= 1) return;
    recordEdit('delete');
    controllers.current.get(lines[index].id)?.abort();
    setLines((ls) => ls.filter((_, i) => i !== index));
    setActiveIndex((a) => (a > index ? a - 1 : a === index ? Math.max(0, index - 1) : a));
  };

  const moveLine = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= lines.length) return;
    recordEdit('move');
    setLines((ls) => {
      const copy = [...ls];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
    setActiveIndex((a) => (a === index ? target : a === target ? index : a));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      newLineAfter(activeIndex);
    } else if (e.key === 'Escape') {
      clearSelection();
    } else if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Shift+↑/↓ extends the line selection from the current line.
      e.preventDefault();
      const target = activeIndex + (e.key === 'ArrowUp' ? -1 : 1);
      if (target < 0 || target >= lines.length) return;
      setSelectedIds((prev) => new Set(prev).add(lines[activeIndex].id).add(lines[target].id));
      setActiveIndex(target);
    } else if (e.key === 'ArrowUp' && activeIndex > 0) {
      e.preventDefault();
      setActiveIndex(activeIndex - 1);
    } else if (e.key === 'ArrowDown' && activeIndex < lines.length - 1) {
      e.preventDefault();
      setActiveIndex(activeIndex + 1);
    } else if (e.key === 'Backspace' && active.source === '' && lines.length > 1) {
      e.preventDefault();
      deleteLine(activeIndex);
    }
  };

  // ------------------------------------------------------------ documents

  const storedDocument = (): StoredDocument => toStored(lines, fontsize);

  const onNew = () => {
    const hasContent = lines.some((l) => l.source.trim());
    if (hasContent && !window.confirm('Start a new document? (You can get the current one back with Undo.)')) return;
    recordEdit('new');
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setPending(new Set());
    clearSelection();
    setLines([makeLine()]);
    setActiveIndex(0);
  };

  const onImport = async (file: File) => {
    setBusy(true);
    const ticket = showLoading(`Opening ${file.name}…`);
    try {
      const result = await api.importFile(file);
      if (result.lines.length === 0) {
        notify({ kind: 'warning', title: `No text found in ${file.name}`, details: result.warnings });
      } else {
        setImporting({ filename: file.name, result });
      }
    } catch (err) {
      notify({ kind: 'danger', title: `Could not open ${file.name}`, details: [(err as Error).message] });
    } finally {
      hideLoading(ticket); // the import dialog takes over; drawing the lines shows the spinner again
      setBusy(false);
    }
  };

  const finishImport = (replace: boolean) => {
    if (!importing) return;
    const imported = importing.result.lines.map((l) => makeLine(l.mode, l.source, undefined, l.direction));
    const onlyEmpty = lines.length === 1 && !lines[0].source.trim();
    recordEdit('import');
    if (replace || onlyEmpty) {
      controllers.current.forEach((c) => c.abort());
      controllers.current.clear();
      setPending(new Set());
      clearSelection();
      setLines(imported);
      setActiveIndex(0);
    } else {
      setLines((ls) => [...ls, ...imported]);
      setActiveIndex(lines.length);
    }
    const count = imported.filter((l) => l.mode === 'hiero').length;
    renderMany(imported, `Rendering ${count.toLocaleString()} hieroglyphic line${count === 1 ? '' : 's'}…`);
    notify({ kind: 'success', title: `Opened ${importing.filename} (${imported.length} lines)` });
    setImporting(null);
  };

  const onExport = async (format: ExportFormat) => {
    setBusy(true);
    try {
      const result = await api.exportDocument(format, storedDocument(), 'sebasesh');
      download(result.blob, result.filename);
      if (result.warnings.length > 0) {
        notify({ kind: 'warning', title: `Exported ${result.filename} with notes`, details: result.warnings });
      } else {
        notify({ kind: 'success', title: `Exported ${result.filename}` });
      }
    } catch (err) {
      notify({ kind: 'danger', title: 'Export failed', details: [(err as Error).message] });
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------ layout

  return (
    <div className="app-shell">
      <nav className="navbar navbar-dark fixed-top seba-navbar">
        <div className="container-fluid">
          <div className="navbar-home d-flex align-items-center">
            <span className="nav-home-btn" aria-hidden="true">{'\u{13080}'}</span>
            <span className="navbar-brand ms-2">Seba-Sesh Hieroglyphic Editor</span>
          </div>
        </div>
      </nav>

      <Toolbar
        mode={active.mode}
        fontsize={shownFontsize}
        selectionCount={selectedLines.length}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        direction={directionState}
        hieroFont={hieroFont}
        onHieroFont={(f) => {
          setHieroFont(f);
          const family = HIERO_FONTS.find((x) => x.value === f)?.family;
          if (family) {
            // An Omni font is a 5-6 MB download: show the spinner until it has arrived.
            const ticket = showLoading('Loading font…');
            document.fonts.load(`32px '${family}'`, '\u{13000}')
              .catch(() => notify({ kind: 'danger', title: `Could not load ${family}` }))
              .finally(() => hideLoading(ticket));
          }
          focusInput('keep');
        }}
        onOrientation={(o) => changeDirection(o, undefined)}
        onFlow={(f) => changeDirection(undefined, f)}
        busy={busy}
        onMode={setMode}
        onFontsize={(s) => { changeFontsize(s); focusInput('keep'); }}
        onFontsizeStep={(d) => { stepTargetsFontsize(d); focusInput('keep'); }}
        onClearSelection={() => { clearSelection(); focusInput(); }}
        onUndo={undo}
        onRedo={redo}
        onNew={onNew}
        onImport={onImport}
        onExport={onExport}
      />

      <div className="editor-main">
        <div className="drawer">
          {sidebarOpen && <Sidebar disabled={active.mode !== 'hiero'} onInsert={insertAtCaret} />}
          {/* Tab on the drawer's edge that opens/closes the control-character panel. */}
          <button type="button" className="drawer-handle" onMouseDown={(e) => e.preventDefault()}
            onClick={() => setSidebarOpen((o) => !o)} aria-expanded={sidebarOpen}
            title={sidebarOpen ? 'Hide control characters panel' : 'Show control characters panel'}
            aria-label={sidebarOpen ? 'Hide control characters panel' : 'Show control characters panel'}>
            <i className={`fa-solid ${sidebarOpen ? 'fa-angles-left' : 'fa-angles-right'}`} />
          </button>
        </div>
        <div className="editor-center-wrap">
          <main className="editor-center" onMouseDown={(e) => { mouseDownAt.current = { x: e.clientX, y: e.clientY }; }}>
            <DisplayBox
              ref={displayRef}
              lines={lines}
              activeIndex={activeIndex}
              selectedIds={selectedIds}
              fontsize={fontsize}
              hieroFont={hieroFont}
              onLineClick={onLineClick}
              onMove={moveLine}
              onDelete={deleteLine}
            />
          </main>
          {loading && <LoadingOverlay message={loading} />}
        </div>
      </div>

      <InputBar
        ref={inputRef}
        line={active}
        lineNumber={activeIndex + 1}
        pending={pending.has(active.id)}
        onChange={setSource}
        onKeyDown={onKeyDown}
        // Highlighting text in the input line selects that line, so font size (and
        // direction) changes apply to it rather than to the whole document.
        onSelectText={() => setSelectedIds((prev) =>
          prev.size === 1 && prev.has(active.id) ? prev : new Set([active.id]))}
        onCommit={() => newLineAfter(activeIndex)}
      />

      <Notices notices={notices} onDismiss={(id) => setNotices((ns) => ns.filter((n) => n.id !== id))} />

      {importing && (
        <ImportDialog
          filename={importing.filename}
          result={importing.result}
          onReplace={() => finishImport(true)}
          onAppend={() => finishImport(false)}
          onCancel={() => setImporting(null)}
        />
      )}
    </div>
  );
}

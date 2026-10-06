import { useCallback, useRef, useState } from 'react';
import type { Line } from './types';

/** Number of undo steps kept by default. */
export const DEFAULT_UNDO_LIMIT = 100;

/** Keystrokes in the same line closer together than this are undone as one step. */
const COALESCE_MS = 1000;

export interface Snapshot {
  lines: Line[];
  fontsize: number;
  activeIndex: number;
}

/** Kinds of edits; consecutive 'type' edits to the same line are merged into one undo step. */
export type EditKind = 'type' | 'insert' | 'mode' | 'newline' | 'delete' | 'move' | 'fontsize' | 'direction' | 'new' | 'import';

/**
 * Undo/redo of whole-document snapshots. Lines are immutable objects, so a snapshot
 * only copies the array, not the lines.
 */
export function useUndoHistory(limit = DEFAULT_UNDO_LIMIT) {
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const lastEdit = useRef<{ kind: EditKind; lineId?: string; time: number } | null>(null);
  const [, setVersion] = useState(0); // re-render so the buttons' enabled state follows the stacks
  const bump = () => setVersion((v) => v + 1);

  /** Call with the state *before* an edit is applied. */
  const record = useCallback((before: Snapshot, kind: EditKind, lineId?: string) => {
    const now = Date.now();
    const last = lastEdit.current;
    lastEdit.current = { kind, lineId, time: now };
    if (kind === 'type' && last?.kind === 'type' && last.lineId === lineId && now - last.time < COALESCE_MS) {
      return;
    }
    undoStack.current.push(before);
    if (undoStack.current.length > limit) undoStack.current.shift();
    redoStack.current = [];
    bump();
  }, [limit]);

  /** Returns the snapshot to restore, or null if there is nothing to undo. */
  const undo = useCallback((current: Snapshot): Snapshot | null => {
    const previous = undoStack.current.pop();
    if (!previous) return null;
    redoStack.current.push(current);
    lastEdit.current = null;
    bump();
    return previous;
  }, []);

  const redo = useCallback((current: Snapshot): Snapshot | null => {
    const next = redoStack.current.pop();
    if (!next) return null;
    undoStack.current.push(current);
    if (undoStack.current.length > limit) undoStack.current.shift();
    lastEdit.current = null;
    bump();
    return next;
  }, [limit]);

  return {
    record,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}

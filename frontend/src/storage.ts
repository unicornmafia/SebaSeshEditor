// Per-tab documents in browser storage.
//
// Each tab edits its own document: the document's id lives in sessionStorage (per tab, kept on
// reload), its content in localStorage under its own key. A new tab takes the most recently
// edited document that no other tab has open, or starts an empty one. Open tabs write a
// heartbeat per document so two tabs never edit the same one; a duplicated tab (which copies
// sessionStorage) therefore gets its own copy of the document.

import type { StoredDocument } from './types';

const LEGACY_KEY = 'sebasesh.document.v1';
const INDEX_KEY = 'sebasesh.documents.v2';
const DOC_PREFIX = 'sebasesh.doc.v2.';
const OPEN_PREFIX = 'sebasesh.open.';
const TAB_DOC_KEY = 'sebasesh.tabDocId';

const HEARTBEAT_MS = 5_000;
const STALE_MS = 15_000;
/** Documents kept in storage; older ones not open in any tab are removed. */
const MAX_DOCUMENTS = 20;

interface IndexEntry {
  id: string;
  modified: number;
  title: string;
}

/** Identifies this page load (not the tab: a reload is a new instance). */
const instanceId = Math.random().toString(36).slice(2) + Date.now().toString(36);

const newDocId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function get(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function set(storage: Storage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

function readIndex(): IndexEntry[] {
  try {
    const parsed = JSON.parse(get(localStorage, INDEX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadDoc(id: string): StoredDocument | null {
  try {
    const doc = JSON.parse(get(localStorage, DOC_PREFIX + id) ?? 'null') as StoredDocument | null;
    return doc && Array.isArray(doc.lines) ? doc : null;
  } catch {
    return null;
  }
}

/** True if another live tab has `id` open. */
function openElsewhere(id: string): boolean {
  try {
    const beat = JSON.parse(get(localStorage, OPEN_PREFIX + id) ?? 'null') as { instance: string; t: number } | null;
    return !!beat && beat.instance !== instanceId && Date.now() - beat.t < STALE_MS;
  } catch {
    return false;
  }
}

function titleOf(doc: StoredDocument): string {
  return doc.lines.find((l) => l.source.trim())?.source.trim().slice(0, 60) ?? '';
}

/** Moves the single pre-v2 document into the per-document scheme (once). */
function migrateLegacy() {
  const legacy = get(localStorage, LEGACY_KEY);
  if (legacy === null) return;
  try {
    const doc = JSON.parse(legacy) as StoredDocument;
    if (Array.isArray(doc.lines) && doc.lines.length > 0) {
      const id = newDocId();
      if (!set(localStorage, DOC_PREFIX + id, legacy)) return; // keep the legacy copy if this fails
      writeIndex([{ id, modified: Date.now(), title: titleOf(doc) }, ...readIndex()]);
    }
  } catch {
    // unreadable legacy data: drop it
  }
  remove(localStorage, LEGACY_KEY);
}

function writeIndex(entries: IndexEntry[]) {
  set(localStorage, INDEX_KEY, JSON.stringify(entries));
}

function heartbeat(id: string) {
  set(localStorage, OPEN_PREFIX + id, JSON.stringify({ instance: instanceId, t: Date.now() }));
}

/**
 * Picks this tab's document and starts announcing that it is open here.
 * Returns its id and saved content (null for a new, empty document).
 */
export function openTabDocument(): { id: string; doc: StoredDocument | null } {
  migrateLegacy();
  let id = get(sessionStorage, TAB_DOC_KEY);
  let doc = id ? loadDoc(id) : null;

  if (id && openElsewhere(id)) {
    // A duplicated tab: continue on a copy rather than fighting over the original.
    id = newDocId();
    if (doc) saveTabDocument(id, doc);
  } else if (!id) {
    const free = readIndex()
      .sort((a, b) => b.modified - a.modified)
      .find((e) => !openElsewhere(e.id) && loadDoc(e.id));
    id = free?.id ?? newDocId();
    doc = free ? loadDoc(free.id) : null;
  }

  set(sessionStorage, TAB_DOC_KEY, id);
  heartbeat(id);
  const docId = id;
  const timer = setInterval(() => heartbeat(docId), HEARTBEAT_MS);
  // Leaving or reloading the page releases the document at once (else it expires).
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    try {
      const beat = JSON.parse(get(localStorage, OPEN_PREFIX + docId) ?? 'null');
      if (beat?.instance === instanceId) remove(localStorage, OPEN_PREFIX + docId);
    } catch {
      // ignore
    }
  });
  return { id, doc };
}

/** Saves a tab's document; returns false if storage refused it (e.g. quota exceeded). */
export function saveTabDocument(id: string, doc: StoredDocument): boolean {
  if (!set(localStorage, DOC_PREFIX + id, JSON.stringify(doc))) return false;
  const others = readIndex().filter((e) => e.id !== id);
  const entries = [{ id, modified: Date.now(), title: titleOf(doc) }, ...others];
  // Keep the most recent documents; never drop one that is open in some tab.
  const kept: IndexEntry[] = [];
  for (const e of entries) {
    if (kept.length < MAX_DOCUMENTS || e.id === id || openElsewhere(e.id)) kept.push(e);
    else remove(localStorage, DOC_PREFIX + e.id);
  }
  writeIndex(kept);
  return true;
}

// ---------------------------------------------------------------- view position

/** Where the user was in this tab's document (restored when the tab reloads). */
export interface TabView {
  scrollTop: number;
  activeIndex: number;
}

const VIEW_PREFIX = 'sebasesh.view.';

/** The saved position for this tab's document; null for a document newly opened in this tab. */
export function loadTabView(id: string): TabView | null {
  try {
    const view = JSON.parse(get(sessionStorage, VIEW_PREFIX + id) ?? 'null') as TabView | null;
    return view && typeof view.scrollTop === 'number' && typeof view.activeIndex === 'number' ? view : null;
  } catch {
    return null;
  }
}

export function saveTabView(id: string, view: TabView) {
  set(sessionStorage, VIEW_PREFIX + id, JSON.stringify(view));
}

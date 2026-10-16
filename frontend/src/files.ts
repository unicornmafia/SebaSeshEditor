// Saving the document as a JSesh .gly file on the user's disk.
//
// Where the browser has the File System Access API (Chrome, Edge), the first save asks where to
// save, and later saves write over that file; the file handle is kept in IndexedDB per document,
// so this survives a reload. Elsewhere (Safari, Firefox) every save downloads the file.

/** Shown (and suggested as `untitled_sebasesh.gly`) for a document never saved or imported. */
export const UNTITLED = 'untitled';

const SUFFIX = '_sebasesh';

/** The name a document opened from `filename` is saved under: Sinuhe.gly -> Sinuhe_sebasesh.gly. */
export function saveNameFor(filename: string): string {
  const stem = filename.replace(/\.[^.]*$/, '') || UNTITLED;
  return `${stem.endsWith(SUFFIX) ? stem : stem + SUFFIX}.gly`;
}

/** The name without its extension, for naming exports. */
export const stemOf = (filename: string) => filename.replace(/\.[^.]*$/, '');

// ---------------------------------------------------------------- File System Access API

interface WritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface SaveHandle {
  readonly name: string;
  createWritable(): Promise<WritableFileStream>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

type SaveFilePicker = (options: {
  suggestedName: string;
  id?: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveHandle>;

const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

/** Whether saves can write over the saved file (else each save is a download). */
export const CAN_SAVE_IN_PLACE = typeof picker === 'function';

/**
 * Asks where to save. Must be called straight from the click or key press.
 * Resolves to null if the user cancels.
 */
export async function pickSaveFile(suggestedName: string): Promise<SaveHandle | null> {
  try {
    return await picker!({
      suggestedName,
      id: 'sebasesh-gly', // the dialog reopens in the folder last saved to
      types: [{ description: 'JSesh document', accept: { 'application/octet-stream': ['.gly'] } }],
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    throw err;
  }
}

/**
 * Makes sure a saved file may be written again (after a reload the browser asks once).
 * Must be called straight from the click or key press.
 */
export async function mayWrite(handle: SaveHandle): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

export async function writeFile(handle: SaveHandle, blob: Blob) {
  const stream = await handle.createWritable();
  await stream.write(blob);
  await stream.close();
}

// ---------------------------------------------------------------- handles per document

const DB_NAME = 'sebasesh-files';
const STORE = 'handles';

const RECENT_STORE = 'recent';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      for (const name of [STORE, RECENT_STORE]) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>,
  storeName = STORE): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(storeName, mode).objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** The file a document was saved to, if any (null when unknown or storage is unavailable). */
export async function loadHandle(docId: string): Promise<SaveHandle | null> {
  if (!CAN_SAVE_IN_PLACE) return null;
  try {
    return (await withStore<SaveHandle | undefined>('readonly', (s) => s.get(docId))) ?? null;
  } catch {
    return null;
  }
}

export async function storeHandle(docId: string, handle: SaveHandle | null) {
  if (!CAN_SAVE_IN_PLACE) return;
  try {
    await withStore<unknown>('readwrite', (s) => (handle ? s.put(handle, docId) : s.delete(docId)) as IDBRequest<unknown>);
  } catch {
    // not kept across reloads; the next save after one asks where to save again
  }
}

// ---------------------------------------------------------------- recently opened files

/** Files kept in the recent list. */
const MAX_RECENT = 10;

interface OpenHandle {
  readonly name: string;
  getFile(): Promise<File>;
  queryPermission?(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>;
}

type OpenFilePicker = (options: {
  id?: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<OpenHandle[]>;

const openPicker = (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;

/** Whether files can be opened through the browser's picker, which can reopen them from disk later. */
export const CAN_OPEN_WITH_PICKER = typeof openPicker === 'function';

/** Asks for a file to open (CAN_OPEN_WITH_PICKER only); null if cancelled. */
export async function pickOpenFile(): Promise<{ file: File; handle: OpenHandle } | null> {
  try {
    const [handle] = await openPicker!({
      id: 'sebasesh-open',
      types: [{ description: 'JSesh, MdC, RES or Unicode text', accept: { 'text/plain': ['.gly', '.mdc', '.res', '.txt', '.uni'] } }],
    });
    return { file: await handle.getFile(), handle };
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    throw err;
  }
}

/** A recently opened file: a copy of its content, and (where possible) a way back to it on disk. */
export interface RecentFile {
  name: string;
  opened: number;
  content: Blob;
  handle?: OpenHandle;
}

export async function listRecent(): Promise<RecentFile[]> {
  try {
    const all = await withStore<RecentFile[]>('readonly', (s) => s.getAll() as IDBRequest<RecentFile[]>, RECENT_STORE);
    return all.sort((a, b) => b.opened - a.opened);
  } catch {
    return [];
  }
}

/** Puts a file at the top of the recent list (one entry per file name), keeping the last MAX_RECENT. */
export async function addRecent(file: File, handle?: OpenHandle) {
  try {
    const entry: RecentFile = { name: file.name, opened: Date.now(), content: file, ...(handle ? { handle } : {}) };
    await withStore<unknown>('readwrite', (s) => s.put(entry, file.name) as IDBRequest<unknown>, RECENT_STORE);
    const all = await listRecent();
    for (const old of all.slice(MAX_RECENT)) {
      await withStore<unknown>('readwrite', (s) => s.delete(old.name) as IDBRequest<unknown>, RECENT_STORE);
    }
  } catch {
    // the recent list is a convenience; opening the file still works
  }
}

export async function clearRecent() {
  try {
    await withStore<unknown>('readwrite', (s) => s.clear() as IDBRequest<unknown>, RECENT_STORE);
  } catch {
    // ignore
  }
}

/**
 * The file for a recent entry: read again from disk if the browser allows it (so later edits made
 * elsewhere are included), else the copy kept when it was opened (`fromCopy`).
 * Must be called straight from the click (the browser may ask for permission to read).
 */
export async function reopenRecent(entry: RecentFile): Promise<{ file: File; fromCopy: boolean }> {
  if (entry.handle) {
    try {
      const h = entry.handle;
      const granted = !h.queryPermission || (await h.queryPermission({ mode: 'read' })) === 'granted'
        || (await h.requestPermission?.({ mode: 'read' })) === 'granted';
      if (granted) return { file: await h.getFile(), fromCopy: false };
    } catch {
      // moved, deleted or not allowed: use the copy
    }
  }
  return { file: new File([entry.content], entry.name), fromCopy: true };
}

/** A short hash of the document's content, to tell whether it changed since it was saved. */
export function contentHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

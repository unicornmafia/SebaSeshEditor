import type { Direction, ExportFormat, ImportFormat, Mode, RenderResult, StoredDocument } from './types';

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function renderLine(text: string, signal?: AbortSignal): Promise<RenderResult> {
  return postJson('/api/render', { text }, signal);
}

export function renderBatch(texts: string[]): Promise<RenderResult[]> {
  return postJson('/api/render-batch', { texts });
}

export interface EditResult {
  ok: boolean;
  error: string;
  /** The line's new source. */
  source: string;
  /** copy/cut: what was taken, as MdC. */
  mdc: string;
  /** paste: number of items inserted. */
  count: number;
  warnings: string[];
}

/** Copies or cuts items [start, end) of a hieroglyphic line, or pastes `text` before item `start`. */
export function editLine(source: string, op: 'copy' | 'cut' | 'paste', start: number, end = 0, text = ''): Promise<EditResult> {
  return postJson('/api/edit', { source, op, start, end, text });
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  warnings: string[];
}

export async function exportDocument(
  format: ExportFormat, document: StoredDocument, filename: string, options: { outline?: boolean } = {},
): Promise<ExportResult> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format, document, filename, ...options }),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status} ${res.statusText}`);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${filename}.${format}`;
  let warnings: string[] = [];
  try {
    warnings = JSON.parse(res.headers.get('X-Export-Warnings') ?? '[]');
  } catch {
    // ignore malformed header
  }
  return { blob: await res.blob(), filename: name, warnings };
}

export interface ImportResult {
  format: ImportFormat;
  lines: { mode: Mode; source: string; direction?: Direction }[];
  warnings: string[];
}

export async function importFile(file: File, format?: ImportFormat): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (format) form.append('format', format);
  const res = await fetch('/api/import', { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `Import failed: ${res.status}`);
  }
  return res.json();
}

/** A sign in the hieroglyph picker. */
export interface Sign {
  /** Unicode (Gardiner) name, e.g. G17 or A5a. */
  name: string;
  char: string;
  /** One of the signs added in Unicode 16 (Egyptian Hieroglyphs Extended-A). */
  extended: boolean;
  /** The MdC code for the sign, or null if MdC has none (it is then inserted as Unicode). */
  mdc: string | null;
  /** Other MdC codes for it, e.g. nTr. */
  mnemonics: string[];
  /** Its transliterations, e.g. ['m']. */
  readings: string[];
}

export interface SignCategory {
  id: string;
  description: string;
  signs: Sign[];
}

export async function fetchSigns(): Promise<SignCategory[]> {
  const res = await fetch('/api/signs');
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** A sign's uses and readings, as a short HTML list (empty if none are known). */
export async function fetchSignInfo(char: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`/api/signs/info?char=${encodeURIComponent(char)}`, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return ((await res.json()) as { info: string }).info;
}

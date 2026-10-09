// Copying hieroglyphic lines as an image: an SVG export of the lines (hieropy) with all text as
// glyph outlines, a PNG rendering of it for applications that do not take SVG, and the text.
// Outlines because browsers sanitize clipboard SVG, dropping <style> and so any embedded fonts.

import { exportDocument } from './api';
import type { StoredDocument } from './types';

/** Raster scale of the PNG relative to the SVG's size. */
const PNG_SCALE = 2;

async function exportSvg(doc: StoredDocument): Promise<Blob> {
  const { blob } = await exportDocument('svg', doc, 'selection', { outline: true });
  // Exactly 'image/svg+xml' (no charset parameter): the clipboard API matches types literally.
  return new Blob([await blob.arrayBuffer()], { type: 'image/svg+xml' });
}

async function svgToPng(svg: Blob): Promise<Blob> {
  const url = URL.createObjectURL(svg);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(img.naturalWidth * PNG_SCALE);
    canvas.height = Math.ceil(img.naturalHeight * PNG_SCALE);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(PNG_SCALE, PNG_SCALE);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the PNG'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Safari (WebKit without Chrome): reports SVG clipboard support but rejects SVG writes. */
const IS_SAFARI = /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);

const supports = (type: string) =>
  typeof ClipboardItem !== 'undefined' && (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports(type));

/**
 * Puts `doc` on the clipboard as an image (SVG, plus PNG) together with `text`.
 *
 * Must be called synchronously from the copy event (a user gesture): the ClipboardItem is
 * created at once with promised contents, which is what Safari requires. Tries the richest
 * combination the browser accepts. Resolves to the image formats written, or [] if only
 * the text could be copied.
 */
export async function copyAsImage(doc: StoredDocument, text: string): Promise<string[]> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return [];
  const svg = exportSvg(doc);
  const png = svg.then(svgToPng);
  // Avoid unhandled rejections for promises a fallback attempt does not use.
  svg.catch(() => undefined);
  png.catch(() => undefined);
  const plain = new Blob([text], { type: 'text/plain' });

  // Richest combination first. Safari reports SVG support but rejects SVG writes.
  const combos: string[][] = [];
  if (!IS_SAFARI && supports('image/svg+xml')) combos.push(['image/svg+xml', 'image/png', 'text/plain']);
  combos.push(['image/png', 'text/plain']);
  const promised: Record<string, Blob | Promise<Blob>> = { 'image/svg+xml': svg, 'image/png': png, 'text/plain': plain };

  const tryWrite = async (types: string[], values: Record<string, Blob | Promise<Blob>>) => {
    try {
      await navigator.clipboard.write([new ClipboardItem(Object.fromEntries(types.map((t) => [t, values[t]])))]);
      return true;
    } catch {
      return false;
    }
  };

  // First with the image still being produced (written within the user's gesture, as Safari
  // requires), then, if refused, once more with the finished image (some engines insist on that).
  for (const types of combos) {
    if (await tryWrite(types, promised)) return types.filter((t) => t.startsWith('image/'));
  }
  try {
    const finished = { 'image/svg+xml': await svg, 'image/png': await png, 'text/plain': plain };
    for (const types of combos) {
      if (await tryWrite(types, finished)) return types.filter((t) => t.startsWith('image/'));
    }
  } catch {
    // the export or the PNG rendering failed
  }
  return [];
}

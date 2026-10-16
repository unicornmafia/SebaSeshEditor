// Printing the document: the PDF export (hieropy), printed by the browser's PDF viewer.

import { IS_SAFARI } from './clipboard';

let frame: HTMLIFrameElement | null = null;

/** Prints a PDF from a hidden frame. The frame stays until the next print (the dialog may still be open). */
function printInFrame(url: string) {
  if (frame) {
    URL.revokeObjectURL(frame.src);
    frame.remove();
  }
  const f = document.createElement('iframe');
  f.className = 'print-frame';
  f.setAttribute('aria-hidden', 'true');
  // The PDF viewer needs a moment after loading before it can print.
  f.onload = () => setTimeout(() => {
    f.contentWindow?.focus();
    f.contentWindow?.print();
  }, 250);
  f.src = url;
  document.body.appendChild(f);
  frame = f;
}

/**
 * Starts printing; call it straight from the click (or key press). `makePdf` produces the PDF.
 * Safari cannot print a PDF from a frame, so there the PDF opens in a tab of its own, which is
 * opened at once so it is not blocked as a pop-up. Resolves to how the PDF was shown.
 */
export async function printPdf(makePdf: () => Promise<Blob>): Promise<'dialog' | 'tab'> {
  const tab = IS_SAFARI ? window.open('', '_blank') : null;
  try {
    const url = URL.createObjectURL(await makePdf());
    if (tab) {
      tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return 'tab';
    }
    printInFrame(url);
    return 'dialog';
  } catch (err) {
    tab?.close();
    throw err;
  }
}

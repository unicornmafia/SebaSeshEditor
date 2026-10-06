import { useLayoutEffect, useRef } from 'react';
import type { Direction } from '../types';

// Globals defined by /hierojax.js (loaded as a classic script in index.html).
interface HieroJaxFragment {
  print(element: HTMLElement, options: Record<string, unknown>): void;
}
declare const syntax: { parse(encoding: string): HieroJaxFragment };
declare const hierojax: { nFonts: number; nFontsLoaded: number };

const fontsLoaded = () => typeof hierojax === 'undefined' || hierojax.nFontsLoaded >= hierojax.nFonts;

let fontsReady: Promise<void> | null = null;

/** Resolves when HieroJax's font has loaded (polls its counter; never alerts, unlike HieroJax). */
function whenFontsReady(): Promise<void> {
  fontsReady ??= new Promise((resolve) => {
    const check = () => (fontsLoaded() ? resolve() : setTimeout(check, 20));
    check();
  });
  return fontsReady;
}

interface Props {
  /** Unicode hieroglyphic encoding (already validated by hieropy on the server). */
  unicode: string;
  fontsize: number;
  direction?: Direction;
}

/**
 * Renders a Unicode encoding with HieroJax.
 *
 * This calls HieroJax's parser and printer directly rather than hierojax.processFragment():
 * that entry point reads each element's computed style and innerText, forcing a layout of the
 * whole page per line, so large documents took time quadratic in their length (and could
 * freeze the tab).
 *
 * React never owns the contents: each update draws into a fresh child span, so a draw still
 * waiting for the font only ever finds a node that has since been replaced, and skips it.
 * Until drawn, the span holds the encoding as text, which is how the loading spinner tells
 * drawn lines from pending ones.
 */
export default function HieroGlyphs({ unicode, fontsize, direction = 'hlr' }: Props) {
  const host = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const span = document.createElement('span');
    span.className = 'hierojax';
    span.textContent = unicode;
    el.replaceChildren(span);
    if (!unicode || typeof syntax === 'undefined') return;

    const draw = () => {
      if (!span.isConnected) return; // superseded by a newer rendering
      span.textContent = '';
      try {
        syntax.parse(unicode).print(span, { fontsize, dir: direction, type: 'svg', signcolor: 'black' });
      } catch (err) {
        console.warn('HieroJax could not draw', unicode, err);
      }
    };
    // Draw synchronously when the font is there, so a whole document is drawn in one commit.
    if (fontsLoaded()) draw();
    else whenFontsReady().then(draw);
  }, [unicode, fontsize, direction]);

  return <span ref={host} className="hiero-host" style={{ fontSize: fontsize }} />;
}

import { useLayoutEffect, useRef } from 'react';
import type { Direction } from '../types';

// Global defined by /hierojax.js (loaded as a classic script in index.html).
declare const hierojax: { processFragment(elem: HTMLElement): void };

interface Props {
  /** Unicode hieroglyphic encoding (already validated by hieropy on the server). */
  unicode: string;
  fontsize: number;
  direction?: Direction;
}

/**
 * Renders a Unicode encoding with HieroJax.
 *
 * HieroJax replaces the element's text with its rendering, possibly asynchronously
 * (it waits for its font), so React never owns the contents: each update renders into
 * a fresh child span, which leaves any stale pending render working on a detached node.
 */
export default function HieroGlyphs({ unicode, fontsize, direction = 'hlr' }: Props) {
  const host = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const span = document.createElement('span');
    span.className = 'hierojax';
    span.dataset.type = 'svg';
    span.dataset.dir = direction;
    span.textContent = unicode;
    el.replaceChildren(span);
    if (unicode && typeof hierojax !== 'undefined') hierojax.processFragment(span);
  }, [unicode, fontsize, direction]); // HieroJax reads the computed font size when it renders

  return <span ref={host} className="hiero-host" style={{ fontSize: fontsize }} />;
}

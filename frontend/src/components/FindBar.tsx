import { useEffect, useRef } from 'react';
import type { SearchScope } from '../search';

interface Props {
  text: string;
  scope: SearchScope;
  /** Number of matching lines, and which one is current (0-based; -1 for none). */
  count: number;
  current: number;
  /** Changes when ⌘F is pressed again while open, to refocus and select the query. */
  focusTick: number;
  onText: (text: string) => void;
  onScope: (scope: SearchScope) => void;
  /** Goes to the next (+1) or previous (-1) match. */
  onStep: (delta: number) => void;
  onClose: () => void;
}

const SCOPES: { value: SearchScope; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Search hieroglyphic and text lines' },
  { value: 'hiero', label: 'Glyphs', title: 'Search hieroglyphic lines only (the query is read as MdC)' },
  { value: 'text', label: 'Text', title: 'Search transliteration and Latin text lines only' },
];

/** Search box over the main window (⌘F): MdC finds hieroglyphs by sign, other text finds text. */
export default function FindBar({ text, scope, count, current, focusTick, onText, onScope, onStep, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusTick]);

  return (
    <div className="find-bar" role="search">
      <i className="fa-solid fa-magnifying-glass find-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="form-control form-control-sm find-input"
        placeholder="Find MdC (e.g. nTr, ra-mn) or text"
        aria-label="Find"
        value={text}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="find-count" aria-live="polite">
        {text ? (count ? `${current + 1} of ${count}` : 'No matches') : ''}
      </span>
      <div className="btn-group btn-group-sm find-scope" role="group" aria-label="Search in">
        {SCOPES.map((s) => (
          <button key={s.value} type="button" title={s.title} aria-pressed={scope === s.value}
            className={`btn ${scope === s.value ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => { onScope(s.value); inputRef.current?.focus(); }}>
            {s.label}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-sm btn-link" title="Previous match (Shift+Enter)" aria-label="Previous match"
        disabled={!count} onClick={() => onStep(-1)}>
        <i className="fa-solid fa-chevron-up" />
      </button>
      <button type="button" className="btn btn-sm btn-link" title="Next match (Enter)" aria-label="Next match"
        disabled={!count} onClick={() => onStep(1)}>
        <i className="fa-solid fa-chevron-down" />
      </button>
      <button type="button" className="btn btn-sm btn-link" title="Close (Esc)" aria-label="Close search" onClick={onClose}>
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
}

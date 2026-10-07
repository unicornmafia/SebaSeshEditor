import { forwardRef } from 'react';
import { MODES, type Line } from '../types';
import ModeIcon from './ModeIcon';

interface Props {
  line: Line;
  lineNumber: number;
  pending: boolean;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onCommit: () => void;
  /** Called when text in the input is highlighted (a non-empty selection). */
  onSelectText: () => void;
}

const FORMAT_LABELS: Record<string, string> = {
  mdc: 'Manuel de Codage',
  unicode: 'Unicode',
  hybrid: 'MdC + Unicode controls',
};

const PLACEHOLDERS: Record<Line['mode'], string> = {
  hiero: 'Type Manuel de Codage (e.g. i-w-r:a) or Unicode; click the icons on the left to add control characters',
  translit: 'Type transliteration in ASCII (e.g. ^imn-Htp sA=f); ^ capitalises the next letter',
  latin: 'Type Latin text',
  bold: 'Type bold Latin text',
  italic: 'Type italic Latin text',
};

const InputBar = forwardRef<HTMLInputElement, Props>(function InputBar(
  { line, lineNumber, pending, onChange, onKeyDown, onCommit, onSelectText },
  ref,
) {
  const mode = MODES.find((m) => m.mode === line.mode)!;
  const result = line.mode === 'hiero' && line.source.trim() ? line.result : undefined;

  return (
    <div className="input-bar">
      <div className="input-group">
        <span className="input-group-text mode-badge" title={`Line ${lineNumber}: ${mode.label}`}>
          <ModeIcon mode={mode} />
          <span className="ms-2 d-none d-md-inline">{lineNumber}</span>
        </span>
        <input
          ref={ref}
          type="text"
          className={`form-control input-line input-${line.mode}`}
          value={line.source}
          placeholder={PLACEHOLDERS[line.mode]}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onSelect={(e) => {
            const el = e.currentTarget;
            if (el.selectionStart !== el.selectionEnd) onSelectText();
          }}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={line.mode !== 'hiero' && line.mode !== 'translit'}
          aria-label="Line input"
        />
        <button type="button" className="btn search-submit" onClick={onCommit} title="New line (Enter)">
          <i className="fa-solid fa-turn-down fa-rotate-90" />
        </button>
      </div>
      <div className="input-status small">
        {pending && <span className="text-muted"><i className="fa-solid fa-spinner fa-spin me-1" />rendering…</span>}
        {!pending && result && !result.ok && (
          <span className="text-danger"><i className="fa-solid fa-circle-exclamation me-1" />Not rendered: {result.error}</span>
        )}
        {!pending && result?.ok && (
          <span className="text-success"><i className="fa-solid fa-check me-1" />{FORMAT_LABELS[result.sourceFormat] ?? ''}</span>
        )}
        {!pending && result?.ok && result.warnings.length > 0 && (
          <span className="text-warning-emphasis ms-3" title={result.warnings.join('\n')}>
            <i className="fa-solid fa-triangle-exclamation me-1" />{result.warnings[0]}
            {result.warnings.length > 1 ? ` (+${result.warnings.length - 1} more)` : ''}
          </span>
        )}
        <span className="ms-auto text-muted d-none d-lg-inline">
          Enter: new line · ↑/↓: previous/next line · Shift+↑/↓: select lines · Esc: clear selection · Backspace on empty line: delete it
        </span>
      </div>
    </div>
  );
});

export default InputBar;

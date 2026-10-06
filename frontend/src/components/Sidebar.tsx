import { CONTROL_GROUPS } from '../controls';

interface Props {
  disabled: boolean;
  onInsert: (text: string) => void;
}

export default function Sidebar({ disabled, onInsert }: Props) {
  return (
    <aside className="control-sidebar" aria-label="Unicode control characters">
      {CONTROL_GROUPS.map((group) => (
        <section key={group.title} className="control-group">
          <div className="control-group-title">{group.title}</div>
          <div className="control-grid">
            {group.controls.map((control) => (
              <button
                key={control.name}
                type="button"
                className="control-btn"
                title={control.name}
                aria-label={control.name}
                disabled={disabled}
                // Keep focus (and the caret) in the input line.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onInsert(control.insert)}
              >
                {control.label ? (
                  <span className="control-label">{control.label}</span>
                ) : (
                  <span className="control-glyph">{control.glyph ?? control.insert}</span>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
}

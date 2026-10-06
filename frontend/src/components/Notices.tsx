export interface Notice {
  id: number;
  kind: 'success' | 'warning' | 'danger';
  title: string;
  details?: string[];
}

interface Props {
  notices: Notice[];
  onDismiss: (id: number) => void;
}

const ICONS = { success: 'fa-circle-check', warning: 'fa-triangle-exclamation', danger: 'fa-circle-exclamation' };

export default function Notices({ notices, onDismiss }: Props) {
  return (
    <div className="notices" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`alert alert-${n.kind} alert-dismissible shadow-sm small mb-2`} role="status">
          <i className={`fa-solid ${ICONS[n.kind]} me-2`} />
          <strong>{n.title}</strong>
          {n.details && n.details.length > 0 && (
            <ul className="mb-0 mt-1 ps-3">
              {n.details.slice(0, 8).map((d, i) => <li key={i}>{d}</li>)}
              {n.details.length > 8 && <li>… and {n.details.length - 8} more</li>}
            </ul>
          )}
          <button type="button" className="btn-close" aria-label="Dismiss" onClick={() => onDismiss(n.id)} />
        </div>
      ))}
    </div>
  );
}

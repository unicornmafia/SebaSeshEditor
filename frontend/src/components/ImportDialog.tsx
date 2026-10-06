import type { ImportResult } from '../api';

const FORMAT_NAMES = { gly: 'JSesh', mdc: 'Manuel de Codage', res: 'RES', unicode: 'Unicode' } as const;

interface Props {
  filename: string;
  result: ImportResult;
  onReplace: () => void;
  onAppend: () => void;
  onCancel: () => void;
}

export default function ImportDialog({ filename, result, onReplace, onAppend, onCancel }: Props) {
  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header modal-header-seba">
              <h5 className="modal-title"><i className="fa-solid fa-folder-open me-2" />Open {filename}</h5>
              <button type="button" className="btn-close btn-close-white" aria-label="Close" onClick={onCancel} />
            </div>
            <div className="modal-body">
              <p className="mb-2">
                Read <strong>{result.lines.length}</strong> line{result.lines.length === 1 ? '' : 's'} as{' '}
                <strong>{FORMAT_NAMES[result.format]}</strong>.
              </p>
              {result.warnings.length > 0 && (
                <div className="alert alert-warning py-2 small import-warnings">
                  <div className="fw-semibold mb-1">
                    <i className="fa-solid fa-triangle-exclamation me-1" />{result.warnings.length} conversion note{result.warnings.length === 1 ? '' : 's'}
                  </div>
                  <ul className="mb-0 ps-3">
                    {result.warnings.slice(0, 30).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>Cancel</button>
              <button type="button" className="btn btn-outline-primary search_config" onClick={onAppend}>Append to document</button>
              <button type="button" className="btn search-submit" onClick={onReplace} autoFocus>Replace document</button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}

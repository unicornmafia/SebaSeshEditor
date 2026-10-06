/** Spinner covering the main window while a document is opened or drawn. */
export default function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="spinner-border loading-spinner" aria-hidden="true" />
        <div className="loading-message">{message}</div>
      </div>
    </div>
  );
}

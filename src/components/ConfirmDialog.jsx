import { useEffect, useRef } from 'react';

export default function ConfirmDialog({
  open,
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  variant = 'default',
  busy = false,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);
  const isCurrentlyOpen = open || isOpen;
  const isDanger = danger || variant === 'danger';

  useEffect(() => {
    if (!isCurrentlyOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape' && !busy) onCancel?.();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isCurrentlyOpen, busy, onCancel]);

  if (!isCurrentlyOpen) return null;

  return (
    <div className="confirm-overlay" role="presentation" onClick={() => !busy && onCancel?.()}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`confirm-dialog-icon ${isDanger ? 'danger' : ''}`}>
          {isDanger ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
        </div>
        <h2 id="confirm-dialog-title" className="confirm-dialog-title confirm-title">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="confirm-dialog-message confirm-message">
          {message}
        </p>
        <div className="confirm-dialog-actions confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-btn-cancel confirm-btn cancel"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-btn ${isDanger ? 'confirm-btn-danger danger' : 'confirm-btn-confirm primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

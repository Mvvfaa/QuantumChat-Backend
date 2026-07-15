/**
 * ToastProvider.jsx
 * 
 * A React context-based toast notification system. Provides a ToastProvider
 * wrapper component and a useToast() hook that exposes showToast().
 * 
 * Features:
 *   - Three toast types: error (red), success (green), info (blue)
 *   - Auto-dismiss with configurable duration
 *   - Animated progress bar that shrinks over the duration
 *   - Slide-in animation from the right
 *   - Stacking in the top-right corner
 *   - Manual close button on each toast
 */
import { useState, useCallback, useContext, createContext, useRef } from 'react';

/** @type {React.Context} */
const ToastContext = createContext(null);

/**
 * Custom hook to access the toast notification system.
 * Must be used within a <ToastProvider>.
 * 
 * @returns {{ showToast: (message: string, type?: string, duration?: number) => void }}
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return context;
}

/**
 * Individual Toast component — handles its own auto-dismiss timer
 * and animated progress bar.
 */
function Toast({ id, message, type, duration, onRemove }) {
  return (
    <div
      className={`toast toast-${type}`}
      role="alert"
      aria-live="assertive"
      style={{ '--toast-duration': `${duration}ms` }}
    >
      {/* Toast message text */}
      <span className="toast-message">{message}</span>

      {/* Close button */}
      <button
        className="toast-close"
        onClick={() => onRemove(id)}
        aria-label="Dismiss notification"
        type="button"
      >
        ✕
      </button>

      {/* Animated progress bar — shrinks from full width to 0 over `duration` */}
      <div className="toast-progress" />
    </div>
  );
}

/**
 * ToastProvider component — wraps the app and renders the toast container.
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idCounter = useRef(0);
  const timersRef = useRef({});

  /**
   * Remove a toast by its ID and clear its auto-dismiss timer.
   */
  const removeToast = useCallback((id) => {
    // Clear the timer if it's still running
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Show a new toast notification.
   * 
   * @param {string} message  - The message to display
   * @param {string} type     - Toast type: 'error' | 'success' | 'info'
   * @param {number} duration - Auto-dismiss time in milliseconds
   */
  const showToast = useCallback(
    (message, type = 'error', duration = 4000) => {
      const id = ++idCounter.current;

      setToasts((prev) => [...prev, { id, message, type, duration }]);

      // Set an auto-dismiss timer
      timersRef.current[id] = setTimeout(() => {
        removeToast(id);
      }, duration);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Toast container — fixed in top-right corner */}
      {toasts.length > 0 && (
        <div className="toast-container" aria-label="Notifications">
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              id={toast.id}
              message={toast.message}
              type={toast.type}
              duration={toast.duration}
              onRemove={removeToast}
            />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export default ToastProvider;

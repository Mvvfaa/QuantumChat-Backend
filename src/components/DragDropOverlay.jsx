/**
 * DragDropOverlay.jsx
 * 
 * A full-area drop-zone overlay that appears when files are being
 * dragged over the chat area. Features a cloud upload SVG icon,
 * instructional text, and fade + scale animation.
 */
import { useCallback } from 'react';

/**
 * DragDropOverlay component
 * 
 * @param {Object}   props
 * @param {boolean}  props.isVisible  - Whether the overlay is shown
 * @param {function} props.onFileDrop - Callback invoked with the dropped File object
 */
function DragDropOverlay({ isVisible, onFileDrop }) {
  /**
   * Prevent default drag behavior to enable dropping.
   */
  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  /**
   * Handle the drop event — extract the first file and pass it to the callback.
   */
  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        onFileDrop(files[0]);
      }
    },
    [onFileDrop]
  );

  // Don't render when not visible
  if (!isVisible) return null;

  return (
    <div
      className="drag-drop-overlay"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="region"
      aria-label="File drop zone"
    >
      {/* Cloud upload SVG icon */}
      <svg
        className="drag-drop-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
        <path d="M12 12v9" />
        <path d="m16 16-4-4-4 4" />
      </svg>

      {/* Instructional text */}
      <p className="drag-drop-text">Drop files here to encrypt &amp; send</p>
    </div>
  );
}

export default DragDropOverlay;

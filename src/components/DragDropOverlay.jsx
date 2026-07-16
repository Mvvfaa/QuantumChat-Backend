/**
 * DragDropOverlay.jsx — drop zone for one or more files.
 */
import { useCallback } from 'react';

function DragDropOverlay({ isVisible, onFileDrop }) {
  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const list = event.dataTransfer?.files;
      if (!list?.length) return;
      const files = Array.from(list);
      if (typeof onFileDrop === 'function') {
        // Prefer multi-file handler; legacy single-file also works
        onFileDrop(files.length === 1 ? files[0] : files);
      }
    },
    [onFileDrop]
  );

  if (!isVisible) return null;

  return (
    <div
      className="drag-drop-overlay"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="region"
      aria-label="File drop zone"
    >
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
      <p className="drag-drop-text">Drop files here to encrypt &amp; send</p>
      <p className="drag-drop-subtext">Images, video, audio, PDF, Word, ZIP — up to 15 MB each</p>
    </div>
  );
}

export default DragDropOverlay;

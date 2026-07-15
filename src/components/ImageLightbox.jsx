/**
 * ImageLightbox.jsx
 * 
 * A full-screen image viewer overlay. Displays an image centered on
 * a dark backdrop with close controls via button, backdrop click,
 * or Escape key. Includes fade-in and scale animation on open.
 */
import { useEffect, useCallback } from 'react';

/**
 * ImageLightbox component
 * 
 * @param {Object} props
 * @param {string}   props.src     - Image source URL
 * @param {string}   props.alt     - Alt text for the image
 * @param {boolean}  props.isOpen  - Whether the lightbox is visible
 * @param {function} props.onClose - Callback to close the lightbox
 */
function ImageLightbox({ src, alt = 'Image preview', isOpen, onClose }) {
  /**
   * Handle keyboard events — close on Escape key.
   */
  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  // Bind and unbind the keyboard listener when the lightbox is open
  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener('keydown', handleKeyDown);
    // Prevent body scrolling while the lightbox is open
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  // Don't render anything when closed
  if (!isOpen) return null;

  /**
   * Close when the backdrop (overlay itself) is clicked,
   * but not when the image or close button is clicked.
   */
  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="lightbox-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Image lightbox"
    >
      {/* Close button in top-right corner */}
      <button
        className="lightbox-close"
        onClick={onClose}
        aria-label="Close lightbox"
        type="button"
      >
        ✕
      </button>

      {/* The image, centered and scaled to fit */}
      <img
        className="lightbox-image"
        src={src}
        alt={alt}
      />
    </div>
  );
}

export default ImageLightbox;

import { useEffect, useCallback } from 'react';

/**
 * Full-screen image gallery. Supports prev/next when multiple images are provided.
 */
function ImageLightbox({
  src,
  alt = 'Image preview',
  isOpen,
  onClose,
  items = null,
  index = 0,
  onIndexChange,
}) {
  const gallery = Array.isArray(items) && items.length > 0 ? items : src ? [{ src, alt }] : [];
  const currentIndex = Math.min(Math.max(0, index), Math.max(0, gallery.length - 1));
  const current = gallery[currentIndex];
  const hasMany = gallery.length > 1;

  const go = useCallback(
    (delta) => {
      if (!hasMany || !onIndexChange) return;
      const next = (currentIndex + delta + gallery.length) % gallery.length;
      onIndexChange(next);
    },
    [hasMany, onIndexChange, currentIndex, gallery.length]
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    },
    [onClose, go]
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen || !current?.src) return null;

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      className="lightbox-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Image gallery"
    >
      <button className="lightbox-close" onClick={onClose} aria-label="Close lightbox" type="button">
        ✕
      </button>

      {hasMany && (
        <>
          <button
            type="button"
            className="lightbox-nav lightbox-nav-prev"
            onClick={() => go(-1)}
            aria-label="Previous image"
          >
            ‹
          </button>
          <button
            type="button"
            className="lightbox-nav lightbox-nav-next"
            onClick={() => go(1)}
            aria-label="Next image"
          >
            ›
          </button>
          <div className="lightbox-counter">
            {currentIndex + 1} / {gallery.length}
          </div>
        </>
      )}

      <img className="lightbox-image" src={current.src} alt={current.alt || alt} />
    </div>
  );
}

export default ImageLightbox;

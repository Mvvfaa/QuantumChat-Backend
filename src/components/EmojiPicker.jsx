import { useRef, useEffect, useCallback } from 'react';
import { COMPOSER_EMOJIS } from '../utils/emojis.js';

const EMOJI_CATEGORIES = [
  {
    label: 'Smileys',
    emojis: ['😀', '😂', '🥹', '😍', '🤩', '😎', '🥳', '🤔', '😤', '😭'],
  },
  {
    label: 'Gestures',
    emojis: ['👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '💪', '🫡', '🫶'],
  },
  {
    label: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💗', '💝'],
  },
  {
    label: 'Objects',
    emojis: ['🔥', '⭐', '🎉', '🎯', '💡', '🚀', '✅', '❌', '💬', '🔒'],
  },
];

export default function EmojiPicker({ onSelect, onPick, isOpen, onClose }) {
  const panelRef = useRef(null);
  const triggerSelect = onSelect || onPick;
  const isCurrentlyOpen = isOpen !== undefined ? isOpen : true; // fallback to true if uncontrolled

  const handleEmojiClick = useCallback(
    (emoji) => {
      triggerSelect?.(emoji);
      onClose?.();
    },
    [triggerSelect, onClose]
  );

  useEffect(() => {
    if (!isCurrentlyOpen || !onClose) return;

    function handleClickOutside(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        // Only trigger close if the click isn't on the toggle button
        const isToggle = event.target.closest('.attach-button');
        if (!isToggle) {
          onClose();
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCurrentlyOpen, onClose]);

  if (!isCurrentlyOpen) return null;

  // Use the curated categorization if available, otherwise fallback to COMPOSER_EMOJIS if imported
  const emojisToUse = COMPOSER_EMOJIS || EMOJI_CATEGORIES.flatMap(c => c.emojis);

  return (
    <div className="emoji-picker" ref={panelRef} role="dialog" aria-label="Emoji picker">
      <div className="emoji-picker-header">
        <span>Emojis</span>
        <button type="button" className="emoji-picker-close" onClick={onClose} aria-label="Close emoji picker">
          ×
        </button>
      </div>
      {COMPOSER_EMOJIS ? (
        <div className="emoji-picker-grid">
          {emojisToUse.map((emoji) => (
            <button key={emoji} type="button" onClick={() => handleEmojiClick(emoji)} aria-label={`Insert ${emoji}`}>
              {emoji}
            </button>
          ))}
        </div>
      ) : (
        EMOJI_CATEGORIES.map((category) => (
          <div key={category.label} className="emoji-picker-category">
            <span className="emoji-picker-category-label">{category.label}</span>
            <div className="emoji-picker-grid" role="group" aria-label={`${category.label} emojis`}>
              {category.emojis.map((emoji) => (
                <button
                  key={emoji}
                  className="emoji-picker-btn"
                  type="button"
                  onClick={() => handleEmojiClick(emoji)}
                  aria-label={`Select ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

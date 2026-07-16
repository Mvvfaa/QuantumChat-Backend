/**
 * TypingIndicator.jsx
 * 
 * A small animated component that shows three bouncing dots
 * to indicate that another user is currently typing a message.
 * 
 * The dots bounce sequentially with staggered animation delays
 * to create a smooth wave-like effect.
 */

/**
 * TypingIndicator component
 * 
 * @param {Object} props
 * @param {boolean} props.isTyping - Whether to show the typing indicator
 * @param {string}  [props.username] - Optional username to display alongside the dots
 */
function TypingIndicator({ isTyping, username }) {
  // Don't render anything if not typing
  if (!isTyping) return null;

  return (
    <div className="typing-indicator" role="status" aria-label={username ? `${username} is typing` : 'Someone is typing'}>
      {/* Username label (shown only if provided) */}
      {username && (
        <span className="typing-indicator-text">{username} is typing</span>
      )}

      {/* Three bouncing dots with staggered animation delays */}
      <span className="typing-dot" aria-hidden="true" />
      <span className="typing-dot" aria-hidden="true" />
      <span className="typing-dot" aria-hidden="true" />
    </div>
  );
}

export default TypingIndicator;

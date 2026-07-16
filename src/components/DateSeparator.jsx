/**
 * DateSeparator.jsx
 * 
 * A visual date divider for chat message lists.
 * Renders a horizontal line with a centered date label.
 * 
 * Smart formatting:
 *   - "Today" if the date matches the current day
 *   - "Yesterday" if the date is one day before today
 *   - "Month Day, Year" for all other dates (e.g. "July 12, 2026")
 */
import { useMemo } from 'react';

/**
 * Formats a Date object into a user-friendly label.
 * @param {Date} dateObj - The date to format
 * @returns {string} Formatted date label
 */
function formatDateLabel(dateObj) {
  const now = new Date();

  // Create date-only comparisons (strip time components)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());

  const diffMs = today.getTime() - target.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  // Format as "Month Day, Year"
  return dateObj.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * DateSeparator component
 * 
 * @param {Object} props
 * @param {Date|string} props.date - A Date object or ISO date string
 */
function DateSeparator({ date }) {
  // Parse the date and memoize the formatted label
  const label = useMemo(() => {
    const dateObj = date instanceof Date ? date : new Date(date);
    return formatDateLabel(dateObj);
  }, [date]);

  return (
    <div className="date-separator" role="separator" aria-label={`Messages from ${label}`}>
      <span className="date-separator-label">{label}</span>
    </div>
  );
}

export default DateSeparator;

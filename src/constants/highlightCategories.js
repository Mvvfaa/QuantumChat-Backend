export const HIGHLIGHT_CATEGORIES = [
  { id: 'travel', label: 'Travel', emoji: '✈️' },
  { id: 'friends', label: 'Friends', emoji: '❤️' },
  { id: 'food', label: 'Food', emoji: '🍔' },
  { id: 'university', label: 'University', emoji: '🎓' },
  { id: 'memories', label: 'Memories', emoji: '📸' },
];

export const HIGHLIGHT_CATEGORY_IDS = HIGHLIGHT_CATEGORIES.map((c) => c.id);

export function getHighlightCategory(id) {
  return HIGHLIGHT_CATEGORIES.find((c) => c.id === id) || null;
}

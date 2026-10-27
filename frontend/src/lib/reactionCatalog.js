// Shared, non-secret catalog used by the meeting UI and backend allowlist.
export const reactionCategories = ['Popular', 'Happy', 'Appreciation', 'Celebration', 'Other'];
export const reactions = [
  ['👍', 'Thumbs up', 'Popular', 'yes like agree'], ['👏', 'Clap', 'Popular', 'applause bravo'],
  ['❤️', 'Heart', 'Popular', 'love'], ['😂', 'Laugh', 'Happy', 'funny joy'],
  ['🎉', 'Party popper', 'Celebration', 'congratulations'], ['😮', 'Surprised', 'Popular', 'wow'],
  ['😢', 'Sad', 'Other', 'cry'], ['🔥', 'Fire', 'Popular', 'great hot'],
  ['💯', 'Hundred', 'Appreciation', 'perfect'], ['🙏', 'Thank you', 'Appreciation', 'thanks please'],
  ['😍', 'Heart eyes', 'Happy', 'love'], ['🤔', 'Thinking', 'Other', 'question'],
  ['👋', 'Wave', 'Other', 'hello goodbye'], ['✅', 'Check', 'Other', 'done yes'],
  ['💪', 'Strong', 'Appreciation', 'muscle support'], ['🥳', 'Party face', 'Celebration', 'birthday'],
  ['🙌', 'Raised hands', 'Appreciation', 'hooray'], ['🤝', 'Handshake', 'Appreciation', 'agreement together'],
  ['⭐', 'Star', 'Appreciation', 'excellent'], ['💡', 'Idea', 'Other', 'light bulb'],
  ['🚀', 'Rocket', 'Celebration', 'launch'], ['😎', 'Cool', 'Happy', 'sunglasses'],
  ['🤩', 'Star eyes', 'Happy', 'amazing excited'], ['☕', 'Coffee', 'Other', 'break tea'],
].map(([emoji, label, category, keywords]) => ({ emoji, label, category, keywords }));
export const reactionChoices = reactions.map(item => item.emoji);
export function findReactions(query = '', category = '') {
  const term = query.trim().toLowerCase().slice(0, 80);
  return reactions.filter(item => (!category || item.category === category) && (!term || `${item.emoji} ${item.label} ${item.keywords}`.toLowerCase().includes(term)));
}
export function recentReactions(value) {
  return Array.isArray(value) ? [...new Set(value.filter(item => reactionChoices.includes(item)))].slice(0, 8) : [];
}

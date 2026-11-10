// Player settings, kept in the browser between runs. main.js applies them (applySettings) and the settings
// screen (menu.js) edits them; the screen is built from FIELDS, so a new setting is one line here.
const KEY = 'arachnophobia.settings';
export const DEFAULTS = { master: 0.8, effects: 1, ambience: 0.7, post: true, shadows: 'high', resolution: 1, shake: true };

export const FIELDS = [
  { key: 'master', label: 'Master volume', type: 'range' },
  { key: 'effects', label: 'Effects', type: 'range' },
  { key: 'ambience', label: 'Ambience', type: 'range' },
  { key: 'post', label: 'Post effects (bloom, grade, grain)', type: 'toggle' },
  { key: 'shadows', label: 'Shadows', type: 'choice', options: [['high', 'High'], ['low', 'Low'], ['off', 'Off']] },
  { key: 'resolution', label: 'Resolution', type: 'choice', options: [[1, '100%'], [0.75, '75%'], [0.5, '50%']] },
  { key: 'shake', label: 'Camera shake', type: 'toggle' },
];

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: they just don't persist */ } }

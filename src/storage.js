// Persistent settings and career statistics (localStorage, fails soft).
const KEY = 'bubble-volley-v2';

const DEFAULTS = {
  settings: { music: 0.6, sfx: 0.8, quality: 'high', shake: true },
  setup: { mode: 'ai', difficulty: 'medium', target: 7, arena: 'day', powerups: true, style: 'classic', color0: '#3ea6ff', color1: '#ff5b7a' },
  unlocks: { rally: false, cup: false },
  stats: { played: 0, wins: 0, losses: 0, bestRally: 0, cups: 0, byDifficulty: { easy: 0, medium: 0, hard: 0 } },
};

export function loadSave() {
  const out = structuredClone(DEFAULTS);
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(out)) Object.assign(out[k], raw[k] || {});
    out.stats.byDifficulty = Object.assign({ easy: 0, medium: 0, hard: 0 }, raw.stats?.byDifficulty);
  } catch { /* ignore */ }
  return out;
}

export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ }
}

export function resetStats(save) {
  save.stats = structuredClone(DEFAULTS.stats);
  writeSave(save);
}

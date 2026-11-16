// Shared constants. Physics runs in "pixel" units (y grows downward) exactly
// like the original 2D game; the renderer converts to 3D world units.
export const W = 920;
export const GROUND_Y = 510;
export const NET_X = W / 2;
export const NET_H = 168;
export const NET_TOP = GROUND_Y - NET_H;
export const NET_R = 6;

export const BUBBLE_R = 62;
export const BALL_R = 24;

export const GRAVITY = 1450;
export const BALL_GRAVITY = 900;
export const WALL_RESTITUTION = 0.7;
export const BALL_RESTITUTION = 0.86;
export const MAX_SPEED = 760;
export const PLAYER_SPEED = 370;
export const JUMP_FORCE = -560;
export const SUPER_SPEED = 1080;       // fire-ball speed of a super spike
export const DASH_SPEED = 860;
export const DASH_TIME = 0.15;
export const DASH_CD = 0.7;
export const POWER_PER_HIT = 0.2;      // super meter gained per touch
export const MAX_TOUCHES = 3;          // touches a side may use before the ball must cross the net
export const BUMP_WINDOW = 0.3;        // seconds a bump stays armed after pressing the button
export const BUMP_CD = 0.45;

export const POWERUPS = {
  big:   { icon: '🍄', label: 'JUMBO!',     color: '#6fdc6a' },
  fast:  { icon: '⚡', label: 'TURBO!',     color: '#ffd23f' },
  slow:  { icon: '🐌', label: 'STICKY!',    color: '#b693ff' },
  moon:  { icon: '🌙', label: 'MOON BALL!', color: '#8fd6ff' },
  power: { icon: '⭐', label: 'SUPER READY!', color: '#ff9a3d' },
};

export const FIXED_DT = 1 / 120;

// pixel -> world conversion (1 world unit = 100 px, y up, origin at net base)
export const PX = 0.01;
export const wx = (x) => (x - NET_X) * PX;
export const wy = (y) => (GROUND_Y - y) * PX;

// current colours of the two sides; mutated when players pick a skin or a cup rival appears
export const TEAM_COLORS = ['#3ea6ff', '#ff5b7a'];
export const SKINS = ['#3ea6ff', '#ff5b7a', '#5fd068', '#ffa53d', '#a78bfa', '#ff7ad9', '#2ed3c3', '#f2c230'];

// Game styles change the rules of the whole match.
export const STYLES = {
  classic: { label: 'Classic' },
  chaos:   { label: 'Chaos', pickupEvery: 2.4, powerGain: 2 },
  moon:    { label: 'Low Gravity', ballG: 0.55, playerG: 0.62 },
  giant:   { label: 'Giant Ball', ballR: 40 },
  party:   { label: 'Party', party: true },
};

// Party style: a new one of these rules is drawn every two points.
export const MUTATORS = [
  { label: '🎈 GIANT BALL', ballR: 40 },
  { label: '🌙 LOW GRAVITY', ballG: 0.55, playerG: 0.62 },
  { label: '🐜 TINY BLOBS', blobScale: 0.7 },
  { label: '🍄 JUMBO BLOBS', blobScale: 1.35 },
  { label: '⚡ TURBO', speed: 1.3 },
  { label: '🎁 BUBBLE STORM', pickupEvery: 2.4, powerGain: 2 },
];

export const DEUCE_CAP = 4;            // win by two, but never play more than this many points past the target
export const COMEBACK_GAP = 3;         // trailing by this much charges the super meter faster
export const COMEBACK_BOOST = 1.6;

// Blob colours that have to be earned.
export const LOCKED = {
  '#2ed3c3': { id: 'rally', hint: 'Reach a 15-touch rally to unlock' },
  '#f2c230': { id: 'cup', hint: 'Win the Beach Cup to unlock' },
};

// Beach Cup: three rivals of rising skill, each with a home arena and a twist.
export const CUP = [
  // slow and never spikes, but rarely misjudges a ball
  { name: 'SANDY',   tag: 'THE WALL',   color: '#ffa53d', difficulty: 'easy',   arena: 'day',    style: 'classic',
    ai: { speed: 0.62, blunder: 0.13, noise: 26, jump: 0.1, set: 0, power: 0.2 } },
  // quick, dashes and dives for everything, a little wild
  { name: 'CORAL',   tag: 'THE DIVER',  color: '#ff7ad9', difficulty: 'medium', arena: 'sunset', style: 'chaos',
    ai: { speed: 0.98, dash: 1, react: 0.12, set: 0.25, power: 0.4, blunder: 0.2 } },
  // sets and power-spikes at every chance
  { name: 'TSUNAMI', tag: 'THE SPIKER', color: '#a78bfa', difficulty: 'hard',   arena: 'night',  style: 'classic',
    ai: { jump: 1, set: 0.95, power: 0.85 } },
];

export const DIFFICULTY = {
  easy:   { label: 'Easy',   speed: 0.74, noise: 40, jump: 0.3, aim: 10, blunder: 0.22, react: 0.34, dash: 0, set: 0.15 },
  medium: { label: 'Medium', speed: 0.86, noise: 28, jump: 0.6, aim: 20, blunder: 0.17, react: 0.2, dash: 0.5, set: 0.45 },
  hard:   { label: 'Hard',   speed: 1.0, noise: 10, jump: 0.95, aim: 30, blunder: 0.09, react: 0.08, dash: 1, set: 0.75 },
};

export const ARENAS = {
  day: {
    label: 'Sunny Bay',
    skyTop: '#1f7fe0', skyHorizon: '#a8dcff', sunColor: '#fff1d0', sunIntensity: 2.3,
    sunPos: [-7, 11, 8], sunDisc: [-0.35, 0.42, -1],
    hemiSky: '#bfe3ff', hemiGround: '#d9b87a', hemiIntensity: 0.8,
    fog: '#a8dcff', waterDeep: '#1479c9', waterShallow: '#46e0d0', exposure: 0.95,
    cloud: '#ffffff', stars: 0,
  },
  sunset: {
    label: 'Sunset Cove',
    skyTop: '#3b2f7a', skyHorizon: '#ff9f68', sunColor: '#ffb070', sunIntensity: 2.6,
    sunPos: [-9, 5.5, -3], sunDisc: [-0.5, 0.13, -1],
    hemiSky: '#ffb199', hemiGround: '#b0705a', hemiIntensity: 0.75,
    fog: '#ffab7a', waterDeep: '#3f3a86', waterShallow: '#ff9a7b', exposure: 1.05,
    cloud: '#ffc2a8', stars: 0.15,
  },
  night: {
    label: 'Moonlight Beach',
    skyTop: '#060b24', skyHorizon: '#23407a', sunColor: '#a9c4ff', sunIntensity: 1.9,
    sunPos: [6, 10, 5], sunDisc: [0.4, 0.5, -1],
    hemiSky: '#4a66b8', hemiGround: '#2a3350', hemiIntensity: 0.9,
    fog: '#1a2d5c', waterDeep: '#0a1a4a', waterShallow: '#2e7fb5', exposure: 1.15,
    cloud: '#5b6da3', stars: 1,
  },
};

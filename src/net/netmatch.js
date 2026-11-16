// Guest-side stand-in for Match during online play.
// The host runs the real simulation and streams snapshots + events; the guest
// applies them and predicts ahead locally between snapshots so motion stays smooth.
import { FIXED_DT, STYLES } from '../config.js';
import { createWorld, stepWorld } from '../game/physics.js';

const IDLE = { move: 0, jump: false, dash: false, bump: false };
const PLAYER_KEYS = ['x', 'y', 'vx', 'vy', 'r', 'onGround', 'facing', 'dashT', 'dashCd', 'dashDir', 'bumpT', 'bumpCd', 'move', 'power', 'bigT', 'fastT', 'slowT'];
const BALL_KEYS = ['x', 'y', 'vx', 'vy', 'held', 'spin', 'dead', 'fire', 'moonT', 'hitCd'];

const pick = (o, keys) => keys.map((k) => (typeof o[k] === 'number' ? Math.round(o[k] * 100) / 100 : o[k]));
const unpick = (target, arr, keys) => keys.forEach((k, i) => { target[k] = arr[i]; });

// host -> guest
export function makeSnapshot(match, hostInput, events) {
  const w = match.world;
  return {
    t: 's', p: w.players.map((p) => pick(p, PLAYER_KEYS)), b: pick(w.ball, BALL_KEYS), k: w.pickup, lh: w.lastHit, tc: w.touches, td: w.touchCd,
    sc: match.score, ph: match.phase, w: match.winner, st: match.phase === 'over' || match.winner >= 0 ? match.stats : null,
    in: hostInput, ev: events,
  };
}

export class NetMatch {
  constructor({ target = 7, style = 'classic', side = 1, onEvent = () => {} } = {}) {
    this.world = createWorld(STYLES[style] || STYLES.classic);
    this.target = target;
    this.side = side;                       // which player this client controls
    this.onEvent = onEvent;
    this.score = [0, 0];
    this.phase = 'serve';
    this.winner = -1;
    this.stats = { longestRally: 0, hits: [0, 0], jumps: [0, 0], supers: [0, 0], spikes: [0, 0], faults: [0, 0], topSpeed: 0, duration: 0, rallies: 0 };
    this.queue = [];
    this.hostInput = IDLE;
  }

  start() { /* the host decides when the match starts */ }
  receive(snap) { this.queue.push(snap); }

  apply(snap) {
    const w = this.world;
    snap.p.forEach((arr, i) => {
      const p = w.players[i];
      if (i !== this.side) { unpick(p, arr, PLAYER_KEYS); return; }
      // our own blob: keep the locally predicted motion unless it drifted too far
      const sx = arr[0], sy = arr[1];
      const lx = p.x, ly = p.y, lvx = p.vx, lvy = p.vy, lg = p.onGround, ldt = p.dashT, ldd = p.dashDir;
      unpick(p, arr, PLAYER_KEYS);
      if (Math.abs(sx - lx) < 70 && Math.abs(sy - ly) < 70) {
        p.x = lx + (sx - lx) * 0.15; p.y = ly + (sy - ly) * 0.15;
        p.vx = lvx; p.vy = lvy; p.onGround = lg; p.dashT = ldt; p.dashDir = ldd;
      }
    });
    unpick(w.ball, snap.b, BALL_KEYS);
    w.pickup = snap.k; w.lastHit = snap.lh; w.touches = snap.tc; w.touchCd = snap.td;
    this.score = snap.sc; this.phase = snap.ph; this.winner = snap.w;
    if (snap.st) this.stats = snap.st;
    this.hostInput = snap.in || IDLE;
    for (const e of snap.ev) this.onEvent(e);
  }

  step(inputs) {
    while (this.queue.length) this.apply(this.queue.shift());
    const w = this.world;
    const mine = inputs[this.side] || IDLE;
    const ins = this.side === 1 ? [this.hostInput, mine] : [mine, this.hostInput];
    stepWorld(w, ins, FIXED_DT);            // prediction only: the host's events are the real ones
    w.events.length = 0;
  }
}

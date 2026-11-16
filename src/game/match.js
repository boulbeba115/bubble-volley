// Match rules: serving, rallies, scoring, win condition and statistics.
import { FIXED_DT, NET_X, GROUND_Y, POWERUPS, STYLES, MUTATORS, DEUCE_CAP, COMEBACK_GAP, COMEBACK_BOOST } from '../config.js';
import { createWorld, makeRules, resetPositions, stepWorld } from './physics.js';

export class Match {
  constructor({ target = 7, powerups = true, style = 'classic', onEvent = () => {} } = {}) {
    const st = STYLES[style] || STYLES.classic;
    this.party = !!st.party;
    this.mutator = -1;
    this.rulePoints = -1;
    this.basePowerups = powerups;
    this.powerups = powerups || !!st.pickupEvery;
    this.pickupEvery = st.pickupEvery || 0;
    this.pickupTimer = this.pickupEvery ? 1.5 : 4 + Math.random() * 3;
    this.world = createWorld(st);
    this.target = target;
    this.onEvent = onEvent;
    this.score = [0, 0];
    this.phase = 'idle';          // idle | serve | play | point | over
    this.timer = 0;
    this.server = 0;
    this.rally = 0;
    this.lastHitSide = -1;
    this.time = 0;
    this.winner = -1;
    this.stats = { longestRally: 0, hits: [0, 0], jumps: [0, 0], supers: [0, 0], spikes: [0, 0], faults: [0, 0], topSpeed: 0, duration: 0, rallies: 0 };
  }

  start(server = Math.random() < 0.5 ? 0 : 1, delay = 1.0) {
    this.beginServe(server, delay);
  }

  // Party style: draw a new rule every two points.
  rollRule() {
    const points = this.score[0] + this.score[1];
    if (!this.party || points % 2 !== 0 || points === this.rulePoints) return;
    this.rulePoints = points;
    let i;
    do { i = Math.floor(Math.random() * MUTATORS.length); } while (i === this.mutator);
    this.mutator = i;
    const mu = MUTATORS[i];
    Object.assign(this.world.rules, makeRules(mu));
    this.pickupEvery = mu.pickupEvery || 0;
    this.powerups = this.basePowerups || !!mu.pickupEvery;
    if (this.pickupEvery) this.pickupTimer = 1.2;
    this.onEvent({ type: 'rule', label: mu.label });
  }

  beginServe(server, delay = 0.9) {
    this.server = server;
    this.rally = 0;
    this.lastHitSide = -1;
    this.rollRule();
    // comeback help: the side trailing by a few points charges its super meter faster
    for (const s of [0, 1]) this.world.boost[s] = this.score[1 - s] - this.score[s] >= COMEBACK_GAP ? COMEBACK_BOOST : 1;
    resetPositions(this.world, server);
    this.phase = 'serve';
    this.timer = delay;
    this.onEvent({ type: 'serve', side: server });
  }

  // win by two points; a hard cap keeps a deuce from going on forever
  hasWon(side) {
    const mine = this.score[side], theirs = this.score[1 - side];
    return (mine >= this.target && mine - theirs >= 2) || mine >= this.target + DEUCE_CAP;
  }

  step(inputs) {
    const w = this.world;
    const dt = FIXED_DT;
    w.events.length = 0;
    if (this.phase === 'idle' || this.phase === 'over') {
      stepWorld(w, inputs, dt);
      this.flush();
      return;
    }
    this.time += dt;
    if (this.phase === 'serve') {
      this.timer -= dt;
      w.ball.y = 190 + Math.sin(this.time * 5) * 5;
      if (this.timer <= 0) { w.ball.held = false; w.ball.vy = -60; this.phase = 'play'; this.onEvent({ type: 'drop' }); }
    }
    stepWorld(w, inputs, dt);
    if (this.phase === 'play') {
      this.stats.duration += dt;
      this.updatePickup(dt);
    }

    for (const e of w.events) {
      if (e.type === 'hit' && this.phase === 'play') {
        this.rally++;
        this.lastHitSide = e.side;
        this.stats.hits[e.side]++;
        this.stats.longestRally = Math.max(this.stats.longestRally, this.rally);
        this.stats.topSpeed = Math.max(this.stats.topSpeed, e.speed);
        if (e.spike) this.stats.spikes[e.side]++;
        e.rally = this.rally;
      } else if (e.type === 'super' && this.phase === 'play') {
        this.rally++;
        this.lastHitSide = e.side;
        this.stats.supers[e.side]++;
        this.stats.topSpeed = Math.max(this.stats.topSpeed, 1080);
      } else if (e.type === 'jump') {
        this.stats.jumps[e.side]++;
      } else if ((e.type === 'ground' || e.type === 'fault') && this.phase === 'play') {
        const scorer = 1 - e.side;
        if (e.type === 'fault') this.stats.faults[e.side]++;
        this.score[scorer]++;
        this.stats.rallies++;
        e.scorer = scorer;
        e.rally = this.rally;
        if (this.hasWon(scorer)) {
          this.phase = 'point'; this.timer = 2.2; this.winner = scorer;
        } else {
          this.phase = 'point'; this.timer = 1.7;
        }
        this.server = scorer;
      }
    }
    if (this.phase === 'point') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.winner >= 0) { this.phase = 'over'; this.onEvent({ type: 'over', winner: this.winner }); }
        else this.beginServe(this.server);
      }
    }
    this.flush();
  }

  updatePickup(dt) {
    if (!this.powerups) return;
    const w = this.world;
    if (w.pickup) {
      w.pickup.life -= dt;
      if (w.pickup.life <= 0) { w.events.push({ type: 'despawn', x: w.pickup.x, y: w.pickup.y }); w.pickup = null; }
      return;
    }
    this.pickupTimer -= dt;
    if (this.pickupTimer > 0) return;
    this.pickupTimer = this.pickupEvery ? this.pickupEvery * (0.7 + Math.random() * 0.6) : 6 + Math.random() * 6;
    const types = Object.keys(POWERUPS);
    w.pickup = {
      x: NET_X + (Math.random() - 0.5) * 560, y: GROUND_Y - 235 - Math.random() * 130, r: 30,
      type: types[Math.floor(Math.random() * types.length)], life: 9,
    };
    w.events.push({ type: 'spawn', kind: w.pickup.type, x: w.pickup.x, y: w.pickup.y });
  }

  flush() {
    for (const e of this.world.events) this.onEvent(e);
  }
}

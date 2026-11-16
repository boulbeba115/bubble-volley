// Bubble Volley — entry point and game-state orchestration.
import '@fontsource-variable/fredoka';
import './ui/styles.css';
import { FIXED_DT, MAX_SPEED, TEAM_COLORS, SKINS, DIFFICULTY, POWERUPS, CUP, wx, wy } from './config.js';
import { Match } from './game/match.js';
import { createAI, aiInput } from './game/ai.js';
import { Stage } from './render/stage.js';
import { Slime, BallView, PickupView } from './render/actors.js';
import { FX } from './render/fx.js';
import { AudioSys } from './audio/audio.js';
import { Input } from './input.js';
import { UI } from './ui/ui.js';
import { Net } from './net/net.js';
import { NetMatch, makeSnapshot } from './net/netmatch.js';
import { loadSave, writeSave, resetStats } from './storage.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const params = new URLSearchParams(location.search);
const save = loadSave();
if (params.get('arena')) save.setup.arena = params.get('arena');
if (params.get('style')) save.setup.style = params.get('style');      // debug: force a game style

const stage = new Stage(document.getElementById('game'));
const audio = new AudioSys(save.settings);
const input = new Input();
const net = new Net();
let fx, slimes, ballView, pickupView;

let app = 'loading';            // loading | menu | playing | paused | results
let game = null;                // current match context (also used for the menu demo)
let pendingOver = -1;
let slowT = 0, hitStop = 0, acc = 0, time = 0, last = performance.now();
const cup = { round: 0 };
let guestColor = SKINS[1];      // online: colour requested by the joining player
let snapBuffer = null;          // online guest: snapshots that arrive while the match screen is loading
const NO_INPUT = { move: 0, jump: false, dash: false, bump: false };
const CONFETTI = ['#3ea6ff', '#ff5b7a', '#ffd166', '#6fdc6a', '#ffffff', '#b693ff'];

const ui = new UI(save, {
  sound: (n) => audio[n]?.(),
  action: onAction,
  change: onChange,
});
input.bindTouch(document.getElementById('touch'));
input.onKey = (code) => {
  audio.unlock();
  if (code === 'Escape' || code === 'KeyP') {
    if (document.activeElement?.tagName === 'INPUT') return;
    if (app === 'playing') { if (ui.current === 'pause') resume(); else if (ui.current) ui.back(); else pause(); }
    else if (app === 'paused') { if (ui.current === 'pause') resume(); else ui.back(); }
    else if (app === 'menu' && ui.current !== 'title') { if (ui.current === 'online') net.close(); ui.back(); }
  }
  if (code === 'Enter' && ui.current === 'online' && document.activeElement?.id === 'joinCode') onAction('joinRoom');
};
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
window.addEventListener('resize', () => stage.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden && app === 'playing' && !game?.net) pause(); });

// ------------------------------------------------------------------ colours
const otherColor = (taken, wanted) => (wanted !== taken ? wanted : SKINS.find((c) => c !== taken));

function applyColors(c0, c1) {
  TEAM_COLORS[0] = c0; TEAM_COLORS[1] = c1;
  slimes?.forEach((s, i) => s.setColor(TEAM_COLORS[i]));
  document.documentElement.style.setProperty('--p0', c0);
  document.documentElement.style.setProperty('--p1', c1);
  stage.setTeamColors(c0, c1);
}

// ------------------------------------------------------------------ flow
function onChange(key, value) {
  if (key === 'arena') stage.setArena(value);
  if (key === 'quality') stage.setQuality(value);
  if (key === 'shake') stage.shakeEnabled = value;
  if (key === 'music' || key === 'sfx') audio.applyVolumes();
  if ((key === 'color0' || key === 'color1') && app === 'menu') {
    applyColors(save.setup.color0, otherColor(save.setup.color0, save.setup.color1));
  }
  writeSave(save);
}

function onAction(a) {
  audio.unlock();
  audio.setMusic(true);
  switch (a) {
    case 'play': ui.screen('setup', { push: true }); break;
    case 'help': ui.screen('help', { push: true }); break;
    case 'settings': ui.screen('settings', { push: true }); break;
    case 'back': ui.back(); break;
    case 'start': cup.round = 0; ui.wipe(() => beginMatch()); break;
    case 'pause': pause(); break;
    case 'resume': resume(); break;
    case 'restart':
      if (game?.net === 'host') startOnline();
      else if (game?.net === 'guest') { if (app === 'results') { net.send({ t: 'rematch' }); document.getElementById('rematchBtn').textContent = 'WAITING…'; } }
      else ui.wipe(() => beginMatch());
      break;
    case 'quit': net.close(); ui.wipe(() => toMenu()); break;
    case 'resetStats': resetStats(save); ui.refreshRecord(); break;
    case 'online': ui.screen('online', { push: true }); ui.online('choose'); break;
    case 'hostRoom': hostRoom(); break;
    case 'joinRoom': joinRoom(ui.joinCode()); break;
    case 'copyLink': navigator.clipboard?.writeText(document.getElementById('roomLink').value).then(() => ui.online('wait', { status: 'Link copied!' })); break;
    case 'leaveOnline': net.close(); ui.back(); break;
  }
}

// floating text at a world position
function popAt(text, x, y, cls) {
  const p = stage.project(x, y);
  ui.pop(text, p.x, p.y, cls);
}

// cfg: { demo, mode, difficulty, target, style, powerups, spectate, net, me, intro }
function startGame(cfg) {
  const opts = { target: cfg.target, powerups: cfg.powerups, style: cfg.style, onEvent };
  const match = cfg.net === 'guest' ? new NetMatch({ ...opts, side: 1 }) : new Match(opts);
  const ais = [null, null];
  if (cfg.demo || cfg.spectate) { ais[0] = createAI(0, DIFFICULTY.medium); ais[1] = createAI(1, DIFFICULTY.hard); }
  else if (cfg.mode === 'ai') ais[1] = createAI(1, cfg.skill || DIFFICULTY[cfg.difficulty]);
  game = {
    me: -1, ...cfg, match, ais, first: true, charged: [false, false],
    remoteInput: NO_INPUT, outEvents: [], tick: 0, sentInput: '',
  };
  pendingOver = -1; slowT = 0; hitStop = 0; acc = 0;
  fx.clear();
  slimes.forEach((s) => s.setMood('neutral'));
  match.start(undefined, cfg.demo ? 0.8 : 2.2);
}

// Show the court and start a match described by cfg (see startGame) plus { names, arena, c0, c1 }.
function launch(cfg) {
  applyColors(cfg.c0, cfg.c1);
  stage.setArena(cfg.arena);
  stage.mode = 'game';
  ui.setupHUD(cfg.names, cfg.target);
  ui.rule(cfg.chip || '');
  ui.hud(true);
  ui.screen(null);
  app = 'playing';
  startGame(cfg);
  if (cfg.net === 'guest' && snapBuffer) { snapBuffer.forEach((s) => game.match.receive(s)); snapBuffer = null; }
}

function beginMatch(spectate = false) {
  const s = save.setup;
  const base = { target: s.target, powerups: s.powerups, style: s.style, arena: s.arena, c0: s.color0, difficulty: s.difficulty };
  let cfg;
  if (spectate) {
    cfg = { ...base, mode: 'ai', spectate: true, names: ['CPU 1', 'CPU 2'], c1: otherColor(s.color0, s.color1) };
  } else if (s.mode === 'cup') {
    const r = CUP[cup.round];
    cfg = {
      ...base, mode: 'ai', cup: true, me: 0, names: ['YOU', r.name], difficulty: r.difficulty, arena: r.arena, style: r.style,
      c1: otherColor(s.color0, r.color), intro: 'VS ' + r.name, chip: r.name + ' · ' + r.tag, skill: { ...DIFFICULTY[r.difficulty], ...r.ai },
    };
  } else if (s.mode === 'pvp') {
    cfg = { ...base, mode: 'pvp', names: ['PLAYER 1', 'PLAYER 2'], c1: otherColor(s.color0, s.color1) };
  } else {
    cfg = { ...base, mode: 'ai', me: 0, names: ['YOU', 'CPU'], c1: otherColor(s.color0, SKINS[1]) };
  }
  launch(cfg);
}

function toMenu() {
  app = 'menu';
  stage.mode = 'menu';
  applyColors(save.setup.color0, otherColor(save.setup.color0, save.setup.color1));
  stage.setArena(save.setup.arena);
  ui.hud(false);
  ui.screen('title');
  startGame({ demo: true, mode: 'ai', target: 5, style: 'classic', powerups: true });
}

function pause() {
  if (app !== 'playing') return;
  if (!game.net) app = 'paused';          // an online match cannot be frozen; just show the menu
  ui.screen('pause');
}
function resume() {
  if (app === 'paused') app = 'playing';
  ui.screen(null);
  last = performance.now();
}

// ------------------------------------------------------------------ online
function hostRoom(fixedCode) {
  ui.online('wait', { code: '····', status: 'Creating room…' });
  net.host(fixedCode).then((code) => {
    ui.online('wait', { code, link: location.href.split(/[?#]/)[0] + '?room=' + code, status: 'Waiting for your friend…' });
  }).catch((err) => ui.online('choose', { status: 'Could not create a room (' + (err.type || err.message) + ').' }));
}

function joinRoom(code) {
  if (!/^[A-Z]{4}$/.test(code)) { ui.online('choose', { status: 'Enter the 4-letter room code.' }); return; }
  ui.online('choose', { status: 'Connecting…' });
  net.join(code).then(() => {
    ui.online('choose', { status: 'Connected! Starting…' });
    net.send({ t: 'hello', color: save.setup.color0 });
  }).catch((err) => ui.online('choose', { status: err.message }));
}

// host: start (or restart) the online match and tell the guest
function startOnline() {
  const s = save.setup;
  const shared = { target: s.target, powerups: s.powerups, style: s.style, arena: s.arena, c0: s.color0, c1: otherColor(s.color0, guestColor) };
  net.send({ t: 'start', cfg: shared });
  ui.wipe(() => launch({ ...shared, mode: 'online', net: 'host', me: 0, names: ['YOU', 'RIVAL'], intro: 'ONLINE!' }));
}

net.onMessage = (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (net.role === 'host') {
    if (msg.t === 'hello') { if (SKINS.includes(msg.color)) guestColor = msg.color; startOnline(); }
    else if (msg.t === 'i' && game?.net === 'host') game.remoteInput = { move: Math.sign(msg.m) || 0, jump: !!msg.j, dash: !!msg.d, bump: !!msg.b };
    else if (msg.t === 'rematch' && app === 'results') startOnline();
  } else if (net.role === 'guest') {
    if (msg.t === 'start') {
      snapBuffer = [];
      ui.wipe(() => launch({ ...msg.cfg, mode: 'online', net: 'guest', me: 1, names: ['RIVAL', 'YOU'], intro: 'ONLINE!' }));
    } else if (msg.t === 's') {
      if (snapBuffer) snapBuffer.push(msg);
      else if (game?.net === 'guest') game.match.receive(msg);
    }
  }
};
net.onClose = () => {
  if (!game?.net) { if (ui.current === 'online') ui.online('choose', { status: 'Connection closed.' }); return; }
  net.close();
  ui.wipe(() => {
    toMenu();
    ui.screen('online', { push: true });
    ui.online('choose', { status: 'Your opponent left the match.' });
  });
};

// ------------------------------------------------------------------ results
function finish(winner) {
  const g = game, m = g.match;
  app = 'results';
  stage.mode = 'menu';
  const solo = g.me >= 0;                         // one local human with a side of their own
  const won = !solo || winner === g.me;
  const vsCPU = g.mode === 'ai' && !g.spectate;
  fx.celebrate(winner === 0 ? -2.3 : 2.3, CONFETTI);
  slimes[winner].setMood('happy');
  stage.cheer();
  audio.cheer();
  if (won) audio.win(); else audio.lose();

  const st = save.stats;
  st.bestRally = Math.max(st.bestRally, m.stats.longestRally);
  if (vsCPU) {
    st.played++;
    if (won) { st.wins++; st.byDifficulty[g.difficulty]++; } else st.losses++;
  }
  const unlock = (id) => (save.unlocks[id] ? false : (save.unlocks[id] = true));
  let unlocked = !g.spectate && m.stats.longestRally >= 15 && unlock('rally');
  let title, next = 'REMATCH';
  if (g.spectate) title = `CPU ${winner + 1} WINS!`;
  else if (g.cup) {
    const rival = CUP[cup.round], last = cup.round === CUP.length - 1;
    if (won && last) {
      title = '🏆 CHAMPION!'; next = 'NEW CUP'; st.cups++; cup.round = 0;
      unlocked = unlock('cup') || unlocked;
      fx.celebrate(-2.3, CONFETTI); fx.celebrate(2.3, CONFETTI); fx.celebrate(0, CONFETTI);
    } else if (won) { title = `YOU BEAT ${rival.name}!`; cup.round++; next = 'NEXT: ' + CUP[cup.round].name; }
    else { title = 'KNOCKED OUT'; next = 'TRY AGAIN'; }
  } else if (g.net) title = won ? 'YOU WIN!' : 'YOU LOSE';
  else if (vsCPU) title = won ? 'YOU WIN!' : 'CPU WINS';
  else title = `PLAYER ${winner + 1} WINS!`;
  writeSave(save);

  const secs = Math.round(m.stats.duration);
  setTimeout(() => {
    if (game !== g || app !== 'results') return;
    ui.hud(false);
    ui.results({
      title, next, cls: 't' + winner, score: m.score, note: unlocked ? '🔓 New blob colour unlocked!' : '',
      stats: [
        [`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, 'Match time'],
        [m.stats.longestRally, 'Longest rally'],
        [`${m.stats.spikes[0] + m.stats.supers[0]} / ${m.stats.spikes[1] + m.stats.supers[1]}`, 'Spikes'],
        [Math.round(m.stats.topSpeed / 9) + ' km/h', 'Top speed'],
      ],
    });
  }, 1700);
}

// ------------------------------------------------------------------ game events
function onEvent(e) {
  const g = game, m = g.match, quiet = g.demo;
  if (g.net === 'host') g.outEvents.push(e);
  switch (e.type) {
    case 'serve':
      slimes.forEach((s) => s.setMood('neutral'));
      if (quiet) break;
      ui.setScore(m.score, e.side);
      ui.rally(0);
      if (g.first) { ui.banner(g.intro || 'READY?', g.intro ? 'small' : '', 1.5); audio.count(false); }
      else if (g.newRule) ui.banner(g.newRule, 'gold small', 1.3);
      else {
        const [a, b] = m.score, near = m.target - 1;
        if (a >= near && b >= near && a === b) ui.banner('DEUCE!', 'gold small', 1.1);
        else if ((a >= near && a > b) || (b >= near && b > a)) ui.banner('MATCH POINT', 'gold small', 1.1);
        else if (Math.abs(a - b) >= 3) popAt('COMEBACK BOOST!', wx(m.world.players[a < b ? 0 : 1].x), 1.6, 'gold');
      }
      g.newRule = '';
      break;
    case 'drop':
      if (!quiet && g.first) { ui.banner('GO!', 'go', 0.8); audio.count(true); }
      g.first = false;
      break;
    case 'hit': {
      const power = clamp(e.speed / MAX_SPEED, 0, 1);
      const X = wx(e.x), Y = wy(e.y), sl = slimes[e.side];
      fx.hit(X, Y, TEAM_COLORS[e.side], power);
      fx.splat(X, Y, TEAM_COLORS[e.side], 4 + Math.floor(power * 6));
      sl.impulse(-2.5 - power * 3);
      sl.wobble((Math.random() < 0.5 ? -1 : 1) * (2 + power * 4));
      ballView.hit();
      if (e.blocked) fx.explode(X, Y, ['#ffc23d', '#ffffff', TEAM_COLORS[e.side]], 30, 5);
      if (quiet) break;
      if (e.blocked) { audio.block(); stage.addShake(0.2); popAt('BLOCKED!', X, Y + 0.5, 'p' + e.side); }
      else if (e.bump) { audio.bump(); fx.ring(X, Y, 0.2, '#ffffff', { from: 0.2, to: 0.8, life: 0.3 }); popAt('SET!', X, Y + 0.5, 'p' + e.side); }
      else if (e.spike === 1) { audio.bounce(0.9); popAt('DROP SHOT!', X, Y + 0.5, 'p' + e.side); }
      else if (e.spike || power > 0.82) {
        audio.smash(); stage.addShake(e.spike === 3 ? 0.2 : 0.14); if (!g.net) hitStop = 0.04;
        if (e.spike === 3) fx.ring(X, Y, 0.2, TEAM_COLORS[e.side], { from: 0.2, to: 1.5, life: 0.3 });
        popAt(e.spike === 3 ? 'POWER SPIKE!' : 'SPIKE!', X, Y + 0.5, 'p' + e.side);
      } else {
        audio.bounce(power);
        if (e.low) popAt(e.dashing ? 'DIVE SAVE!' : 'SAVE!', X, Y + 0.5, 'p' + e.side);
      }
      if (e.charged && !g.charged[e.side]) { audio.charged(); popAt('SUPER READY!', X, Y + 0.9, 'gold'); }
      g.charged[e.side] = e.charged;
      if (e.rally) {
        ui.rally(e.rally);
        if (e.rally === 12) ui.banner('SUPER RALLY!', 'gold small', 1.0);
        if (e.rally === 25) ui.banner('UNSTOPPABLE!', 'gold small', 1.0);
      }
      break;
    }
    case 'super': {
      const X = wx(e.x), Y = wy(e.y);
      g.charged[e.side] = false;
      fx.explode(X, Y, ['#ff7a2d', '#ffc23d', '#fff3b0', TEAM_COLORS[e.side]], 60, 8);
      slimes[e.side].impulse(-5); slimes[e.side].wobble(6);
      ballView.hit();
      if (quiet) break;
      audio.superSpike();
      stage.addShake(0.4); stage.punch = 0.7; hitStop = g.net ? 0 : 0.13;
      ui.flash('#ffb060');
      ui.banner('SUPER SPIKE!', 'fire small', 0.9);
      break;
    }
    case 'rule':                      // party style drew a new rule
      g.newRule = e.label;
      if (!quiet) { ui.rule(e.label); audio.charged(); }
      break;
    case 'bumpReady': slimes[e.side].impulse(3.2); break;
    case 'fault': {
      // a fourth touch: the point goes to the other side
      const X = wx(e.x), Y = wy(e.y);
      fx.explode(X, Y, ['#ffffff', TEAM_COLORS[e.side]], 24, 4);
      if (!quiet) { audio.fault(); popAt('4 TOUCHES!', X, Y + 0.6, 'fire'); }
      scored(e, g, m, quiet);
      break;
    }
    case 'dash': {
      const sl = slimes[e.side];
      fx.dash(wx(e.x), wy(e.y), e.dir, TEAM_COLORS[e.side]);
      sl.kick(-e.dir * 5); sl.impulse(-2.5);
      if (!quiet) audio.dash();
      break;
    }
    case 'spawn':
      fx.ring(wx(e.x), wy(e.y), 0.2, POWERUPS[e.kind].color, { from: 1.4, to: 0.3, life: 0.4 });
      if (!quiet) audio.spawn();
      break;
    case 'despawn': fx.pop(wx(e.x), wy(e.y), '#ffffff'); break;
    case 'pickup': {
      const pu = POWERUPS[e.kind];
      fx.pop(wx(e.x), wy(e.y), pu.color);
      // slow hits the rival, everything else boosts the side that popped the bubble
      const who = e.kind === 'slow' ? 1 - e.side : e.side;
      slimes[who].wobble(7); slimes[who].impulse(e.kind === 'slow' ? -4 : 4);
      if (e.kind !== 'moon') fx.burst(wx(m.world.players[who].x), 0.8, [pu.color, '#ffffff']);
      if (quiet) break;
      audio.pickup();
      if (e.kind === 'power') { audio.charged(); g.charged[e.side] = true; }
      popAt(pu.icon + ' ' + pu.label, wx(e.x), wy(e.y), 'gold');
      break;
    }
    case 'wall': fx.wallPuff(wx(e.x), wy(e.y)); if (!quiet) audio.wall(); break;
    case 'net': stage.kickNet((e.x < 460 ? 1 : -1) * Math.min(1.5, e.speed / 300)); if (!quiet) audio.net(); break;
    case 'jump': fx.sand(wx(e.x), 0.6); slimes[e.side].impulse(2.6); if (!quiet) audio.jump(); break;
    case 'land': fx.sand(wx(e.x), Math.min(1.4, e.speed / 450)); slimes[e.side].impulse(-e.speed / 150); if (!quiet) audio.land(e.speed / 800); break;
    case 'thud': fx.sand(wx(e.x), 0.5); if (!quiet) audio.land(0.3); break;
    case 'ground': {
      const X = wx(e.x);
      fx.sand(X, 2.4);
      fx.ring(X, 0.05, 0, '#ffffff', { flat: true, from: 0.2, to: 1.7, life: 0.5 });
      if (e.fire) {
        fx.explode(X, 0.25, ['#ff7a2d', '#ffc23d', '#fff3b0', '#f6e2b3'], 70, 9);
        fx.sand(X, 3);
        if (!quiet) { audio.boom(); ui.flash('#ffd0a0'); stage.addShake(0.3); }
      }
      if (!quiet && e.scorer != null) audio.sandHit();
      scored(e, g, m, quiet);
      break;
    }
    case 'over': pendingOver = e.winner; break;
  }
}

// a point was just won (ball landed, or the other side used a fourth touch)
function scored(e, g, m, quiet) {
  if (e.scorer == null) return;
  slimes[e.scorer].setMood('happy'); slimes[1 - e.scorer].setMood('sad');
  slimes[1 - e.scorer].wobble(5);
  stage.cheer();
  fx.burst(wx(m.world.players[e.scorer].x), 1.4, [TEAM_COLORS[e.scorer], '#ffffff', '#ffd166']);
  if (quiet) return;
  stage.addShake(0.32); stage.punch = 0.5;
  if (!g.net) slowT = 0.5;                        // no slow motion online: both clients must stay in step
  audio.whistle();
  const final = m.winner >= 0;
  audio.point(g.me < 0 || e.scorer === g.me);
  ui.setScore(m.score, e.scorer, e.scorer);
  ui.rally(0);
  const text = final ? 'GAME!' : e.type === 'fault' ? 'FAULT!' : e.rally <= 1 ? 'ACE!' : 'POINT!';
  ui.banner(text, 'p' + e.scorer, final ? 1.8 : 1.15);
}

// ------------------------------------------------------------------ main loop
function localInputs(g, m) {
  if (g.net === 'host') return [input.player(0, false), g.remoteInput];
  if (g.net === 'guest') {
    const mine = input.player(0, false);
    const key = `${mine.move}|${mine.jump}|${mine.dash}|${mine.bump}`;
    if (key !== g.sentInput || g.tick % 12 === 0) { g.sentInput = key; net.send({ t: 'i', m: mine.move, j: mine.jump, d: mine.dash, b: mine.bump }); }
    return [NO_INPUT, mine];
  }
  return [0, 1].map((i) => {
    if (g.ais[i]) return m.phase === 'over' ? NO_INPUT : aiInput(g.ais[i], m.world, FIXED_DT);
    return app === 'playing' ? input.player(i, g.mode === 'pvp') : NO_INPUT;
  });
}

function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (app === 'loading' || !game) return;

  let scale = 1;
  if (app === 'paused') scale = 0;
  else if (hitStop > 0) { hitStop -= real; scale = 0; }
  else if (slowT > 0) { slowT -= real; scale = 0.3; }
  const dt = real * scale;
  time += real;

  const g = game, m = g.match, w = m.world;
  if (scale > 0) {
    acc += dt;
    while (acc >= FIXED_DT) {
      acc -= FIXED_DT;
      const inp = localInputs(g, m);
      m.step(inp);
      g.tick++;
      if (g.net === 'host' && (g.tick % 4 === 0 || pendingOver >= 0)) {      // 30 snapshots per second
        net.send(makeSnapshot(m, inp[0], g.outEvents));
        g.outEvents = [];
      }
      if (pendingOver >= 0) break;
    }
    const b = w.ball;
    const sp = Math.hypot(b.vx, b.vy);
    if (b.fire) fx.flame(wx(b.x), wy(b.y), b.vx * 0.01, -b.vy * 0.01);
    else if (!b.held && !b.dead && sp > 400) fx.trail(wx(b.x), wy(b.y), sp / MAX_SPEED);
    else if (b.moonT > 0 && !b.held && Math.random() < 0.4) fx.sparkle(wx(b.x), wy(b.y) - 0.5, '#bfe6ff');
    w.players.forEach((p, i) => {
      if (p.power >= 1 && Math.random() < 0.5) fx.sparkle(wx(p.x), wy(p.y), Math.random() < 0.5 ? '#ffc23d' : '#fff3b0');
      if (p.fastT > 0 && Math.abs(p.vx) > 200 && Math.random() < 0.5) fx.sparkle(wx(p.x), wy(p.y) - 0.3, POWERUPS.fast.color);
      if (!g.demo) { ui.power(i, p.power); ui.touches(i, w.ball.dead || w.ball.held ? 0 : w.touches[i]); }
    });
  }
  if (pendingOver >= 0) {
    const win = pendingOver; pendingOver = -1;
    if (g.demo) startGame({ demo: true, mode: 'ai', target: 5, style: 'classic', powerups: true }); else finish(win);
  }

  const world = game.match.world;
  slimes.forEach((s, i) => s.update(dt, time, world.players[i], world.ball));
  ballView.update(dt, world.ball);
  pickupView.update(dt, time, world.pickup);
  fx.update(dt);
  stage.update(real, time, wx(world.ball.x));
  stage.render();

  if (app === 'playing') {
    const p = stage.project(wx(world.ball.x), wy(world.ball.y) - 0.24);
    ui.ballMarker(p.y < 0 ? p.x : null);
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  ui.loading(0.1);
  await Promise.all([
    stage.load((p) => ui.loading(0.1 + p * 0.8, p < 1 ? 'Raking the sand…' : 'Ready!')),
    document.fonts?.ready,
  ]);
  fx = new FX(stage.scene);
  slimes = [new Slime(stage.models.slime, 0), new Slime(stage.models.slime, 1)];
  ballView = new BallView(stage.models.ball);
  pickupView = new PickupView();
  for (const s of slimes) stage.scene.add(s.root, s.shadow, s.ring);
  stage.scene.add(ballView.root, ballView.shadow, pickupView.root);
  stage.setQuality(save.settings.quality);
  stage.shakeEnabled = save.settings.shake;
  ui.loading(1, 'Ready!');
  toMenu();

  // invite link: ...?room=ABCD joins that room straight away
  const room = (params.get('room') || '').toUpperCase();
  if (room) { ui.screen('online', { push: true }); ui.online('choose'); document.getElementById('joinCode').value = room; joinRoom(room); }

  if (params.get('hostcode')) { ui.screen('online', { push: true }); hostRoom(params.get('hostcode').toUpperCase()); }
  window.__bv = { net, get game() { return game; }, get app() { return app; } };
  // debug helpers: ?autoplay (watch CPU vs CPU), &warp=N (skip N seconds), &test=<powerup>, ?screen=<name>
  if (params.has('autoplay')) beginMatch(true);
  for (let i = 0, n = Number(params.get('warp') || 0) * 120; i < n && pendingOver < 0; i++) {
    game.match.step(game.ais.map((ai) => aiInput(ai, game.match.world, FIXED_DT)));
  }
  if (params.has('warp')) fx.clear();
  if (params.has('test')) {
    const w = game.match.world;
    w.pickup = { x: 560, y: 250, r: 30, type: params.get('test') || 'fast', life: 99 };
    w.players[0].power = 1; w.players[1].bigT = 99;
  }
  if (params.get('screen')) { ui.screen(params.get('screen'), { push: true }); if (params.get('screen') === 'online') ui.online('choose'); }
  last = performance.now();
  requestAnimationFrame(frame);
}
boot().catch((err) => {
  console.error(err);
  ui.loading(0, 'Could not start: ' + err.message);
});

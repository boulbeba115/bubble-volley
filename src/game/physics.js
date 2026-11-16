// Pure simulation — no DOM, no rendering. Deterministic given inputs.
import {
  W, GROUND_Y, NET_X, NET_TOP, NET_R, BUBBLE_R, BALL_R, GRAVITY, BALL_GRAVITY,
  WALL_RESTITUTION, BALL_RESTITUTION, MAX_SPEED, SUPER_SPEED, PLAYER_SPEED, JUMP_FORCE,
  DASH_SPEED, DASH_TIME, DASH_CD, POWER_PER_HIT, MAX_TOUCHES, BUMP_WINDOW, BUMP_CD,
} from '../config.js';

const HOME = [NET_X - 230, NET_X + 230];

export function createWorld(style = {}) {
  const rules = { ballG: style.ballG || 1, playerG: style.playerG || 1, ballR: style.ballR || BALL_R, powerGain: style.powerGain || 1 };
  return {
    rules,
    players: [makePlayer(0), makePlayer(1)],
    ball: { x: NET_X, y: 150, vx: 0, vy: 0, r: rules.ballR, held: true, spin: 0, hitCd: 0, dead: false, fire: false, moonT: 0 },
    pickup: null,           // { x, y, r, type, life }
    lastHit: -1,
    touches: [0, 0],        // consecutive touches by each side since the ball last crossed the net
    touchCd: 0,             // contacts closer together than this count as one touch
    events: [],
  };
}

function makePlayer(side) {
  return {
    side, x: HOME[side], y: GROUND_Y, r: BUBBLE_R, vx: 0, vy: 0, onGround: true, speedMul: 1,
    facing: side === 0 ? 1 : -1, dashT: 0, dashCd: 0, dashDir: 0, dashHeld: false,
    bumpT: 0, bumpCd: 0, bumpHeld: false, move: 0,
    power: 0, bigT: 0, fastT: 0, slowT: 0,
  };
}

export function resetPositions(world, serverSide) {
  world.players.forEach((p, i) => { p.x = HOME[i]; p.y = GROUND_Y; p.vx = p.vy = 0; p.onGround = true; p.dashT = 0; p.bumpT = 0; });
  const b = world.ball;
  b.x = HOME[serverSide]; b.y = 190; b.vx = 0; b.vy = 0; b.held = true; b.dead = false; b.spin = 0; b.fire = false;
  world.lastHit = -1;
  world.touches[0] = world.touches[1] = 0;
  world.pickup = null;
}

export function applyPickup(world, type, side) {
  const me = world.players[side], foe = world.players[1 - side];
  if (type === 'big') me.bigT = 9;
  else if (type === 'fast') me.fastT = 9;
  else if (type === 'slow') foe.slowT = 6;
  else if (type === 'moon') world.ball.moonT = 9;
  else if (type === 'power') me.power = 1;
}

function clampSpeed(b) {
  const cap = b.fire ? SUPER_SPEED : MAX_SPEED;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > cap) { const k = cap / sp; b.vx *= k; b.vy *= k; }
}

function stepPlayer(world, p, input, dt) {
  p.dashCd -= dt; p.bumpCd -= dt;
  p.bumpT = Math.max(0, p.bumpT - dt);
  p.bigT = Math.max(0, p.bigT - dt); p.fastT = Math.max(0, p.fastT - dt); p.slowT = Math.max(0, p.slowT - dt);
  const targetR = BUBBLE_R * (p.bigT > 0 ? 1.4 : 1);
  p.r += (targetR - p.r) * Math.min(1, 8 * dt);
  p.move = input.move || 0;
  if (input.move) p.facing = Math.sign(input.move);

  if (input.dash && !p.dashHeld && p.dashCd <= 0) {
    p.dashDir = p.facing; p.dashT = DASH_TIME; p.dashCd = DASH_CD;
    world.events.push({ type: 'dash', side: p.side, x: p.x, y: p.y, dir: p.dashDir });
  }
  p.dashHeld = !!input.dash;

  // bump: a short window in which the next touch becomes a soft, controlled set
  if (input.bump && !p.bumpHeld && p.bumpCd <= 0) {
    p.bumpT = BUMP_WINDOW; p.bumpCd = BUMP_CD;
    world.events.push({ type: 'bumpReady', side: p.side, x: p.x, y: p.y });
  }
  p.bumpHeld = !!input.bump;

  const mul = p.speedMul * (p.fastT > 0 ? 1.4 : 1) * (p.slowT > 0 ? 0.5 : 1);
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.vx = p.dashDir * DASH_SPEED * (p.slowT > 0 ? 0.6 : 1);
  } else {
    const target = (input.move || 0) * PLAYER_SPEED * mul;
    p.vx += (target - p.vx) * Math.min(1, (input.move ? 22 : 16) * dt);
  }
  if (input.jump && p.onGround) {
    p.vy = JUMP_FORCE; p.onGround = false;
    world.events.push({ type: 'jump', side: p.side, x: p.x });
  }
  p.vy += GRAVITY * world.rules.playerG * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (p.y >= GROUND_Y) {
    if (!p.onGround) world.events.push({ type: 'land', side: p.side, x: p.x, speed: p.vy });
    p.y = GROUND_Y; p.vy = 0; p.onGround = true;
  }
  const gap = NET_R + 4;
  if (p.side === 0) p.x = Math.max(p.r + 4, Math.min(NET_X - p.r - gap, p.x));
  else p.x = Math.max(NET_X + p.r + gap, Math.min(W - p.r - 4, p.x));
}

// A charged player who hits the ball in mid-air fires it at the other court.
function superSpike(world, ball, p) {
  const dir = p.side === 0 ? 1 : -1;
  let tx = NET_X + dir * (140 + Math.random() * 230), ty = GROUND_Y;
  let dx = tx - ball.x, dy = ty - ball.y;
  const yAtNet = ball.y + dy * ((NET_X - ball.x) / dx);
  if (yAtNet > NET_TOP - ball.r - 16) {           // too low: laser it just over the tape instead
    tx = NET_X + dir * 12; ty = NET_TOP - ball.r - 42;
    dx = tx - ball.x; dy = ty - ball.y;
  }
  const len = Math.hypot(dx, dy) || 1;
  ball.vx = dx / len * SUPER_SPEED; ball.vy = dy / len * SUPER_SPEED;
  ball.fire = true;
  p.power = 0;
  world.events.push({ type: 'super', side: p.side, x: ball.x, y: ball.y });
}

// Aimed spike: a jumping player drives the ball just over the tape.
// Holding toward the net = hard and deep, neutral = medium, holding away = soft drop shot.
function trySpike(world, ball, p) {
  const dir = p.side === 0 ? 1 : -1;
  const aim = p.move * dir;                         // 1 forward, 0 neutral, -1 back
  const g = BALL_GRAVITY * world.rules.ballG * (ball.moonT > 0 ? 0.5 : 1);
  const d = Math.max(8, Math.abs(NET_X - ball.x));
  // try the requested shot first, then stronger ones if it cannot reach the net from here
  const shots = aim > 0 ? [[740, 3]] : aim < 0 ? [[360, 1], [600, 2], [740, 3]] : [[600, 2], [740, 3]];
  for (const [S, kind] of shots) {
    const up = ball.y - (NET_TOP - ball.r - 26 - (kind === 1 ? 30 : 0));   // tape-clearing point, relative to the ball
    // flattest launch angle that passes through that point (projectile through a point)
    const S2 = S * S, disc = S2 * S2 - g * (g * d * d + 2 * up * S2);
    if (disc < 0) continue;                         // out of reach at this speed
    const tan = (S2 - Math.sqrt(disc)) / (g * d);
    if (tan > 1.1) continue;                        // ball is too low to drive over the net
    const cos = 1 / Math.sqrt(1 + tan * tan);
    ball.vx = dir * S * cos; ball.vy = -S * cos * tan;
    return kind;                                    // 3 = power, 2 = spike, 1 = drop
  }
  return 0;                                         // no spike possible: normal bounce
}

// Player is a half disc (dome) sitting on its flat base at p.y.
function collidePlayer(world, ball, p) {
  let cx, cy, rad;
  if (ball.y <= p.y) { cx = p.x; cy = p.y; rad = p.r; }
  else { cx = Math.max(p.x - p.r, Math.min(p.x + p.r, ball.x)); cy = p.y; rad = 0; }
  let dx = ball.x - cx, dy = ball.y - cy;
  let dist = Math.hypot(dx, dy);
  const minDist = ball.r + rad;
  if (dist >= minDist) return;
  if (dist < 1e-4) { dx = 0; dy = -1; dist = 1; }
  const nx = dx / dist, ny = dy / dist;
  ball.x = cx + nx * minDist; ball.y = cy + ny * minDist;
  const velN = (ball.vx - p.vx) * nx + (ball.vy - p.vy) * ny;
  if (velN >= 0) return;

  const above = ball.y < p.y;
  const solid = ball.hitCd <= 0 && (velN < -45 || p.bumpT > 0);   // a real touch, not the ball resting on us
  if (!solid) {
    ball.vx -= (1 + BALL_RESTITUTION) * velN * nx; ball.vy -= (1 + BALL_RESTITUTION) * velN * ny;
    clampSpeed(ball);
    return;
  }

  // --- touch rule: at most MAX_TOUCHES per side before the ball must cross the net
  if (world.touchCd <= 0 || world.lastHit !== p.side) {
    world.touches[p.side]++;
    world.touchCd = 0.25;
    if (world.touches[p.side] > MAX_TOUCHES) {
      ball.dead = true; ball.fire = false;
      ball.vx *= 0.3; ball.vy = Math.min(ball.vy, -120);
      world.events.push({ type: 'fault', side: p.side, x: ball.x, y: ball.y });
      return;
    }
  }
  world.lastHit = p.side;
  ball.hitCd = 0.09;

  if (p.power >= 1 && !p.onGround && above) { superSpike(world, ball, p); return; }

  const wasFire = ball.fire;
  let bump = false, spike = 0;
  if (p.bumpT > 0 && above) {
    // soft set: straight up with a little drift, perfect for a follow-up spike
    ball.vx = ball.vx * 0.12 + p.vx * 0.3;
    ball.vy = -590;
    p.bumpT = 0; bump = true;
  } else if (!p.onGround && above) {
    spike = trySpike(world, ball, p);
  }
  if (!bump && !spike) {
    const j = -(1 + BALL_RESTITUTION) * velN;
    ball.vx += j * nx + p.vx * 0.4;
    ball.vy += j * ny + p.vy * 0.4;
  }
  ball.fire = false;
  clampSpeed(ball);
  ball.spin = (ball.vx * 0.012) + (p.vx * 0.01);
  p.power = Math.min(1, p.power + POWER_PER_HIT * world.rules.powerGain);
  world.events.push({
    type: 'hit', side: p.side, x: ball.x - nx * ball.r, y: ball.y - ny * ball.r,
    speed: Math.hypot(ball.vx, ball.vy), blocked: wasFire, low: GROUND_Y - ball.y < 70, dashing: p.dashT > 0,
    charged: p.power >= 1, bump, spike, touches: world.touches[p.side],
  });
}

function collideNet(world, ball) {
  const top = NET_TOP + NET_R;
  const cy = Math.max(top, Math.min(GROUND_Y, ball.y));
  let dx = ball.x - NET_X, dy = ball.y - cy;
  let dist = Math.hypot(dx, dy);
  const minDist = ball.r + NET_R;
  if (dist >= minDist) return;
  if (dist < 1e-4) { dx = ball.vx > 0 ? -1 : 1; dy = 0; dist = 1; }
  const nx = dx / dist, ny = dy / dist;
  ball.x = NET_X + nx * minDist; ball.y = cy + ny * minDist;
  const velN = ball.vx * nx + ball.vy * ny;
  if (velN < 0) {
    ball.vx -= (1 + WALL_RESTITUTION) * velN * nx;
    ball.vy -= (1 + WALL_RESTITUTION) * velN * ny;
    if (velN < -60) world.events.push({ type: 'net', x: ball.x, y: ball.y, speed: -velN });
  }
}

function stepBall(world, dt) {
  const ball = world.ball;
  if (ball.held) return;
  ball.hitCd -= dt;
  world.touchCd -= dt;
  ball.moonT = Math.max(0, ball.moonT - dt);
  ball.vy += BALL_GRAVITY * world.rules.ballG * (ball.moonT > 0 ? 0.5 : 1) * dt;
  const drag = Math.pow(0.996, dt * 60);
  ball.vx *= drag; ball.vy *= drag;
  const sideBefore = ball.x < NET_X;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.x - ball.r < 0) {
    ball.x = ball.r; ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
    world.events.push({ type: 'wall', x: 0, y: ball.y, speed: Math.abs(ball.vx) });
  } else if (ball.x + ball.r > W) {
    ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
    world.events.push({ type: 'wall', x: W, y: ball.y, speed: Math.abs(ball.vx) });
  }
  collideNet(world, ball);
  if ((ball.x < NET_X) !== sideBefore) { world.touches[0] = world.touches[1] = 0; }   // crossed the net
  if (!ball.dead) for (const p of world.players) collidePlayer(world, ball, p);
  clampSpeed(ball);

  const pk = world.pickup;
  if (pk && !ball.dead && Math.hypot(ball.x - pk.x, ball.y - pk.y) < ball.r + pk.r) {
    const side = world.lastHit >= 0 ? world.lastHit : (ball.x < NET_X ? 0 : 1);
    applyPickup(world, pk.type, side);
    world.events.push({ type: 'pickup', kind: pk.type, side, x: pk.x, y: pk.y });
    world.pickup = null;
  }

  if (ball.y + ball.r >= GROUND_Y) {
    ball.y = GROUND_Y - ball.r;
    const impact = ball.vy;
    if (!ball.dead) {
      ball.dead = true;
      world.events.push({ type: 'ground', side: ball.x < NET_X ? 0 : 1, x: ball.x, speed: impact, fire: ball.fire });
      ball.fire = false;
    } else if (impact > 80) {
      world.events.push({ type: 'thud', x: ball.x, speed: impact });
    }
    ball.vy = -Math.abs(ball.vy) * 0.55;
    ball.vx *= 0.8;
    if (Math.abs(ball.vy) < 40) ball.vy = 0;
  }
  ball.spin += (ball.vx * 0.012 - ball.spin) * Math.min(1, 1.5 * dt);
}

export function stepWorld(world, inputs, dt) {
  stepPlayer(world, world.players[0], inputs[0], dt);
  stepPlayer(world, world.players[1], inputs[1], dt);
  stepBall(world, dt);
}

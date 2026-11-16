// Computer opponent. Works for either side by mirroring the court so the
// logic can always think "I am on the right, the net is on my left".
import { W, GROUND_Y, NET_X, BALL_GRAVITY, WALL_RESTITUTION } from '../config.js';


export function createAI(side, skill) {
  return { side, skill, err: 0, lastDir: 0, wait: 0, smash: false, touches: 0, prevVy: 0 };
}

function predict(bx, by, vx, vy, g, HIT_Y, BALL_R) {
  const dt = 1 / 60;
  for (let i = 0; i < 400; i++) {
    vy += g * dt; vx *= 0.996; vy *= 0.996;
    bx += vx * dt; by += vy * dt;
    if (bx < BALL_R) { bx = BALL_R; vx = Math.abs(vx) * WALL_RESTITUTION; }
    if (bx > W - BALL_R) { bx = W - BALL_R; vx = -Math.abs(vx) * WALL_RESTITUTION; }
    if (vy > 0 && by >= HIT_Y) return { x: bx, t: i * dt };
  }
  return { x: bx, t: 99 };
}

export function aiInput(ai, world, dt) {
  const m = ai.side === 1 ? 1 : -1;                 // mirror factor
  const mx = (x) => (m === 1 ? x : W - x);
  const me = world.players[ai.side];
  const b = world.ball;
  const sk = ai.skill;
  const out = { move: 0, jump: false, dash: false };
  const R = me.r, BALL_R = b.r;

  const bx = mx(b.x), bvx = b.vx * m, px = mx(me.x);
  const dir = Math.sign(bvx);
  // re-roll the aiming error whenever the ball changes direction (new shot)
  if (dir !== ai.lastDir) {
    ai.lastDir = dir;
    ai.err = (Math.random() * 2 - 1) * sk.noise;
    // every now and then misjudge the ball badly — this is what loses points
    if (Math.random() < sk.blunder) ai.err = (Math.random() < 0.5 ? -1 : 1) * (95 + Math.random() * 70);
    ai.smash = Math.random() < sk.jump;
    ai.canDash = Math.random() < sk.dash;
    ai.wait = sk.react * (0.6 + Math.random() * 0.8);
  }
  if (ai.wait > 0) ai.wait -= dt;
  // count our own consecutive touches (ball bounced upward on our side)
  if (bx < NET_X || b.held || b.dead) ai.touches = 0;
  else if (ai.prevVy > 0 && b.vy < 0) ai.touches++;
  ai.prevVy = b.vy;
  const push = ai.touches > 0;     // ball is stuck on our side: get it over

  let target = NET_X + (W - NET_X) * 0.45;
  let incoming = false, eta = 99;
  if (b.held) {
    if (bx > NET_X) target = bx + sk.aim * 0.6;
  } else if (!b.dead) {
    const p = predict(bx, b.y, bvx, b.vy, BALL_GRAVITY * world.rules.ballG * (b.moonT > 0 ? 0.5 : 1), GROUND_Y - (R + BALL_R) * 0.92, BALL_R);
    eta = p.t;
    if (p.x > NET_X - 10) {
      incoming = true;
      // stand slightly behind the ball so it bounces back toward the net
      const closeToNet = p.x < NET_X + 120;
      target = p.x + (push ? 44 : (closeToNet ? sk.aim * 0.5 : sk.aim) + ai.err);
    }
  }
  const minX = NET_X + R + 10, maxX = W - R - 4;
  target = Math.max(minX, Math.min(maxX, target));

  if (ai.wait <= 0 || !incoming) {
    const diff = target - px;
    const dead = incoming ? 6 : 18;
    if (Math.abs(diff) > dead) out.move = Math.sign(diff) * Math.min(1, Math.abs(diff) / 30) * m;
    // dash when we would not make it on foot
    if (incoming && sk.dash && ai.canDash && me.dashCd <= 0 && Math.abs(diff) > 110 && Math.abs(diff) > eta * 330 * sk.speed) {
      out.move = Math.sign(diff) * m; out.dash = true;
    }
  }

  // jump to spike when the ball is dropping close above us
  if (incoming && (ai.smash || push || me.power >= 1) && me.onGround && b.vy > 0) {
    const dx = bx - px;
    const h = GROUND_Y - b.y;
    if (dx > -R * 0.9 && dx < R * 0.25 && h > R + 75 && h < R + 165) out.jump = true;
  }
  // ball resting on us / wedged against the net: pop it up
  if (!b.held && !b.dead && me.onGround && bx > NET_X && Math.hypot(b.vx, b.vy) < 70 &&
      Math.hypot(bx - px, b.y - me.y) < R + BALL_R + 6) out.jump = true;
  me.speedMul = sk.speed;
  return out;
}

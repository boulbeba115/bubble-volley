// Computer opponent. Works for either side by mirroring the court so the
// logic can always think "I am on the right, the net is on my left".
import { W, GROUND_Y, NET_X, BALL_GRAVITY, WALL_RESTITUTION, MAX_TOUCHES } from '../config.js';

export function createAI(side, skill) {
  return { side, skill, err: 0, lastDir: 0, wait: 0, smash: false, canDash: false, set: false, aim: 0, peak: 0, prevVy: 0 };
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
  const out = { move: 0, jump: false, dash: false, bump: false };
  const R = me.r, BALL_R = b.r;

  const bx = mx(b.x), bvx = b.vx * m, px = mx(me.x);
  const dir = Math.sign(bvx);
  // re-roll the plan whenever the ball changes direction (new shot)
  if (dir !== ai.lastDir) {
    ai.lastDir = dir;
    ai.err = (Math.random() * 2 - 1) * sk.noise;
    // every now and then misjudge the ball badly — this is what loses points
    if (Math.random() < sk.blunder) ai.err = (Math.random() < 0.5 ? -1 : 1) * (95 + Math.random() * 70);
    ai.smash = Math.random() < sk.jump;
    ai.canDash = Math.random() < sk.dash;
    ai.set = Math.random() < sk.set;                // receive with a soft set, then spike it
    ai.aim = Math.random() < 0.55 ? -1 : Math.random() < 0.6 ? 0 : 1;   // -1 = toward net (power), 1 = away (drop)
    ai.wait = sk.react * (0.6 + Math.random() * 0.8);
  }
  if (ai.wait > 0) ai.wait -= dt;

  // highest point of the current arc: a ball falling from low down has too little energy to jump-spike
  if (b.vy < 0 && ai.prevVy >= 0) ai.peak = 0;
  ai.prevVy = b.vy;
  ai.peak = Math.max(ai.peak, GROUND_Y - b.y);
  const lazy = b.held || ai.peak < R + 170;

  const used = world.touches[ai.side];              // touches our side has already spent
  const mustSend = used >= 1;                       // from the second touch on, get it over the net
  const lastChance = used >= MAX_TOUCHES - 1;

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
      const willSet = !lastChance && (lazy || (ai.set && used === 0));
      const behind = willSet ? 4 : lastChance ? 52 : mustSend ? 42 : (closeToNet ? sk.aim * 0.5 : sk.aim);
      target = p.x + behind + (mustSend ? 0 : ai.err);
    }
  }
  const minX = NET_X + R + 10, maxX = W - R - 4;
  target = Math.max(minX, Math.min(maxX, target));

  const dx = bx - px, h = GROUND_Y - b.y;
  const contactSoon = Math.hypot(dx, b.y - me.y) < R + BALL_R + 34;
  if (ai.wait <= 0 || !incoming) {
    const diff = target - px;
    const dead = incoming ? 6 : 18;
    if (Math.abs(diff) > dead) out.move = Math.sign(diff) * Math.min(1, Math.abs(diff) / 30) * m;
    // dash when we would not make it on foot
    if (incoming && sk.dash && ai.canDash && me.dashCd <= 0 && Math.abs(diff) > 110 && Math.abs(diff) > eta * 330 * sk.speed) {
      out.move = Math.sign(diff) * m; out.dash = true;
    }
  }

  // soft set straight up: on the first touch if that is the plan, and whenever the ball is too lazy to spike
  const wantSet = !lastChance && (lazy || (ai.set && used === 0));
  if (incoming && wantSet && me.onGround && b.vy > 0 && contactSoon && me.power < 1) out.bump = true;

  // jump to spike when the ball is dropping close above us
  const wantJump = lastChance || me.power >= 1 || (!wantSet && (mustSend || ai.smash));
  if (incoming && wantJump && me.onGround && b.vy > 0) {
    if (dx > -R * 0.9 && dx < R * 0.25 && h > R + 75 && h < R + 165) out.jump = true;
  }
  // in the air next to the ball: hold the aim direction for the spike
  if (!me.onGround && contactSoon && b.vy > -200) out.move = (ai.aim < 0 ? -1 : ai.aim > 0 ? 1 : 0) * m;

  // ball resting on us / wedged against the net: pop it up
  if (!b.held && !b.dead && me.onGround && bx > NET_X && Math.hypot(b.vx, b.vy) < 70 &&
      Math.hypot(dx, b.y - me.y) < R + BALL_R + 6) out.jump = true;
  me.speedMul = sk.speed;
  return out;
}

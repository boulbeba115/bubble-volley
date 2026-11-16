// Animated characters, ball and power-up bubbles. All animation is procedural
// and driven by the physics state (jelly springs, eye tracking, moods).
import * as THREE from 'three';
import { wx, wy, PX, TEAM_COLORS, MAX_SPEED, POWERUPS } from '../config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MODEL_R = 0.8;                         // radius the Blender model was built at

// Gummy material: glossy clear-coat plus a fresnel rim so the blob glows at its edges.
function jellyMaterial(color) {
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.12,
    emissive: color, emissiveIntensity: 0.1,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float jellyRim = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.4);
      totalEmissiveRadiance += diffuseColor.rgb * jellyRim * 0.85 + vec3(jellyRim * 0.22);`);
  };
  m.shadowSide = THREE.DoubleSide;
  return m;
}

export class Slime {
  constructor(template, side) {
    this.side = side;
    this.root = new THREE.Group();
    this.body = new THREE.Group();          // jelly pivot at the base: squash, shear, yaw
    this.body.matrixAutoUpdate = false;
    this.root.add(this.body);
    const model = template.clone(true);
    this.body.add(model);
    this.color = new THREE.Color(TEAM_COLORS[side]);
    this.bodyMat = jellyMaterial(this.color);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.material.name === 'Body') o.material = this.bodyMat;
      if (o.material.name === 'Shine') {
        o.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
        o.castShadow = false;
      }
    });
    const get = (n) => model.getObjectByName(n);
    this.eyes = [get('EyeL'), get('EyeR')];
    this.pupils = [get('PupilL'), get('PupilR')];
    this.mouth = get('Mouth');
    this.nub = get('AccNub');
    this.sprout = get('AccSprout');
    this.nub.visible = side === 0;
    this.sprout.visible = side === 1;
    this.yaw = side === 0 ? 0.36 : -0.36;
    this.yawCur = this.yaw;
    this.s = 1; this.sv = 0;                 // vertical stretch spring
    this.shear = 0; this.shearV = 0;         // top-lags-behind jelly shear
    this.bulge = 0; this.bulgeV = 0;         // side-to-side wobble
    this.wob = 0; this.wobV = 0;             // accessory wobble spring
    this.prevVx = 0;
    this.blink = 1 + Math.random() * 3; this.blinkT = 0;
    this.mood = 'neutral'; this.moodT = 0;
    this.look = new THREE.Vector2();
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.renderOrder = 1;
    // status ring shown while a power-up (or a full super meter) is active
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 40),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.renderOrder = 2; this.ring.visible = false;
  }

  setColor(hex) {
    this.color.set(hex);
    this.bodyMat.color.copy(this.color); this.bodyMat.emissive.copy(this.color);
  }
  impulse(v) { this.sv = clamp(this.sv + v, -8, 8); }
  wobble(v) { this.bulgeV = clamp(this.bulgeV + v, -9, 9); }
  kick(v) { this.shearV = clamp(this.shearV + v, -10, 10); }
  setMood(m) { this.mood = m; this.moodT = 0; }

  update(dt, t, p, ball) {
    const x = wx(p.x), y = wy(p.y);
    const size = (p.r * PX) / MODEL_R;
    this.moodT += dt;
    let hop = 0;
    if (this.mood === 'happy' && p.onGround) hop = Math.abs(Math.sin(this.moodT * 9)) * 0.22 * Math.max(0, 1 - this.moodT / 2.2);
    this.root.position.set(x, y + hop, 0);
    this.root.scale.setScalar(size);
    const sh = clamp(1 - (y + hop) / 2.5, 0.35, 1) * size;
    this.shadow.position.set(x, 0.02, 0);
    this.shadow.scale.set(sh, sh * 0.6, 1); this.shadow.material.opacity = 0.2 * sh / size;

    // --- jelly springs (deliberately under-damped so the blob keeps jiggling)
    let target = 1 + clamp(-p.vy / 3600, -0.16, 0.24);
    if (this.mood === 'sad') target -= 0.12;
    if (p.slowT > 0) target -= 0.1;
    this.sv += ((target - this.s) * 190 - this.sv * 7.5) * dt;
    this.s = clamp(this.s + this.sv * dt, 0.66, 1.5);

    const ax = dt > 0 ? (p.vx - this.prevVx) / dt : 0;
    this.prevVx = p.vx;
    const shearT = clamp(-p.vx / 370, -2.4, 2.4) * 0.2;
    this.shearV += ((shearT - this.shear) * 150 - this.shearV * 6.5 - clamp(ax, -6000, 6000) * 0.0035) * dt;
    this.shear = clamp(this.shear + this.shearV * dt, -0.7, 0.7);

    this.bulgeV += (-this.bulge * 260 - this.bulgeV * 6) * dt;
    this.bulge = clamp(this.bulge + this.bulgeV * dt, -0.3, 0.3);

    const idle = Math.sin(t * 3.1 + this.side * 1.9) * 0.022 + Math.sin(t * 7.3 + this.side) * 0.006;
    const sy = this.s + idle;
    const sxz = 1 / Math.sqrt(sy);
    const sx = sxz * (1 + this.bulge), sz = sxz * (1 - this.bulge);

    const dxb = wx(ball.x) - x;
    const yawT = this.yaw + clamp(dxb * 0.04, -0.2, 0.2) + (this.mood === 'happy' ? -this.yaw * 0.9 : 0);
    this.yawCur += (yawT - this.yawCur) * Math.min(1, 6 * dt);
    const c = Math.cos(this.yawCur), s = Math.sin(this.yawCur), k = this.shear;
    // matrix = Shear(x += k*y) * RotY(yaw) * Scale
    this.body.matrix.set(
      c * sx, k * sy, s * sz, 0,
      0, sy, 0, 0,
      -s * sx, 0, c * sz, 0,
      0, 0, 0, 1);
    this.body.matrixWorldNeedsUpdate = true;

    // --- eyes follow the ball
    const dyb = wy(ball.y) - (y + 0.5 * size);
    const len = Math.hypot(dxb, dyb) || 1;
    let lx = (dxb / len) * Math.min(1, len / 1.5), ly = (dyb / len) * Math.min(1, len / 1.5);
    if (this.mood === 'sad') { lx *= 0.2; ly = -0.9; }
    if (this.mood === 'happy') { lx = 0; ly = 0.25; }
    lx -= s * 0.8;
    this.look.x += (lx - this.look.x) * Math.min(1, 14 * dt);
    this.look.y += (ly - this.look.y) * Math.min(1, 14 * dt);
    for (const pu of this.pupils) {
      this._v.set(this.look.x * 0.7, this.look.y * 0.7, 1).normalize().multiplyScalar(0.105);
      pu.position.copy(this._v);
    }

    // --- blinking + mood eye shapes
    this.blink -= dt;
    if (this.blink <= 0) { this.blinkT = 0.13; this.blink = 1.5 + Math.random() * 3.5; }
    this.blinkT -= dt;
    let eyeY = this.mood === 'happy' ? 0.5 : this.mood === 'sad' ? 0.72 : 1;
    if (p.dashT > 0) eyeY = 0.45;
    if (this.blinkT > 0) eyeY = 0.1;
    const near = len < 1.6 && this.mood === 'neutral' ? 1.12 : 1;
    for (const e of this.eyes) {
      e.scale.y += (eyeY * near - e.scale.y) * Math.min(1, 30 * dt);
      e.scale.x += (near - e.scale.x) * Math.min(1, 12 * dt);
    }
    const mw = this.mood === 'happy' ? 1.3 : this.mood === 'sad' ? 0.5 : 1;
    this.mouth.scale.x += (mw - this.mouth.scale.x) * Math.min(1, 10 * dt);

    // --- accessory wobble
    this.wobV += ((-p.vx / 370 * 0.6 + p.vy / 900 * 0.3 - this.wob) * 80 - this.wobV * 5) * dt;
    this.wob += this.wobV * dt;
    const acc = this.side === 0 ? this.nub : this.sprout;
    acc.rotation.z = this.wob * 0.8 + Math.sin(t * 3) * 0.06;
    acc.rotation.x = Math.sin(t * 2.2) * 0.05;

    // --- power glow + status ring
    const charged = p.power >= 1;
    const glow = charged ? 0.55 + Math.sin(t * 14) * 0.3 : 0.1 + p.power * 0.12;
    this.bodyMat.emissiveIntensity += (glow - this.bodyMat.emissiveIntensity) * Math.min(1, 12 * dt);
    const fxColor = charged ? '#ff9a3d' : p.bigT > 0 ? POWERUPS.big.color : p.fastT > 0 ? POWERUPS.fast.color
      : p.slowT > 0 ? POWERUPS.slow.color : null;
    this.ring.visible = !!fxColor;
    if (fxColor) {
      this.ring.material.color.set(fxColor);
      this.ring.position.set(x, 0.03, 0);
      this.ring.scale.setScalar(size * (1.02 + Math.sin(t * 8) * 0.06));
      this.ring.material.opacity = 0.55 + Math.sin(t * 8) * 0.25;
    }
  }
}
Slime.prototype._v = new THREE.Vector3();

export class BallView {
  constructor(template) {
    this.root = new THREE.Group();          // oriented along velocity for stretch
    this.spin = new THREE.Group();
    this.root.add(this.spin);
    const model = template.clone(true);
    model.rotation.x = 0.9;
    this.spin.add(model);
    this.mats = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.material.emissive.copy(o.material.color); o.material.emissiveIntensity = 0.08;
      o.material.userData.base = o.material.color.clone();
      this.mats.push(o.material);
    });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.26, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.renderOrder = 2;
    this.light = new THREE.PointLight('#ff7a2d', 0, 5, 1.6);
    this.root.add(this.light);
    this.squash = 0; this.squashV = 0; this.angle = 0; this.heat = 0;
    this._hot = new THREE.Color('#ff6a1f'); this._cold = new THREE.Color('#bfe6ff');
  }

  hit() { this.squashV = Math.max(-5, this.squashV - 4); }

  update(dt, ball) {
    const x = wx(ball.x), y = wy(ball.y);
    this.root.position.set(x, y, 0);
    const speed = Math.hypot(ball.vx, ball.vy);
    this.squashV += (-this.squash * 320 - this.squashV * 16) * dt;
    this.squash = clamp(this.squash + this.squashV * dt, -0.22, 0.22);
    this.squashV = clamp(this.squashV, -12, 12);
    const k = clamp(speed / MAX_SPEED, 0, 1.4) * 0.2 + this.squash;
    if (speed > 20) this.root.rotation.z = Math.atan2(-ball.vy, ball.vx);
    const sz = ball.r / 24;
    this.root.scale.set((1 + k) * sz, (1 - k * 0.55) * sz, (1 - k * 0.2) * sz);
    this.angle -= ball.spin * dt * 2.2;
    this.spin.rotation.z = this.angle - this.root.rotation.z;
    this.spin.rotation.y += dt * 0.6;
    const h = clamp(1 - y / 6, 0.25, 1);
    this.shadow.position.set(x, 0.025, 0);
    this.shadow.scale.setScalar((0.6 + h * 0.6) * sz);
    this.shadow.material.opacity = 0.34 * h;

    // fire ball glows hot, moon ball glows icy
    this.heat += ((ball.fire ? 1 : 0) - this.heat) * Math.min(1, 10 * dt);
    const moon = ball.moonT > 0 ? 1 : 0;
    for (const m of this.mats) {
      m.emissive.copy(m.userData.base).lerp(this._cold, moon * 0.6).lerp(this._hot, this.heat);
      m.emissiveIntensity = 0.08 + moon * 0.35 + this.heat * 2.2;
    }
    this.light.intensity = this.heat * 14;
  }
}

// Floating power-up bubble with an icon inside.
export class PickupView {
  constructor() {
    this.root = new THREE.Group();
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(0.3, 28, 18), new THREE.MeshPhysicalMaterial({
      color: '#ffffff', transparent: true, opacity: 0.32, roughness: 0.05, clearcoat: 1, emissive: '#ffffff', emissiveIntensity: 0.25,
      depthWrite: false,
    }));
    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
    this.icon.scale.setScalar(0.4);
    this.root.add(this.bubble, this.icon);
    this.root.visible = false;
    this.textures = {};
    this.type = null; this.pop = 0;
  }

  texture(type) {
    if (!this.textures[type]) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.font = '92px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(POWERUPS[type].icon, 64, 70);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      this.textures[type] = t;
    }
    return this.textures[type];
  }

  update(dt, t, pk) {
    if (!pk) { this.root.visible = false; this.type = null; return; }
    if (this.type !== pk.type) {
      this.type = pk.type; this.pop = 0;
      this.icon.material.map = this.texture(pk.type); this.icon.material.needsUpdate = true;
      this.bubble.material.color.set(POWERUPS[pk.type].color);
      this.bubble.material.emissive.set(POWERUPS[pk.type].color);
    }
    this.pop = Math.min(1, this.pop + dt * 4);
    const e = 1 + Math.sin(this.pop * Math.PI) * 0.35;         // pop-in overshoot
    const fade = pk.life < 2 ? 0.55 + 0.45 * Math.abs(Math.sin(t * 12)) : 1;   // blink before vanishing
    this.root.visible = true;
    this.root.position.set(wx(pk.x), wy(pk.y) + Math.sin(t * 2.4) * 0.07, 0);
    const wob = 1 + Math.sin(t * 5) * 0.04;
    this.root.scale.set(this.pop * e * wob, this.pop * e / wob, this.pop * e);
    this.bubble.material.opacity = 0.45 * fade;
    this.icon.material.opacity = fade;
    this.icon.material.rotation = Math.sin(t * 2) * 0.15;
  }
}

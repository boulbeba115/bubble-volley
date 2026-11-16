// Visual effects: pooled instanced particles, shockwave rings, confetti.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

class Particles {
  constructor(scene, geometry, material, max) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.list = [];
    scene.add(this.mesh);
    // make sure the instance colour buffer exists
    this.mesh.setColorAt(0, _c.set('#fff'));
  }

  spawn(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: o.x, y: o.y, z: o.z || 0, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life, max: o.life, size: o.size, g: o.g ?? 0, drag: o.drag ?? 0, grow: o.grow ?? 0,
      r: o.spin ? Math.random() * 6 : 0, rs: o.spin || 0, floor: o.floor ?? false,
      color: new THREE.Color(o.color),
    });
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L.splice(i, 1); continue; }
      p.vy -= p.g * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor && p.y < 0.03) { p.y = 0.03; p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; p.rs = 0; }
      p.r += p.rs * dt;
    }
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      const k = p.life / p.max;
      const sz = p.size * (p.grow ? (1 + p.grow * (1 - k)) * Math.min(1, k * 2.5) : Math.min(1, k * 1.6));
      _e.set(p.r, p.r * 1.3, p.r * 0.7); _q.setFromEuler(_e);
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.setScalar(Math.max(0.0001, sz)));
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, p.color);
    }
    this.mesh.count = L.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.sparks = new Particles(scene, new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ toneMapped: false }), 900);
    this.dust = new Particles(scene, new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.85 }), 300);
    this.confetti = new Particles(scene, new THREE.PlaneGeometry(1, 1.6),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 500);
    this.rings = [];
    const rg = new THREE.RingGeometry(0.82, 1, 40);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }));
      m.visible = false; m.userData = { life: 0 };
      scene.add(m); this.rings.push(m);
    }
  }

  ring(x, y, z, color, { flat = false, yaw = 0, from = 0.2, to = 1.4, life = 0.35 } = {}) {
    const m = this.rings.find((r) => !r.visible) || this.rings[0];
    m.visible = true; m.position.set(x, y, z);
    m.rotation.set(flat ? -Math.PI / 2 : 0, yaw, 0);
    m.material.color.set(color);
    m.userData = { life, max: life, from, to };
  }

  hit(x, y, color, power) {
    const n = 8 + Math.floor(power * 14);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (1.5 + Math.random() * 4) * (0.6 + power);
      this.sparks.spawn({ x, y, z: (Math.random() - 0.5) * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1, vz: (Math.random() - 0.5) * 2,
        life: 0.25 + Math.random() * 0.3, size: 0.04 + Math.random() * 0.05, g: 9, drag: 2,
        color: Math.random() < 0.4 ? '#ffffff' : color });
    }
    if (power > 0.55) this.ring(x, y, 0.3, '#ffffff', { from: 0.15, to: 0.9 + power, life: 0.3 });
  }

  sand(x, amount = 1, z = 0) {
    const n = Math.floor(8 * amount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI, sp = (0.6 + Math.random() * 1.8) * Math.min(1.6, amount);
      this.dust.spawn({ x: x + (Math.random() - 0.5) * 0.5, y: 0.05, z: z + (Math.random() - 0.5) * 0.6,
        vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 1.6 * Math.min(1.5, amount), vz: (Math.random() - 0.5) * 1.5,
        life: 0.45 + Math.random() * 0.4, size: 0.07 + Math.random() * 0.09, g: 3, drag: 2.2, grow: 0.8,
        color: Math.random() < 0.5 ? '#f6e2b3' : '#e3c58a' });
    }
  }

  trail(x, y, power) {
    this.sparks.spawn({ x, y, z: 0, life: 0.16 + power * 0.16, size: 0.13 + power * 0.07,
      color: power > 0.8 ? '#ffb347' : power > 0.6 ? '#ffe9a8' : '#ffffff' });
  }

  wallPuff(x, y) {
    for (let i = 0; i < 6; i++) {
      this.sparks.spawn({ x, y, z: 0, vx: -Math.sign(x) * (0.5 + Math.random() * 2), vy: (Math.random() - 0.5) * 4,
        life: 0.3, size: 0.04 + Math.random() * 0.03, drag: 3, color: '#ffffff' });
    }
    this.ring(x - Math.sign(x) * 0.02, y, 0, '#ffffff', { from: 0.1, to: 0.6, life: 0.25, yaw: Math.PI / 2 });
  }

  // flame trail behind a super-spiked ball
  flame(x, y, vx, vy) {
    for (let i = 0; i < 3; i++) {
      this.sparks.spawn({ x: x + (Math.random() - 0.5) * 0.25, y: y + (Math.random() - 0.5) * 0.25, z: (Math.random() - 0.5) * 0.2,
        vx: -vx * 0.15 + (Math.random() - 0.5) * 1.5, vy: -vy * 0.15 + 1 + Math.random() * 1.5,
        life: 0.25 + Math.random() * 0.3, size: 0.12 + Math.random() * 0.13, drag: 2,
        color: ['#fff3b0', '#ffc23d', '#ff7a2d', '#ff3d2d'][Math.floor(Math.random() * 4)] });
    }
  }

  // big radial explosion (super spike launch / fire ball landing)
  explode(x, y, colors, n = 46, speed = 7) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.35 + Math.random() * 0.8);
      this.sparks.spawn({ x, y, z: (Math.random() - 0.5) * 0.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * 3,
        life: 0.35 + Math.random() * 0.45, size: 0.06 + Math.random() * 0.1, g: 4, drag: 2.5,
        color: colors[Math.floor(Math.random() * colors.length)] });
    }
    this.ring(x, y, 0.2, colors[0], { from: 0.2, to: 2.6, life: 0.45 });
    this.ring(x, y, 0.2, '#ffffff', { from: 0.1, to: 1.6, life: 0.3 });
  }

  // bubble pop: droplets + ring
  pop(x, y, color) {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
      this.sparks.spawn({ x: x + Math.cos(a) * 0.25, y: y + Math.sin(a) * 0.25, z: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * 2,
        life: 0.3 + Math.random() * 0.35, size: 0.04 + Math.random() * 0.07, g: 6, drag: 2,
        color: Math.random() < 0.5 ? '#ffffff' : color });
    }
    this.ring(x, y, 0.2, color, { from: 0.3, to: 1.3, life: 0.4 });
  }

  // speed streaks + sand kicked up by a dash
  dash(x, y, dir, color) {
    for (let i = 0; i < 12; i++) {
      this.sparks.spawn({ x: x - dir * (0.2 + Math.random() * 0.6), y: y + 0.1 + Math.random() * 0.55, z: (Math.random() - 0.5) * 0.6,
        vx: -dir * (1 + Math.random() * 3), life: 0.2 + Math.random() * 0.2, size: 0.04 + Math.random() * 0.06, drag: 3,
        color: Math.random() < 0.5 ? '#ffffff' : color });
    }
    if (y < 0.1) this.sand(x - dir * 0.3, 1.1);
  }

  // jelly droplets flung off a blob
  splat(x, y, color, n = 7) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI, sp = 1.5 + Math.random() * 3;
      this.dust.spawn({ x, y, z: (Math.random() - 0.5) * 0.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1, vz: (Math.random() - 0.5) * 2,
        life: 0.5 + Math.random() * 0.3, size: 0.05 + Math.random() * 0.06, g: 11, drag: 0.6, color });
    }
  }

  // twinkles around a fully charged player
  sparkle(x, y, color) {
    const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.4;
    this.sparks.spawn({ x: x + Math.cos(a) * r, y: y + 0.1 + Math.random() * 0.8, z: Math.sin(a) * 0.4, vy: 1 + Math.random() * 1.5,
      life: 0.35 + Math.random() * 0.3, size: 0.035 + Math.random() * 0.04, color });
  }

  celebrate(x, colors) {
    for (let i = 0; i < 160; i++) {
      this.confetti.spawn({ x: x + (Math.random() - 0.5) * 3, y: 4.5 + Math.random() * 2.5, z: (Math.random() - 0.5) * 2.5,
        vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 1.5,
        life: 3 + Math.random() * 2.5, size: 0.09 + Math.random() * 0.05, g: 2.6, drag: 1.2, spin: 4 + Math.random() * 8,
        floor: true, color: colors[Math.floor(Math.random() * colors.length)] });
    }
  }

  burst(x, y, colors) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
      this.confetti.spawn({ x, y, z: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 3, vz: (Math.random() - 0.5) * 3,
        life: 1.2 + Math.random(), size: 0.07 + Math.random() * 0.04, g: 7, drag: 1.5, spin: 6 + Math.random() * 8,
        floor: true, color: colors[Math.floor(Math.random() * colors.length)] });
    }
  }

  clear() {
    this.sparks.list.length = 0; this.dust.list.length = 0; this.confetti.list.length = 0;
    for (const m of this.rings) m.visible = false;
  }

  update(dt) {
    this.sparks.update(dt); this.dust.update(dt); this.confetti.update(dt);
    for (const m of this.rings) {
      if (!m.visible) continue;
      const u = m.userData;
      u.life -= dt;
      if (u.life <= 0) { m.visible = false; continue; }
      const k = 1 - u.life / u.max;
      const e = 1 - (1 - k) * (1 - k);
      m.scale.setScalar(u.from + (u.to - u.from) * e);
      m.material.opacity = (1 - k) * 0.85;
    }
  }
}

// The 3D world: renderer, camera rig, lighting, sky, ocean and the beach set.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ARENAS } from '../config.js';
import slimeUrl from '../assets/models/slime.glb?url';
import ballUrl from '../assets/models/ball.glb?url';
import beachUrl from '../assets/models/beach.glb?url';

const FOV = 38;

const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 0.0);
  gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
  gl_Position.z = gl_Position.w;
}`;
const SKY_FS = /* glsl */`
uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float stars;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(horizon, top, smoothstep(0.0, 0.42, h));
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * (smoothstep(0.9993, 0.9996, s) * 3.0 + pow(s, 90.0) * 0.5 + pow(s, 8.0) * 0.18);
  vec3 g = floor(d * 160.0);
  float st = step(0.9965, hash(g)) * hash(g + 3.1);
  col += vec3(st) * stars * smoothstep(0.02, 0.3, d.y) * 1.6;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WATER_VS = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const WATER_FS = /* glsl */`
uniform float time; uniform vec3 deep; uniform vec3 shallow; uniform vec3 fogColor; uniform vec3 sunColor;
uniform float fogNear; uniform float fogFar;
varying vec3 vWorld;
void main() {
  vec3 p = vWorld;
  float shoreZ = -(5.2 + 0.5 * sin(p.x * 0.35) + 0.25 * sin(p.x * 0.9 + 1.3));
  float d = shoreZ - p.z;                          // distance out to sea
  float depth = clamp(d / 10.0, 0.0, 1.0);
  vec3 col = mix(shallow, deep, smoothstep(0.0, 1.0, depth));
  float w1 = sin(p.x * 0.9 + time * 0.9 + sin(p.z * 0.6 + time * 0.4) * 1.6);
  float w2 = sin(p.z * 1.4 - time * 1.3 + sin(p.x * 0.5) * 2.0);
  col += 0.045 * (w1 + w2);
  float glit = pow(max(sin(p.x * 2.3 + time * 1.7) * sin(p.z * 1.1 + time * 1.1 + p.x * 0.3), 0.0), 10.0);
  col += sunColor * glit * 0.35 * smoothstep(2.0, 14.0, d);
  float lap = 0.45 + 0.3 * sin(time * 0.8 + p.x * 0.35);
  float foam = smoothstep(lap + 0.22, lap, d) * smoothstep(-0.6, 0.1, d);
  float foam2 = smoothstep(0.12, 0.0, abs(d - lap - 1.1 - 0.4 * sin(time * 0.5 + p.x * 0.6))) * 0.5;
  col = mix(col, vec3(1.0), clamp(foam * 0.9 + foam2, 0.0, 1.0));
  float alpha = max(mix(0.5, 0.97, smoothstep(0.0, 0.4, depth)), foam);
  float fd = length(p - cameraPosition);
  col = mix(col, fogColor, smoothstep(fogNear, fogFar, fd));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// procedural sand grain so the beach is not a flat colour
function sandTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? `rgba(150,105,50,${0.05 + Math.random() * 0.12})` : `rgba(255,255,255,${0.2 + Math.random() * 0.4})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 1.6, 1 + Math.random() * 1.6);
  }
  for (let i = 0; i < 26; i++) {         // soft darker patches
    const x = Math.random() * 256, y = Math.random() * 256, r = 14 + Math.random() * 30;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(170,120,60,0.10)'); rg.addColorStop(1, 'rgba(170,120,60,0)');
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap ?? THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#bfe9ff', 45, 170);
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 700);

    this.sun = new THREE.DirectionalLight('#fff', 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -11; sc.right = 11; sc.top = 9; sc.bottom = -7; sc.near = 1; sc.far = 45;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.03;
    this.hemi = new THREE.HemisphereLight('#fff', '#fff', 1);
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3() }, sunColor: { value: new THREE.Color() }, stars: { value: 0 } },
    }));
    this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    this.water = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShaderMaterial({
      vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true,
      uniforms: { time: { value: 0 }, deep: { value: new THREE.Color() }, shallow: { value: new THREE.Color() },
        fogColor: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() },
        fogNear: { value: 45 }, fogFar: { value: 170 } },
    }));
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = -0.12;
    this.scene.add(this.water);

    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.7, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.quality = 'high';
    this.mode = 'menu';
    this.shake = 0; this.shakeEnabled = true; this.punch = 0;
    this.camPos = new THREE.Vector3(0, 3.4, 12); this.camTarget = new THREE.Vector3(0, 1.9, 0);
    this.focusX = 0;
    this.netWobble = 0; this.netVel = 0;
    this.sway = { palms: [], clouds: [], flags: [], buoys: [], boat: null, net: null };
    this.models = {};
    this._v = new THREE.Vector3();
    this.resize();
  }

  async load(onProgress = () => {}) {
    const loader = new GLTFLoader();
    const urls = { slime: slimeUrl, ball: ballUrl, beach: beachUrl };
    let done = 0;
    await Promise.all(Object.entries(urls).map(async ([k, u]) => {
      this.models[k] = (await loader.loadAsync(u)).scene;
      onProgress(++done / 3);
    }));
    this.buildBeach();
  }

  buildBeach() {
    const beach = this.models.beach;
    const noCast = /^(Sand|CourtLines|Cloud|Island|Boat|Buoy|Towel|Starfish|Shells)/;
    const recv = /^(Sand|CourtLines|Towel|Rock)/;
    beach.traverse((o) => {
      const n = o.name;
      if (/^PalmCrown/.test(n)) this.sway.palms.push(o);
      else if (/^Cloud\d/.test(n)) { this.sway.clouds.push(o); o.userData.x0 = o.position.x; }
      else if (/^Flag\d/.test(n)) this.sway.flags.push(o);
      else if (/^Buoy\d/.test(n)) { this.sway.buoys.push(o); o.userData.y0 = o.position.y; }
      else if (n === 'Boat') { this.sway.boat = o; o.userData.x0 = o.position.x; }
      else if (n === 'NetMesh') this.sway.net = o;
      if (o.isMesh) {
        let top = o; while (top.parent && top.parent !== beach) top = top.parent;
        const key = o.name + '|' + (o.parent?.name || '') + '|' + top.name;
        o.castShadow = !noCast.test(o.name) && !noCast.test(o.parent?.name || '') && !noCast.test(top.name);
        o.receiveShadow = recv.test(o.name) || recv.test(o.parent?.name || '');
        if (/Cloud/.test(key)) { this.cloudMat = o.material; o.material.fog = true; }
        if (o.name === 'Sand') { o.material.map = sandTexture(); o.material.needsUpdate = true; }
      }
    });
    this.flagMats = {};
    beach.traverse((o) => { if (o.isMesh && /^Flag(Blue|Red)$/.test(o.material.name)) this.flagMats[o.material.name] = o.material; });
    this.scene.add(beach);
    this.buildCritters();
  }

  setTeamColors(c0, c1) {
    this.flagMats.FlagBlue?.color.set(c0);
    this.flagMats.FlagRed?.color.set(c1);
  }

  // Little bits of life: seagulls gliding over the sea and a crab that watches the match.
  buildCritters() {
    const white = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    const wingGeo = new THREE.PlaneGeometry(1, 0.34).translate(0.5, 0, 0).rotateX(-Math.PI / 2);
    const bodyGeo = new THREE.SphereGeometry(0.14, 8, 6).scale(0.8, 0.7, 2.4);
    this.gulls = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const l = new THREE.Mesh(wingGeo, white), r = new THREE.Mesh(wingGeo, white);
      r.scale.x = -1;
      g.add(new THREE.Mesh(bodyGeo, white), l, r);
      g.userData = { l, r, speed: 2.2 + i * 0.5, y: 6.5 + i * 1.1, z: -14 - i * 7, phase: i * 1.7, x: -30 + i * 19 };
      g.rotation.y = Math.PI / 2;
      this.scene.add(g); this.gulls.push(g);
    }

    const shell = new THREE.MeshStandardMaterial({ color: '#ff5a3c', roughness: 0.5 });
    const eyeW = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2 });
    const eyeB = new THREE.MeshStandardMaterial({ color: '#10182b', roughness: 0.2 });
    const crab = this.crab = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10).scale(1.35, 0.7, 1), shell);
    body.position.y = 0.15; crab.add(body);
    crab.userData = { claws: [], legs: [], target: 3, wait: 1, cheer: 0 };
    for (const s of [-1, 1]) {
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12), shell); stalk.position.set(s * 0.08, 0.28, 0.08);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), eyeW); eye.position.set(s * 0.08, 0.35, 0.08);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), eyeB); pupil.position.set(s * 0.08, 0.355, 0.118);
      const arm = new THREE.Group(); arm.position.set(s * 0.2, 0.16, 0.06);
      const claw = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8).scale(1.2, 0.85, 0.8), shell); claw.position.set(s * 0.12, 0.05, 0.05);
      arm.add(claw); crab.userData.claws.push(arm);
      crab.add(stalk, eye, pupil, arm);
      for (let k = 0; k < 3; k++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.025), shell);
        leg.position.set(s * 0.26, 0.07, -0.08 + k * 0.07); leg.rotation.z = -s * 0.6;
        crab.add(leg); crab.userData.legs.push(leg);
      }
    }
    crab.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    crab.position.set(-3, 0, -2.75);
    this.scene.add(crab);
  }

  cheer() { if (this.crab) this.crab.userData.cheer = 1.6; }

  updateCritters(dt, t) {
    for (const g of this.gulls) {
      const u = g.userData;
      u.x += u.speed * dt; if (u.x > 45) u.x = -45;
      g.position.set(u.x, u.y + Math.sin(t * 0.7 + u.phase) * 0.6, u.z);
      const flap = Math.sin(t * 7 + u.phase) * 0.55 * (0.5 + 0.5 * Math.sin(t * 0.5 + u.phase));   // flap, then glide
      u.l.rotation.z = flap + 0.1; u.r.rotation.z = -flap - 0.1;
    }
    const c = this.crab, u = c.userData;
    u.cheer = Math.max(0, u.cheer - dt);
    const dx = u.target - c.position.x;
    let walking = false;
    if (u.cheer <= 0) {
      if (Math.abs(dx) > 0.05) { c.position.x += Math.sign(dx) * Math.min(Math.abs(dx), 0.9 * dt); walking = true; }
      else { u.wait -= dt; if (u.wait <= 0) { u.target = (Math.random() * 2 - 1) * 5.5; u.wait = 1.5 + Math.random() * 4; } }
    }
    c.position.y = u.cheer > 0 ? Math.abs(Math.sin(t * 12)) * 0.18 : walking ? Math.abs(Math.sin(t * 16)) * 0.025 : 0;
    u.claws.forEach((a, i) => {
      const s = i === 0 ? -1 : 1;
      a.rotation.z = u.cheer > 0 ? s * (0.9 + Math.sin(t * 16 + i) * 0.3) : s * Math.sin(t * 2 + i) * 0.12;
    });
    u.legs.forEach((l, i) => { l.rotation.x = walking ? Math.sin(t * 22 + i * 1.3) * 0.5 : 0; });
  }

  setArena(key) {
    const a = ARENAS[key] || ARENAS.day;
    this.arena = key;
    const su = this.sky.material.uniforms, wu = this.water.material.uniforms;
    su.top.value.set(a.skyTop); su.horizon.value.set(a.skyHorizon);
    su.sunDir.value.set(...a.sunDisc).normalize(); su.sunColor.value.set(a.sunColor); su.stars.value = a.stars;
    wu.deep.value.set(a.waterDeep); wu.shallow.value.set(a.waterShallow); wu.fogColor.value.set(a.fog);
    wu.sunColor.value.set(a.sunColor);
    this.scene.fog.color.set(a.fog);
    this.sun.color.set(a.sunColor); this.sun.intensity = a.sunIntensity;
    this.sun.position.set(...a.sunPos).normalize().multiplyScalar(22);
    this.hemi.color.set(a.hemiSky); this.hemi.groundColor.set(a.hemiGround); this.hemi.intensity = a.hemiIntensity;
    this.renderer.toneMappingExposure = a.exposure;
    if (this.cloudMat) {
      this.cloudMat.color.set(a.cloud); this.cloudMat.emissive.set(a.cloud);
      this.cloudMat.emissiveIntensity = key === 'night' ? 0.12 : 0.35;
    }
    this.bloom.strength = key === 'day' ? 0.28 : 0.45;
  }

  setQuality(q) {
    this.quality = q;
    this.sun.castShadow = q === 'high';
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const pr = this.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.baseDist = Math.max(5.3 / (t * this.camera.aspect), 3.1 / t);
  }

  addShake(amount) { if (this.shakeEnabled) this.shake = Math.min(0.5, this.shake + amount); }
  kickNet(v) { this.netVel += v; }

  // screen-space position (0..1) of a world point; used by the HUD
  project(x, y, z = 0) {
    const v = this._v.set(x, y, z).project(this.camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5 };
  }

  update(dt, t, ballX = 0) {
    const s = this.sway;
    s.palms.forEach((o, i) => {
      o.rotation.z = Math.sin(t * 0.9 + i * 1.7) * 0.05;
      o.rotation.x = Math.cos(t * 0.7 + i * 2.3) * 0.035;
    });
    s.clouds.forEach((o, i) => {
      o.position.x = ((o.userData.x0 + t * (0.5 + (i % 3) * 0.2) + 90) % 180) - 90;
    });
    s.flags.forEach((o, i) => { o.rotation.y = Math.sin(t * 5 + i * 1.3) * 0.45 + Math.sin(t * 11 + i) * 0.1; });
    s.buoys.forEach((o, i) => {
      o.position.y = o.userData.y0 + Math.sin(t * 1.6 + i * 2) * 0.06;
      o.rotation.z = Math.sin(t * 1.1 + i) * 0.14;
    });
    if (s.boat) {
      s.boat.position.x = s.boat.userData.x0 + Math.sin(t * 0.03) * 14;
      s.boat.position.y = -0.12 + Math.sin(t * 1.2) * 0.07;
      s.boat.rotation.z = Math.sin(t * 0.9) * 0.05;
    }
    // net spring wobble
    this.netVel += (-this.netWobble * 140 - this.netVel * 7) * dt;
    this.netWobble += this.netVel * dt;
    if (s.net) s.net.rotation.z = this.netWobble;

    this.updateCritters(dt, t);
    this.water.material.uniforms.time.value = t;

    // camera rig
    const d = this.baseDist;
    const pos = this._v;
    let tx = 0, ty = 1.9;
    if (this.mode === 'menu') {
      const a = Math.sin(t * 0.11) * 0.5;
      pos.set(Math.sin(a) * d * 1.02, 2.5 + Math.sin(t * 0.17) * 0.3, Math.cos(a) * d * 1.02);
      ty = 1.75;
    } else {
      this.focusX += (ballX - this.focusX) * Math.min(1, 3 * dt);
      pos.set(this.focusX * 0.07, 3.4, d - this.punch);
      tx = this.focusX * 0.1;
    }
    const k = 1 - Math.exp(-dt * 3.2);
    this.camPos.lerp(pos, k);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.y += (ty - this.camTarget.y) * k;
    this.punch *= Math.exp(-dt * 5);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(this.camTarget);
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar(500);
  }

  render() {
    if (this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

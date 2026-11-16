// DOM user interface: menus, HUD, banners and screen transitions.
import { SKINS } from '../config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(save, handlers) {
    this.save = save;
    this.h = handlers;
    this.current = 'loading';
    this.stack = [];
    this.bannerT = null;

    document.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', () => { this.h.sound?.('click'); this.h.action(el.dataset.action); });
      el.addEventListener('pointerenter', () => this.h.sound?.('hover'));
    });

    for (const id of ['swatch0', 'swatch1']) {
      $(id).innerHTML = SKINS.map((c) => `<button data-val="${c}" style="background:${c};color:${c}" aria-label="blob colour"></button>`).join('');
    }
    // segmented controls bound to save.setup / save.settings
    document.querySelectorAll('.seg').forEach((seg) => {
      const store = save[seg.dataset.store || 'setup'];
      const key = seg.dataset.key;
      const parse = (v) => (seg.dataset.num ? Number(v) : seg.dataset.bool ? v === 'true' : v);
      const refresh = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', parse(b.dataset.val) === store[key]));
      seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        store[key] = parse(b.dataset.val);
        refresh(); this.h.sound?.('click'); this.h.change(key, store[key]); this.syncSetup();
      }));
      refresh();
    });

    for (const [id, key] of [['volMusic', 'music'], ['volSfx', 'sfx']]) {
      const el = $(id);
      el.value = save.settings[key];
      el.addEventListener('input', () => { save.settings[key] = Number(el.value); this.h.change(key, save.settings[key]); });
      el.addEventListener('change', () => this.h.sound?.('click'));
    }
    this.syncSetup();
    this.refreshRecord();
  }

  syncSetup() {
    const mode = this.save.setup.mode;
    $('rowDifficulty').style.display = mode === 'ai' ? '' : 'none';
    $('rowArena').style.display = mode === 'cup' ? 'none' : '';
    $('rowStyle').style.display = mode === 'cup' ? 'none' : '';
    $('rowColor1').style.display = mode === 'pvp' ? '' : 'none';
    $('cupInfo').style.display = mode === 'cup' ? '' : 'none';
  }

  refreshRecord() {
    const s = this.save.stats;
    $('record').innerHTML = s.played
      ? `Career vs CPU: <b>${s.wins}</b> W – <b>${s.losses}</b> L &nbsp;·&nbsp; Best rally <b>${s.bestRally}</b>` +
        (s.cups ? ` &nbsp;·&nbsp; 🏆 <b>×${s.cups}</b>` : '')
      : '';
  }

  loading(p, text) {
    $('loadFill').style.width = Math.round(p * 100) + '%';
    if (text) $('loadText').textContent = text;
  }

  // ---- screens
  screen(name, { push = false } = {}) {
    if (push && this.current) this.stack.push(this.current); else if (!push) this.stack.length = 0;
    this._show(name);
  }
  back() {
    const prev = this.stack.pop() || 'title';
    this._show(prev);
    return prev;
  }
  _show(name) {
    this.current = name;
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('show', s.id === 'scr-' + name));
    if (name) setTimeout(() => document.querySelector(`#scr-${name} .btn.primary`)?.focus({ preventScroll: true }), 60);
    else document.activeElement?.blur();
  }

  wipe(cb) {
    const w = $('wipe');
    w.className = 'in';
    setTimeout(() => { cb(); w.className = 'out'; }, 400);
  }

  // ---- HUD
  hud(on) { $('hud').classList.toggle('hidden', !on); }

  setupHUD(names, target) {
    $('name0').textContent = names[0]; $('name1').textContent = names[1];
    $('targetLbl').textContent = target;
    for (const i of [0, 1]) $('pips' + i).innerHTML = '<i></i>'.repeat(target);
    this.setScore([0, 0], -1);
    this.rally(0);
    this.ballMarker(null);
    this.power(0, 0); this.power(1, 0); this.touches(0, 0); this.touches(1, 0);
    $('pops').innerHTML = '';
    const b = $('banner'); b.className = 'banner'; b.textContent = '';
  }

  setScore(score, server, popSide = -1) {
    for (const i of [0, 1]) {
      const el = $('score' + i);
      el.textContent = score[i];
      if (i === popSide) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
      [...$('pips' + i).children].forEach((p, k) => p.classList.toggle('on', k < score[i]));
      $('serve' + i).classList.toggle('on', server === i);
    }
  }

  rally(n) {
    const el = $('rally');
    el.classList.toggle('show', n >= 4);
    el.classList.toggle('hot', n >= 12);
    if (n >= 4) {
      $('rallyN').textContent = n;
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
  }

  banner(text, cls = '', dur = 1.2) {
    const b = $('banner');
    b.className = 'banner ' + cls;
    b.textContent = text;
    b.style.setProperty('--dur', dur + 's');
    void b.offsetWidth;
    b.classList.add('show');
  }

  // floating text at a screen position (0..1)
  pop(text, x, y, cls = '') {
    const el = document.createElement('div');
    el.className = 'pop-text ' + cls;
    el.textContent = text;
    el.style.left = (Math.max(0.06, Math.min(0.94, x)) * 100) + '%';
    el.style.top = (Math.max(0.14, Math.min(0.9, y)) * 100) + '%';
    $('pops').appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  flash(color = '#ffffff') {
    const f = $('flash');
    f.style.background = color;
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  }

  touches(i, n) {
    if (this['_tc' + i] === n) return;
    this['_tc' + i] = n;
    [...$('tch' + i).children].forEach((d, k) => d.classList.toggle('on', k < n));
    $('tch' + i).classList.toggle('last', n >= 3);
  }

  power(i, v) {
    const key = Math.round(v * 100);
    if (this['_pw' + i] === key) return;
    this['_pw' + i] = key;
    $('pow' + i).style.width = key + '%';
    $('pow' + i).parentElement.classList.toggle('full', v >= 1);
  }

  // ---- online lobby
  online(view, { code = '', link = '', status = '' } = {}) {
    $('onlineChoose').classList.toggle('hidden', view !== 'choose');
    $('onlineWait').classList.toggle('hidden', view !== 'wait');
    if (code) $('roomCode').textContent = code;
    if (link) $('roomLink').value = link;
    $('onlineStatus').textContent = status;
  }
  joinCode() { return $('joinCode').value.trim().toUpperCase(); }

  ballMarker(x) {
    const el = $('ballMarker');
    el.classList.toggle('hidden', x == null);
    if (x != null) el.style.left = (Math.max(0.03, Math.min(0.97, x)) * 100) + '%';
  }

  results({ title, cls, score, stats, next = 'REMATCH' }) {
    $('rematchBtn').textContent = next;
    const h = $('resHead');
    h.textContent = title; h.className = 'result-head ' + cls;
    $('resS0').textContent = score[0]; $('resS1').textContent = score[1];
    $('resStats').innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    this.refreshRecord();
    this.screen('results');
  }
}

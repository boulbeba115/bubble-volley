// Keyboard + touch input.
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, jump: false, dash: false, bump: false };
    this.onKey = () => {};
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) &&
          !/^(INPUT|BUTTON|SELECT)$/.test(e.target.tagName)) e.preventDefault();
      if (!e.repeat) this.onKey(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.touch.left = this.touch.right = this.touch.jump = this.touch.dash = this.touch.bump = false; });
  }

  bindTouch(root) {
    root.querySelectorAll('[data-touch]').forEach((el) => {
      const k = el.dataset.touch;
      const set = (v) => (e) => { e.preventDefault(); this.touch[k] = v; el.classList.toggle('down', v); };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', set(false));
    });
  }

  // twoPlayers=false lets player 1 use either WASD or the arrow keys
  player(i, twoPlayers) {
    const k = this.keys, t = this.touch;
    let l, r, j, d, b;
    if (i === 0) {
      l = k.has('KeyA') || t.left; r = k.has('KeyD') || t.right; j = k.has('KeyW') || k.has('Space') || t.jump;
      d = k.has('KeyS') || k.has('ShiftLeft') || t.dash;
      b = k.has('KeyE') || k.has('KeyF') || t.bump;
      if (!twoPlayers) {
        l ||= k.has('ArrowLeft'); r ||= k.has('ArrowRight'); j ||= k.has('ArrowUp'); d ||= k.has('ArrowDown');
        b ||= k.has('ShiftRight') || k.has('Enter');
      }
    } else {
      l = k.has('ArrowLeft'); r = k.has('ArrowRight'); j = k.has('ArrowUp'); d = k.has('ArrowDown');
      b = k.has('ShiftRight') || k.has('Enter');
    }
    return { move: (r ? 1 : 0) - (l ? 1 : 0), jump: !!j, dash: !!d, bump: !!b };
  }
}

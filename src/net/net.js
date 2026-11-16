// Online play transport: a peer-to-peer WebRTC data channel (PeerJS).
// The public PeerJS broker is only used to introduce the two browsers to each
// other via a short room code; game data then flows directly between players.
import { Peer } from 'peerjs';

const PREFIX = 'bubble-volley-room-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // no I / O (easy to misread)

const makeCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

export class Net {
  constructor() {
    this.peer = null; this.conn = null; this.role = null; this.code = '';
    this.onMessage = () => {}; this.onPeer = () => {}; this.onClose = () => {};
  }

  get connected() { return !!this.conn?.open; }

  // Create a room; resolves with the room code once the broker accepted it.
  host(fixedCode, tries = 0) {
    this.close();
    this.role = 'host';
    const code = fixedCode || makeCode();
    return new Promise((resolve, reject) => {
      const peer = this.peer = new Peer(PREFIX + code);
      peer.on('open', () => { this.code = code; resolve(code); });
      peer.on('connection', (conn) => {
        if (this.conn) { conn.close(); return; }          // room is full
        this._wire(conn);
      });
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id' && !fixedCode && tries < 5) { peer.destroy(); this.host(null, tries + 1).then(resolve, reject); }
        else if (!this.code) reject(err);
      });
    });
  }

  // Join a room by code; resolves when the data channel is open.
  join(code) {
    this.close();
    this.role = 'guest';
    return new Promise((resolve, reject) => {
      const peer = this.peer = new Peer();
      const timer = setTimeout(() => reject(new Error('Timed out — check the code and try again.')), 15000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        this._wire(conn, () => { clearTimeout(timer); this.code = code; resolve(); });
      });
      peer.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(err.type === 'peer-unavailable' ? 'Room not found.' : 'Connection failed (' + err.type + ').'));
      });
    });
  }

  _wire(conn, onOpen) {
    conn.on('open', () => { this.conn = conn; onOpen?.(); this.onPeer(); });
    conn.on('data', (msg) => this.onMessage(msg));
    conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.onClose(); } });
    conn.on('error', () => { if (this.conn === conn) { this.conn = null; this.onClose(); } });
  }

  send(msg) { if (this.conn?.open) this.conn.send(msg); }

  close() {
    const peer = this.peer;
    this.peer = null; this.conn = null; this.role = null; this.code = '';
    try { peer?.destroy(); } catch { /* ignore */ }
  }
}

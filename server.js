import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  Simulation,
  rackBalls,
  cueBall,
  round6,
  BALL_R,
  TABLE_W,
  TABLE_H,
  POCKETS,
} from './public/js/physics.js';
import { resolveShot } from './server-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;

/* ------------------------------------------------------------------ static */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    const target = info.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    // Single page fallback: /ABC12 is a room link.
    try {
      const data = await readFile(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
});

/* -------------------------------------------------------------------- game */



/** @type {Map<string, any>} */
const players = new Map();
/** @type {Map<string, any>} */
const rooms = new Map();
/** @type {string[]} */
const queue = [];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function send(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function sanitizeName(name) {
  const clean = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 14);
  return clean || 'Player';
}

function playerOf(room, id) {
  return room.players.find((p) => p.id === id) || null;
}

function opponentOf(room, player) {
  return room.players.find((p) => p.id !== player.id) || null;
}

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      group: p.group,
      connected: p.connected,
    })),
    turn: room.turnId,
    balls: room.balls.map((b) => ({ id: b.id, x: round6(b.x), y: round6(b.y) })),
    potted: room.potted.slice(),
    ballInHand: room.ballInHand,
    winner: room.winner,
    message: room.message,
    breakShot: room.breakShot,
    rematch: room.rematch.slice(),
    matchNo: room.matchNo,
  };
}

function broadcastRoom(room) {
  const state = publicState(room);
  for (const p of room.players) {
    send(p.ws, { t: 'room', state });
  }
}

function newRoom() {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  const room = {
    code,
    players: [],
    balls: rackBalls(),
    potted: [],
    phase: 'waiting',
    turnId: null,
    winner: null,
    ballInHand: false,
    message: '',
    breakShot: true,
    rematch: [],
    matchNo: 0,
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function startMatch(room, breakerId) {
  room.balls = rackBalls().map((b) => ({ ...b, vx: 0, vy: 0 }));
  room.potted = [];
  room.phase = 'playing';
  room.winner = null;
  room.ballInHand = false;
  room.breakShot = true;
  room.rematch = [];
  room.turnId = breakerId;
  room.matchNo += 1;
  for (const p of room.players) p.group = null;
  const breaker = playerOf(room, breakerId);
  room.message = `${breaker ? breaker.name : 'Player'} breaks — good luck!`;
  broadcastRoom(room);
}

function removeFromQueue(id) {
  const i = queue.indexOf(id);
  if (i >= 0) queue.splice(i, 1);
}

function leaveCurrent(player, reason = 'You left the table') {
  removeFromQueue(player.id);
  const room = rooms.get(player.roomCode);
  player.roomCode = null;
  if (!room) return;
  const other = opponentOf(room, player);
  room.players = room.players.filter((p) => p.id !== player.id);
  if (other) {
    other.roomCode = null;
    other.group = null;
    send(other.ws, { t: 'left', reason: `${player.name} left the table` });
  }
  rooms.delete(room.code);
  void reason;
}

function joinRoom(player, room) {
  if (!room.players.some((p) => p.id === player.id)) room.players.push(player);
  player.roomCode = room.code;
  player.group = null;
  if (room.players.length === 2) {
    const first = room.players[0].id;
    startMatch(room, Math.random() < 0.5 ? first : room.players[1].id);
  } else {
    broadcastRoom(room);
  }
}

/* ------------------------------------------------------------------- handlers */

function handleShoot(player, msg) {
  const room = rooms.get(player.roomCode);
  if (!room) return;
  if (room.phase !== 'playing') return send(player.ws, { t: 'error', message: 'The match is not running.' });
  if (room.turnId !== player.id) return send(player.ws, { t: 'error', message: 'It is not your turn.' });
  if (room.ballInHand) return send(player.ws, { t: 'error', message: 'Place the cue ball first.' });

  const cue = cueBall(room.balls);
  if (!cue) return send(player.ws, { t: 'error', message: 'No cue ball on the table.' });

  const angle = Number(msg.angle);
  const power = Number(msg.power);
  if (!Number.isFinite(angle) || !Number.isFinite(power) || power <= 0 || power > 1) {
    return send(player.ws, { t: 'error', message: 'Invalid shot.' });
  }

  const pottedBefore = room.potted.slice();
  const wasBreak = room.breakShot;

  const sim = new Simulation(room.balls, { angle, power });
  const res = sim.runToRest();

  // Authoritative positions (potted balls are already gone).
  room.balls = res.balls.map((b) => ({ id: b.id, x: round6(b.x), y: round6(b.y), vx: 0, vy: 0 }));

  resolveShot(room, res, player, pottedBefore, wasBreak);
  room.breakShot = false;

  const payload = {
    t: 'shot',
    by: player.id,
    shot: { angle, power },
    result: {
      pocketed: res.pocketed,
      firstContact: res.firstContact,
      cuePocketed: res.cuePocketed,
      steps: res.steps,
    },
    state: publicState(room),
  };
  for (const p of room.players) send(p.ws, payload);

  if (room.phase === 'over') {
    setTimeout(() => {
      const still = rooms.get(room.code);
      if (still === room) {
        for (const p of room.players) send(p.ws, { t: 'matchOver', winner: room.winner, state: publicState(room) });
      }
    }, 900);
  }
}

function placementValid(room, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const m = BALL_R + 1.5;
  if (x < m || x > TABLE_W - m || y < m || y > TABLE_H - m) return false;
  for (const p of POCKETS) {
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < (p.r + BALL_R * 0.6) * (p.r + BALL_R * 0.6)) return false;
  }
  for (const b of room.balls) {
    if (b.id === 0) continue;
    const dx = x - b.x;
    const dy = y - b.y;
    if (dx * dx + dy * dy < (BALL_R * 2 + 0.5) * (BALL_R * 2 + 0.5)) return false;
  }
  return true;
}

function handlePlace(player, msg) {
  const room = rooms.get(player.roomCode);
  if (!room || room.phase !== 'playing') return;
  if (room.turnId !== player.id || !room.ballInHand) return;
  const x = Number(msg.x);
  const y = Number(msg.y);
  if (!placementValid(room, x, y)) {
    return send(player.ws, { t: 'error', message: 'That spot is blocked. Try another.' });
  }
  room.balls = room.balls.filter((b) => b.id !== 0);
  room.balls.push({ id: 0, x: round6(x), y: round6(y), vx: 0, vy: 0 });
  room.ballInHand = false;
  room.message = `${player.name} placed the cue ball.`;
  broadcastRoom(room);
}

function handleMessage(player, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (!msg || typeof msg.t !== 'string') return;

  switch (msg.t) {
    case 'name': {
      player.name = sanitizeName(msg.name);
      const room = rooms.get(player.roomCode);
      if (room) broadcastRoom(room);
      break;
    }
    case 'play': {
      leaveCurrent(player);
      if (!queue.includes(player.id)) queue.push(player.id);
      send(player.ws, { t: 'queued' });
      // pair players up
      while (queue.length >= 2) {
        const a = players.get(queue.shift());
        const b = players.get(queue.shift());
        const valid = [a, b].filter((p) => p && !p.roomCode);
        if (valid.length === 2) {
          const room = newRoom();
          joinRoom(a, room);
          joinRoom(b, room);
        } else {
          for (const p of valid) queue.push(p.id);
          if (valid.length < 2) break;
        }
      }
      break;
    }
    case 'create': {
      leaveCurrent(player);
      const room = newRoom();
      joinRoom(player, room);
      break;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      const room = rooms.get(code);
      if (!room) return send(player.ws, { t: 'error', message: 'That room does not exist.' });
      if (room.players.length >= 2) return send(player.ws, { t: 'error', message: 'That room is already full.' });
      if (player.roomCode === code) return;
      leaveCurrent(player);
      joinRoom(player, room);
      break;
    }
    case 'shoot':
      handleShoot(player, msg);
      break;
    case 'aim': {
      const room = rooms.get(player.roomCode);
      if (!room || room.phase !== 'playing' || room.turnId !== player.id) break;
      const other = opponentOf(room, player);
      if (other && other.ws) {
        const angle = Number(msg.angle);
        if (!Number.isFinite(angle)) break;
        const power = Math.max(0, Math.min(1, Number(msg.power || 0)));
        send(other.ws, {
          t: 'aim',
          angle,
          power,
        });
      }
      break;
    }
    case 'place':
      handlePlace(player, msg);
      break;
    case 'leave':
      leaveCurrent(player);
      send(player.ws, { t: 'left', reason: 'You left the table' });
      break;
    case 'rematch': {
      const room = rooms.get(player.roomCode);
      if (!room || room.phase !== 'over') return;
      if (!room.rematch.includes(player.id)) room.rematch.push(player.id);
      if (room.rematch.length >= 2) {
        startMatch(room, room.players[room.matchNo % 2].id);
      } else {
        broadcastRoom(room);
      }
      break;
    }
    case 'sync': {
      const room = rooms.get(player.roomCode);
      if (room) send(player.ws, { t: 'room', state: publicState(room) });
      break;
    }
    case 'ping':
      send(player.ws, { t: 'pong', at: msg.at });
      break;
    default:
      break;
  }
}

function handleClose(player) {
  players.delete(player.id);
  removeFromQueue(player.id);
  const room = rooms.get(player.roomCode);
  player.roomCode = null;
  if (!room) return;
  const other = opponentOf(room, player);
  rooms.delete(room.code);
  if (other) {
    other.roomCode = null;
    other.group = null;
    send(other.ws, { t: 'left', reason: `${player.name} disconnected` });
  }
}

/* ---------------------------------------------------------------- websocket */

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  const player = {
    id: makeId(),
    name: 'Player',
    ws,
    roomCode: null,
    group: null,
    connected: true,
  };
  players.set(player.id, player);
  send(ws, { t: 'hello', id: player.id });

  ws.on('message', (raw) => {
    try {
      handleMessage(player, raw);
    } catch (err) {
      console.error('message error', err);
    }
  });
  ws.on('close', () => handleClose(player));
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`\n  🎱  Break & Run is live at http://localhost:${PORT}\n`);
});

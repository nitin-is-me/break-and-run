import {
  Simulation,
  STEP,
  cueBall,
  clamp,
  BALL_R,
  TABLE_W,
  TABLE_H,
  POCKETS,
  BALL_COLORS,
  HEAD_SPOT_X,
} from './physics.js';
import { Renderer } from './render.js';
import { sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const TOUCH = window.matchMedia('(pointer: coarse)').matches;

const els = {
  lobby: $('lobby'),
  waiting: $('waiting'),
  game: $('game'),
  nameInput: $('nameInput'),
  codeInput: $('codeInput'),
  playBtn: $('playBtn'),
  createBtn: $('createBtn'),
  joinBtn: $('joinBtn'),
  lobbyHint: $('lobbyHint'),

  waitTitle: $('waitTitle'),
  waitSub: $('waitSub'),
  codeBlock: $('codeBlock'),
  codeDigits: $('codeDigits'),
  copyBtn: $('copyBtn'),
  cancelBtn: $('cancelBtn'),

  leaveBtn: $('leaveBtn'),
  soundBtn: $('soundBtn'),
  soundOnIcon: $('soundOnIcon'),
  soundOffIcon: $('soundOffIcon'),
  p0: $('p0'),
  p1: $('p1'),
  p0av: $('p0av'),
  p1av: $('p1av'),
  p0name: $('p0name'),
  p1name: $('p1name'),
  p0group: $('p0group'),
  p1group: $('p1group'),
  p0remain: $('p0remain'),
  p1remain: $('p1remain'),
  turnPill: $('turnPill'),
  roomMini: $('roomMini'),
  banner: $('banner'),
  netWarn: $('netWarn'),
  tray: $('tray'),
  powerWrap: $('powerWrap'),
  powerFill: $('powerFill'),
  powerPct: $('powerPct'),
  hintLine: $('hintLine'),

  resultOverlay: $('resultOverlay'),
  resultEmoji: $('resultEmoji'),
  resultTitle: $('resultTitle'),
  resultSub: $('resultSub'),
  rematchBtn: $('rematchBtn'),
  rematchHint: $('rematchHint'),
  lobbyBtn: $('lobbyBtn'),
  toast: $('toast'),
};

const canvas = $('table');
const renderer = new Renderer(canvas);

const S = {
  screen: 'lobby',
  myId: null,
  name: localStorage.getItem('pool.name') || '',
  ws: null,
  connected: false,
  lostRoom: false,
  autoJoin: null,

  room: null,
  sim: null,
  simIsMine: false,
  simEndedAt: 0,
  pending: null,
  eventIndex: 0,
  acc: 0,

  aim: 0,
  charging: false,
  chargeAngle: 0,
  chargeOrigin: { x: 0, y: 0 },
  pointerId: null,
  keyCharging: false,
  power: 0,
  hover: null,

  overlayShown: false,
  latency: 0,
  queued: false,
  hasName: !!localStorage.getItem('pool.name'),
};

/* ------------------------------------------------------------------ utils */

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase() || '?';
}

function groupLabel(g) {
  if (g === 'solids') return 'solids 1–7';
  if (g === 'stripes') return 'stripes 9–15';
  return 'open table';
}

function groupIds(g) {
  return g === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
}

function validPlacement(p) {
  if (!S.room) return false;
  const m = BALL_R + 2;
  if (!p || p.x < m || p.x > TABLE_W - m || p.y < m || p.y > TABLE_H - m) return false;
  for (const pk of POCKETS) {
    const dx = p.x - pk.x;
    const dy = p.y - pk.y;
    const rr = pk.r + BALL_R * 0.5;
    if (dx * dx + dy * dy < rr * rr) return false;
  }
  for (const b of S.room.balls) {
    if (b.id === 0) continue;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const rr = BALL_R * 2 + 1;
    if (dx * dx + dy * dy < rr * rr) return false;
  }
  return true;
}

let toastTimer = 0;
function toast(text, error = false, ms = 2800) {
  els.toast.textContent = text;
  els.toast.className = 'toast' + (error ? ' error' : '');
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

let bannerTimer = 0;
function showBanner(text, foul = false) {
  if (!text) return;
  els.banner.textContent = text;
  els.banner.classList.remove('hidden');
  els.banner.classList.toggle('foul', foul);
  els.banner.style.animation = 'none';
  void els.banner.offsetWidth;
  els.banner.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => els.banner.classList.add('hidden'), 5200);
}

function hideBanner() {
  clearTimeout(bannerTimer);
  els.banner.classList.add('hidden');
}

function showScreen(name) {
  S.screen = name;
  els.lobby.classList.toggle('hidden', name !== 'lobby');
  els.waiting.classList.toggle('hidden', name !== 'waiting');
  els.game.classList.toggle('hidden', name !== 'game');
  if (name === 'game') {
    requestAnimationFrame(() => renderer.resize());
  }
}

/* ------------------------------------------------------------------- net */

function send(payload) {
  if (S.ws && S.ws.readyState === 1) {
    S.ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

let reconnectDelay = 800;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let ws;
  try {
    ws = new WebSocket(`${proto}//${location.host}`);
  } catch {
    setTimeout(connect, 1500);
    return;
  }
  S.ws = ws;

  ws.onopen = () => {
    S.connected = true;
    reconnectDelay = 800;
    els.netWarn.classList.add('hidden');
    enableLobbyButtons();
    if (S.lostRoom) {
      S.lostRoom = false;
      goLobby('Connection restored — the table was closed.');
    }
    send({ t: 'name', name: displayName() });
    if (S.autoJoin) {
      send({ t: 'join', code: S.autoJoin });
      S.autoJoin = null;
    }
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleMessage(msg);
  };

  ws.onclose = () => {
    S.connected = false;
    if (S.room) {
      S.lostRoom = true;
      els.netWarn.classList.remove('hidden');
    }
    if (S.screen === 'game') els.netWarn.classList.remove('hidden');
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(5000, reconnectDelay * 1.6);
  };

  ws.onerror = () => {};
}

function handleMessage(msg) {
  switch (msg.t) {
    case 'hello':
      S.myId = msg.id;
      if (!S.autoJoin && S.queued && !S.room) send({ t: 'play' });
      break;
    case 'queued':
      showWaiting('random');
      break;
    case 'room':
      onRoom(msg.state);
      break;
    case 'shot':
      onShot(msg);
      break;
    case 'left':
      goLobby(msg.reason);
      break;
    case 'error':
      if (!S.room && !S.queued) showScreen('lobby');
      toast(msg.message, true);
      if (S.room) send({ t: 'sync' });
      break;
    case 'pong':
      S.latency = Math.max(0, Date.now() - msg.at);
      updateRoomMini();
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ rooms */

function goLobby(reason) {
  S.room = null;
  S.sim = null;
  S.pending = null;
  S.charging = false;
  S.keyCharging = false;
  S.power = 0;
  S.overlayShown = false;
  S.queued = false;
  S.hover = null;
  hideResult();
  hideBanner();
  els.netWarn.classList.add('hidden');
  updatePowerUI();
  showScreen('lobby');
  history.replaceState(null, '', '/');
  if (reason) toast(reason);
}

function onRoom(state) {
  S.queued = false;
  if (S.sim && !S.sim.done) {
    S.pending = state;
    return;
  }
  if (S.sim) {
    S.sim = null;
    S.pending = null;
    S.acc = 0;
    S.simEndedAt = 0;
  }
  if (state.phase === 'waiting') {
    S.room = state;
    showWaiting('private', state.code);
    return;
  }
  if (S.screen !== 'game') {
    showScreen('game');
    S.hover = null;
  }
  applyState(state);
}

function applyState(state) {
  const prev = S.room;
  const prevMsg = prev?.message;
  const prevTurn = prev?.turn;
  S.room = state;

  if (state.phase !== 'over' && S.overlayShown) hideResult();

  updateHUD();

  if (state.message && state.message !== prevMsg) {
    showBanner(state.message, /foul/i.test(state.message));
  } else if (state.phase === 'playing' && state.turn === S.myId && prevTurn !== S.myId) {
    showBanner('Your turn', false);
  }

  if (state.phase === 'over') maybeShowResult();
  else if (els.resultOverlay.classList.contains('hidden') === false) updateRematchUI();
}

function onShot(msg) {
  if (!S.room) return;
  if (msg.by === S.myId && S.sim && S.simIsMine) {
    S.pending = msg.state;
    if (S.sim.done) finishShot();
    return;
  }
  const mine = msg.by === S.myId;
  startSim(msg.shot, mine, msg.state);
  if (S.sim && S.sim.done) finishShot();
}

function startSim(shot, mine, pendingState) {
  if (!S.room) return;
  S.sim = new Simulation(S.room.balls, shot);
  S.simIsMine = mine;
  S.simEndedAt = 0;
  S.pending = pendingState || null;
  S.eventIndex = 0;
  S.acc = 0;
  S.charging = false;
  S.power = 0;
  updatePowerUI();
  updateHUD();
}

function finishShot() {
  const st = S.pending;
  S.sim = null;
  S.pending = null;
  S.simEndedAt = 0;
  S.acc = 0;
  if (st) applyState(st);
  else updateHUD();
}

/* -------------------------------------------------------------------- hud */

function myTurn() {
  const st = S.room;
  return !!(st && st.phase === 'playing' && st.turn === S.myId && !S.sim);
}

function canShoot() {
  return myTurn() && !S.room.ballInHand && !!cueBall(S.room.balls);
}

function updateHUD() {
  const st = S.room;
  if (!st) return;
  const me = st.players.find((p) => p.id === S.myId) || { id: S.myId, name: displayName(), group: null };
  const opp = st.players.find((p) => p.id !== S.myId) || null;

  els.p0name.textContent = me.name;
  els.p0av.textContent = initials(me.name);
  els.p0group.textContent = groupLabel(me.group);
  els.p1name.textContent = opp ? opp.name : 'Waiting…';
  els.p1av.textContent = initials(opp?.name);
  els.p1group.textContent = groupLabel(opp?.group);

  const playing = st.phase === 'playing';
  els.p0.classList.toggle('active', playing && st.turn === me.id);
  els.p1.classList.toggle('active', playing && st.turn === opp?.id);

  renderRemain(els.p0remain, me.group, st.potted);
  renderRemain(els.p1remain, opp?.group, st.potted);

  let pill = 'Waiting';
  let cls = '';
  if (st.phase === 'over') {
    pill = st.winner === me.id ? 'Victory' : 'Defeat';
    cls = st.winner === me.id ? 'mine' : '';
  } else if (playing && st.turn === me.id) {
    pill = st.ballInHand ? 'Ball in hand' : 'Your turn';
    cls = 'mine';
  } else if (playing && opp) {
    pill = `${opp.name}'s turn`;
    cls = 'theirs';
  } else if (playing) {
    pill = 'Playing';
  }
  els.turnPill.textContent = pill;
  els.turnPill.className = `turn-pill ${cls}`;

  renderTray(st.potted);
  els.powerWrap.classList.toggle('live', myTurn());

  // contextual hint
  let hint = '';
  if (st.phase === 'over') {
    hint = 'Match finished — start a rematch or head back to the lobby.';
  } else if (S.sim) {
    hint = S.simIsMine ? 'Nice shot! Balls are rolling…' : `${opp ? opp.name : 'Opponent'} is shooting…`;
  } else if (st.ballInHand && st.turn === me.id) {
    hint = TOUCH
      ? 'Ball in hand — tap a free spot on the felt to place the cue ball.'
      : 'Ball in hand — click a free spot on the felt to place the cue ball.';
  } else if (st.turn === me.id) {
    hint = TOUCH
      ? 'Press anywhere, drag back to aim & power, release to shoot.'
      : 'Aim with the mouse, then press & pull back to shoot. Space also charges a shot.';
  } else if (opp) {
    hint = `Waiting for ${opp.name}…`;
  }
  els.hintLine.textContent = hint;

  // Clear charging when not our turn
  if (st.turn !== me.id || st.phase !== 'playing' || st.ballInHand) {
    S.charging = false;
    S.keyCharging = false;
    S.power = 0;
    updatePowerUI();
  }

  canvas.classList.toggle('idle', !canShoot() && !(st.ballInHand && st.turn === me.id && !S.sim));

  updateRoomMini();
  updatePowerUI();
  if (!els.resultOverlay.classList.contains('hidden')) updateRematchUI();
}

function renderRemain(el, group, potted) {
  if (!group) {
    el.innerHTML = '';
    return;
  }
  const ids = groupIds(group);
  el.innerHTML = ids
    .map(
      (id) =>
        `<i class="${potted.includes(id) ? 'done' : ''}" style="background:${BALL_COLORS[id]}"></i>`
    )
    .join('');
}

function renderTray(potted) {
  if (!potted.length) {
    els.tray.innerHTML = '<span class="tray-empty">—</span>';
    return;
  }
  els.tray.innerHTML = potted
    .slice()
    .sort((a, b) => a - b)
    .map(
      (id) =>
        `<span class="tray-ball" style="background:${BALL_COLORS[id]};${
          id === 8 ? 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);' : ''
        }">${id}</span>`
    )
    .join('');
}

function updateRoomMini() {
  if (!S.room) return;
  const lat = S.latency ? ` · ${S.latency}ms` : '';
  els.roomMini.textContent = `ROOM ${S.room.code}${lat}`;
}

function updatePowerUI() {
  const pct = Math.round(S.power * 100);
  els.powerFill.style.width = `${pct}%`;
  els.powerPct.textContent = `${pct}%`;
}

function showWaiting(mode, code) {
  showScreen('waiting');
  if (mode === 'private' && code) {
    els.waitTitle.textContent = 'Waiting for your friend…';
    els.waitSub.textContent = 'Share the code below. The match starts the moment they join.';
    els.codeBlock.classList.remove('hidden');
    els.codeDigits.innerHTML = code
      .split('')
      .map((ch) => `<span>${ch}</span>`)
      .join('');
    if (location.search !== `?room=${code}`) history.replaceState(null, '', `/?room=${code}`);
  } else {
    els.waitTitle.textContent = 'Looking for an opponent…';
    els.waitSub.textContent = 'You will be matched with the next player in the queue.';
    els.codeBlock.classList.add('hidden');
    history.replaceState(null, '', '/');
  }
}

/* ----------------------------------------------------------------- result */

function maybeShowResult() {
  if (!S.room || S.room.phase !== 'over' || S.overlayShown || S.sim) return;
  S.overlayShown = true;
  const won = S.room.winner === S.myId;
  const opp = S.room.players.find((p) => p.id !== S.myId);
  els.resultEmoji.textContent = won ? '🏆' : '🎱';
  els.resultTitle.textContent = won ? 'You win!' : 'You lost';
  els.resultSub.textContent = won
    ? `The 8-ball is down. ${opp ? opp.name + ' will want that one back.' : ''}`
    : `${opp ? opp.name : 'Your opponent'} takes the table. Run it back?`;
  updateRematchUI();
  els.resultOverlay.classList.remove('hidden');
}

function updateRematchUI() {
  if (!S.room) return;
  const ready = S.room.rematch.includes(S.myId);
  const count = S.room.rematch.length;
  els.rematchBtn.disabled = ready;
  els.rematchBtn.textContent = ready ? 'Waiting for opponent…' : 'Rematch';
  els.rematchHint.textContent = count > 0 ? `${count}/2 players ready` : '';
}

function hideResult() {
  S.overlayShown = false;
  els.resultOverlay.classList.add('hidden');
}

/* ----------------------------------------------------------------- input */

function updateAimFromPointer(p) {
  const cue = cueBall(S.room.balls);
  if (!cue) return;
  const dx = p.x - cue.x;
  const dy = p.y - cue.y;
  if (dx * dx + dy * dy < 36) return;
  S.aim = Math.atan2(dy, dx);
}

canvas.addEventListener('pointermove', (e) => {
  const p = renderer.toWorld(e.clientX, e.clientY);
  S.hover = p;

  if (S.charging) {
    // Unified drag-back: vector from chargeOrigin to current pointer
    // Drag BACK (away from target) = shoot FORWARD
    const dx = S.chargeOrigin.x - p.x;  // reversed: drag back → aim forward
    const dy = S.chargeOrigin.y - p.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 8) {  // minimum drag to set angle
      S.aim = Math.atan2(dy, dx);
      S.chargeAngle = S.aim;
    }
    // Power based on drag distance (clamped)
    S.power = clamp(dist / 220, 0, 1);
    updatePowerUI();
    return;
  }

  // Hover aim for mouse (when not charging)
  if (myTurn() && !S.room.ballInHand && e.pointerType !== 'touch' && !S.charging) {
    updateAimFromPointer(p);
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  sound.ensure();
  const p = renderer.toWorld(e.clientX, e.clientY);
  S.hover = p;

  if (!S.room || S.room.phase !== 'playing' || S.sim) return;

  // ball in hand: tap to place
  if (S.room.turn === S.myId && S.room.ballInHand) {
    if (!validPlacement(p)) {
      toast('That spot is blocked — try another.', true, 1800);
      return;
    }
    send({ t: 'place', x: p.x, y: p.y });
    S.room.balls = S.room.balls.filter((b) => b.id !== 0).concat([{ id: 0, x: p.x, y: p.y }]);
    S.room.ballInHand = false;
    updateHUD();
    return;
  }

  if (!canShoot()) return;

  // Unified control: press anywhere, drag back to aim+power
  S.charging = true;
  S.chargeOrigin = p;
  S.power = 0;
  S.pointerId = e.pointerId;
  // Set initial aim from press point to cue ball
  const cue = cueBall(S.room.balls);
  if (cue) {
    const dx = cue.x - p.x;
    const dy = cue.y - p.y;
    if (dx * dx + dy * dy > 16) {
      S.aim = Math.atan2(dy, dx);
      S.chargeAngle = S.aim;
    }
  }
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  updatePowerUI();
  e.preventDefault();
});

function endCharge(cancel = false) {
  if (!S.charging) return;
  const power = S.power;
  const angle = S.chargeAngle;
  S.charging = false;
  S.power = 0;
  updatePowerUI();
  if (S.pointerId != null) {
    try { canvas.releasePointerCapture(S.pointerId); } catch {}
    S.pointerId = null;
  }
  if (!cancel && power >= 0.05) shoot(angle, Math.max(0.07, power));
}

canvas.addEventListener('pointerup', (e) => {
  if (S.charging && e.pointerId === S.pointerId) endCharge(false);
});
canvas.addEventListener('pointercancel', (e) => {
  if (S.charging && e.pointerId === S.pointerId) endCharge(true);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function shoot(angle, power) {
  if (!canShoot()) return;
  const shot = { angle, power };
  sound.cue(power);
  send({ t: 'shoot', angle, power });
  startSim(shot, true, null);
}

window.addEventListener('keydown', (e) => {
  if (S.screen !== 'game' || !S.room) return;
  if (e.target instanceof HTMLInputElement) return;

  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    if (!canShoot()) return;
    S.aim += (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.004 : 0.016);
    e.preventDefault();
  } else if (e.code === 'Space') {
    if (!canShoot() || S.keyCharging) return;
    S.keyCharging = true;
    S.power = 0;
    e.preventDefault();
  } else if (e.code === 'Escape') {
    S.keyCharging = false;
    S.power = 0;
    updatePowerUI();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || !S.keyCharging) return;
  S.keyCharging = false;
  const power = S.power;
  S.power = 0;
  updatePowerUI();
  if (power >= 0.05) shoot(S.aim, Math.max(0.07, power));
});

/* ------------------------------------------------------------- game loop */

function consumeEvents() {
  if (!S.sim) return;
  const ev = S.sim.events;
  let played = 0;
  for (let i = S.eventIndex; i < ev.length; i++) {
    if (played < 5) {
      sound.play(ev[i]);
      played++;
    }
  }
  S.eventIndex = ev.length;
}

function stepSim(dt) {
  if (!S.sim) return;
  S.acc += dt;
  let guard = 0;
  while (S.acc >= STEP && !S.sim.done && guard < 160) {
    S.sim.step();
    S.acc -= STEP;
    guard++;
  }
  consumeEvents();

  if (S.sim.done) {
    S.acc = 0;
    if (!S.simEndedAt) S.simEndedAt = performance.now();
    if (S.pending) finishShot();
    else if (performance.now() - S.simEndedAt > 2200) {
      S.simEndedAt = performance.now();
      send({ t: 'sync' });
    }
  }
}

function draw() {
  if (!S.room) {
    renderer.draw({ balls: [] });
    return;
  }
  const st = S.room;
  let balls = S.sim ? S.sim.balls : st.balls;
  const turnMine = st.phase === 'playing' && st.turn === S.myId && !S.sim;
  const placing = turnMine && st.ballInHand;
  const cue = balls.find((b) => b.id === 0);

  let ghost = null;
  if (placing) {
    const p = S.hover || (cue ? { x: cue.x, y: cue.y } : { x: HEAD_SPOT_X, y: TABLE_H / 2 });
    ghost = { x: p.x, y: p.y, valid: validPlacement(p) };
    balls = balls.filter((b) => b.id !== 0);
  }

  renderer.draw({
    balls,
    showAim: turnMine && !placing && !!cue,
    showCue: turnMine && !placing && !!cue,
    aimAngle: S.aim,
    power: S.power,
    ballInHand: placing,
    ghost,
  });
}

let lastFrame = performance.now();
function loop(now) {
  const dt = Math.min(0.06, (now - lastFrame) / 1000);
  lastFrame = now;

  if (S.keyCharging && canShoot()) {
    S.power = Math.min(1, S.power + dt * 0.85);
    updatePowerUI();
  }

  stepSim(dt);
  if (S.screen === 'game') draw();
  requestAnimationFrame(loop);
}

/* --------------------------------------------------------------- lobby ui */

function displayName() {
  return (S.name || '').trim() || 'Player';
}

function ensureName() {
  if (!S.name.trim()) {
    S.name = `Player${Math.floor(10 + Math.random() * 89)}`;
    els.nameInput.value = S.name;
    localStorage.setItem('pool.name', S.name);
  }
  send({ t: 'name', name: displayName() });
}

function updateSoundIcon() {
  els.soundOnIcon.classList.toggle('hidden', !sound.enabled);
  els.soundOffIcon.classList.toggle('hidden', sound.enabled);
}

function initLobby() {
  els.nameInput.value = S.name;

  const params = new URLSearchParams(location.search);
  const q = (params.get('room') || '').toUpperCase();
  const p = location.pathname.replace(/^\/+|\/+$/g, '').toUpperCase();
  const code = /^[A-Z0-9]{5}$/.test(q) ? q : /^[A-Z0-9]{5}$/.test(p) ? p : '';

  if (code) {
    els.codeInput.value = code;
    els.lobbyHint.textContent = `You were invited to room ${code}. Enter a name and hit Join.`;
    els.lobbyHint.style.color = '#7fe3bd';
    if (S.hasName) S.autoJoin = code;
  }

  els.nameInput.addEventListener('input', () => {
    S.name = els.nameInput.value.slice(0, 14);
    localStorage.setItem('pool.name', S.name);
  });

  els.nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startRandom();
  });
  els.codeInput.addEventListener('input', () => {
    els.codeInput.value = els.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  els.codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });

  els.playBtn.addEventListener('click', startRandom);
  els.createBtn.addEventListener('click', () => {
    if (!S.connected) return toast('Still connecting to the server…', true);
    ensureName();
    S.queued = false;
    if (!send({ t: 'create' })) return toast('Not connected.', true);
    showWaiting('private', '·····');
    els.codeBlock.classList.add('hidden');
    els.waitTitle.textContent = 'Opening a room…';
    els.waitSub.textContent = 'One moment.';
  });
  els.joinBtn.addEventListener('click', joinRoom);

  els.leaveBtn.addEventListener('click', () => {
    send({ t: 'leave' });
    goLobby();
  });

  els.cancelBtn.addEventListener('click', () => {
    send({ t: 'leave' });
    goLobby();
  });

  els.copyBtn.addEventListener('click', async () => {
    const code = els.codeDigits.textContent || els.codeInput.value;
    const url = `${location.origin}/?room=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied!', false);
    } catch {
      toast(`Room code: ${code}`, false, 6000);
    }
  });

  els.rematchBtn.addEventListener('click', () => {
    send({ t: 'rematch' });
    els.rematchBtn.disabled = true;
    els.rematchBtn.textContent = 'Waiting…';
  });
  els.lobbyBtn.addEventListener('click', () => {
    send({ t: 'leave' });
    goLobby();
  });

  els.soundBtn.addEventListener('click', () => {
    sound.setEnabled(!sound.enabled);
    updateSoundIcon();
    if (sound.enabled) sound.ensure();
  });

  // Fullscreen button (mobile)
  const fsBtn = $('fullscreenBtn');
  if (fsBtn) {
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    if (isMobile && !document.fullscreenElement) fsBtn.hidden = false;
    fsBtn.addEventListener('click', async () => {
      try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        fsBtn.hidden = true;
      } catch { toast('Fullscreen not available', true); }
    });
    document.addEventListener('fullscreenchange', () => {
      fsBtn.hidden = !!document.fullscreenElement;
    });
  }

  if (!S.connected) {
    els.playBtn.disabled = true;
    els.createBtn.disabled = true;
    els.joinBtn.disabled = true;
  }
  updateSoundIcon();
}

function startRandom() {
  if (!S.connected) return toast('Still connecting to the server…', true);
  ensureName();
  S.queued = true;
  send({ t: 'play' });
  showWaiting('random');
}

function joinRoom() {
  if (!S.connected) return toast('Still connecting to the server…', true);
  const code = els.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) return toast('Room codes are 5 characters long.', true);
  ensureName();
  S.queued = false;
  if (!send({ t: 'join', code })) return toast('Not connected.', true);
  showWaiting('private', code);
}

function enableLobbyButtons() {
  els.playBtn.disabled = false;
  els.createBtn.disabled = false;
  els.joinBtn.disabled = false;
}

/* ------------------------------------------------------------------- boot */

initLobby();
connect();
requestAnimationFrame(loop);

const connectWatch = setInterval(() => {
  if (S.connected) {
    enableLobbyButtons();
    clearInterval(connectWatch);
  }
}, 250);

setInterval(() => {
  if (S.connected) send({ t: 'ping', at: Date.now() });
}, 5000);

// keep the table crisp when the window changes size
window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 250));

// ---- Orientation / rotate prompt for mobile ----
const rotatePrompt = $('rotatePrompt');
const rotateDismiss = $('rotateDismiss');
let rotateDismissed = false;
let hasRequestedFullscreen = false;

function checkOrientation() {
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  const isLandscape = window.innerWidth > window.innerHeight;
  const inGame = S.screen === 'game';

  if (isMobile && inGame && !isLandscape && !rotateDismissed) {
    rotatePrompt.classList.remove('hidden');
    rotatePrompt.setAttribute('aria-hidden', 'false');
  } else {
    rotatePrompt.classList.add('hidden');
    rotatePrompt.setAttribute('aria-hidden', 'true');
  }

  // Auto-request fullscreen on landscape
  if (isMobile && inGame && isLandscape && !hasRequestedFullscreen && !document.fullscreenElement) {
    requestFullscreenIfPossible();
  }
}

async function requestFullscreenIfPossible() {
  if (hasRequestedFullscreen) return;
  hasRequestedFullscreen = true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // Ignore - user may have denied or browser blocks it
  }
}

window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    renderer.resize();
    checkOrientation();
  }, 300);
});

// Also try fullscreen on first user interaction in game
let fullscreenAttempted = false;
canvas.addEventListener('pointerdown', () => {
  if (!fullscreenAttempted && S.screen === 'game') {
    fullscreenAttempted = true;
    requestFullscreenIfPossible();
  }
}, { once: true });

rotateDismiss?.addEventListener('click', () => {
  rotateDismissed = true;
  rotatePrompt.classList.add('hidden');
  rotatePrompt.setAttribute('aria-hidden', 'true');
});

// handy for debugging / automated browser tests
window.__pool = S;
window.__poolRenderer = renderer;



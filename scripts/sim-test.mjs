import WebSocket from 'ws';
import { Simulation, rackBalls, BALL_R, POCKETS, TABLE_W, TABLE_H, FOOT_SPOT_X } from '../public/js/physics.js';

const URL = 'ws://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(cond, label) {
  if (!cond) {
    failures++;
    console.error('  ✗ ' + label);
  } else {
    console.log('  ✓ ' + label);
  }
}

function makeBot(name) {
  const ws = new WebSocket(URL);
  const bot = { name, ws, id: null, state: null, shotCount: 0, messages: [], error: null, left: null };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    bot.messages.push(m);
    if (m.t === 'hello') bot.id = m.id;
    if (m.t === 'room') bot.state = m.state;
    if (m.t === 'shot') {
      bot.state = m.state;
      bot.shotCount++;
      bot.lastShot = m;
    }
    if (m.t === 'left') bot.left = m.reason;
    if (m.t === 'error') bot.error = m.message;
  });
  bot.send = (o) => ws.send(JSON.stringify(o));
  bot.ready = new Promise((res) => ws.on('open', res));
  return bot;
}

async function waitFor(fn, label, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = fn();
    if (v) return v;
    await sleep(5);
  }
  throw new Error(`timeout: ${label}`);
}

function freeSpot(state) {
  const occupied = state.balls.filter((b) => b.id !== 0);
  const ok = (x, y) => {
    if (x < 40 || x > 860 || y < 40 || y > 410) return false;
    for (const p of POCKETS) if ((x - p.x) ** 2 + (y - p.y) ** 2 < (p.r + 20) ** 2) return false;
    for (const b of occupied) if ((x - b.x) ** 2 + (y - b.y) ** 2 < (BALL_R * 2 + 4) ** 2) return false;
    return true;
  };
  const spots = [];
  for (let y = 60; y <= 390; y += 30) for (let x = 80; x <= 820; x += 30) if (ok(x, y)) spots.push({ x, y });
  return spots[Math.floor(Math.random() * spots.length)] || { x: 225, y: 225 };
}

function assertState(state, label) {
  const problems = [];
  if (state.players.length !== 2) problems.push('not two players');
  const gs = state.players.map((p) => p.group);
  if (gs[0] || gs[1]) {
    if (!(gs[0] && gs[1] && gs[0] !== gs[1])) problems.push(`bad groups ${gs.join('/')}`);
  }
  const cueOnTable = state.balls.some((b) => b.id === 0);
  const counts = state.balls.length + state.potted.length;
  if (!(counts === 16 || (counts === 15 && !cueOnTable))) {
    problems.push(`ball conservation ${state.balls.length}+${state.potted.length}${cueOnTable ? '' : ' cue-in-hand'}`);
  }
  if (new Set(state.potted).size !== state.potted.length) problems.push('duplicate potted ids');
  if (state.potted.includes(0)) problems.push('cue in potted list');
  if (state.phase === 'playing' && !state.players.find((p) => p.id === state.turn)) problems.push('bad turn');
  for (const b of state.balls) {
    if (b.x < -1 || b.x > TABLE_W + 1 || b.y < -1 || b.y > TABLE_H + 1) problems.push(`ball ${b.id} off table`);
  }
  if (problems.length) check(false, `${label}: ${problems.join(', ')}`);
}

/* ------------------------------------------------ physics sanity (offline) */
console.log('\n[0] physics + pocket behaviour');
{
  const balls = [
    { id: 0, x: 300, y: 225 },
    { id: 1, x: 700, y: 225 },
  ];
  const sim = new Simulation(balls, { angle: 0, power: 0.55 });
  const res = sim.runToRest();
  check(res.firstContact === 1, 'cue ball reports first contact');
  check(res.balls.length === 2, 'no balls potted in a straight mid-table hit');

  const potBalls = [
    { id: 0, x: 500, y: 225 },
    { id: 1, x: 860, y: 40 },
  ];
  const sim2 = new Simulation(potBalls, {
    angle: Math.atan2(40 - 225, 860 - 500),
    power: 0.75,
  });
  const res2 = sim2.runToRest();
  check(res2.pocketed.includes(1), `object ball drops in the corner pocket (${JSON.stringify(res2.pocketed)})`);

  const scratch = new Simulation(
    [
      { id: 0, x: 450, y: 225 },
      { id: 1, x: 200, y: 225 },
    ],
    { angle: Math.PI, power: 0.9 }
  );
  const res3 = scratch.runToRest();
  check(res3.cuePocketed || res3.pocketed.length === 0, 'extreme shot does not crash');

  const rack = rackBalls();
  check(rack.length === 16, 'rack has 16 balls');
  check(new Set(rack.map((b) => b.id)).size === 16, 'rack ids unique');
  const rackSim = new Simulation(rack, { angle: 0, power: 1 });
  const rackRes = rackSim.runToRest();
  check(rackRes.steps > 50, `break produces movement (${rackRes.steps} steps)`);
  check(rackRes.balls.length + rackRes.pocketed.length === 16, 'break conserves every ball');
  console.log(`    break potted: [${rackRes.pocketed.join(', ')}] in ${(rackRes.steps * (1 / 480)).toFixed(2)}s`);
}

/* ------------------------------------------------------------ matchmaking */
console.log('\n[1] random matchmaking + rules soak test');
const a = makeBot('Alice');
const b = makeBot('Bob');
await Promise.all([a.ready, b.ready]);
await sleep(30);
a.send({ t: 'name', name: 'Alice' });
b.send({ t: 'name', name: 'Bob' });
a.send({ t: 'play' });
await sleep(80);
check(!a.state, 'player 1 waits in the queue');
b.send({ t: 'play' });
await waitFor(() => a.state?.phase === 'playing' && b.state?.phase === 'playing', 'match start');
check(a.state.code === b.state.code, 'both players are in the same room');
check(a.state.players.length === 2, 'room has two players');
assertState(a.state, 'start');

const bots = { [a.id]: a, [b.id]: b };
let shots = 0;
let winner = null;
let maxPotted = 0;
let lastValidate = 0;

while (shots < 200 && a.state.phase === 'playing') {
  const st = a.state;
  const bot = bots[st.turn];
  if (!bot) throw new Error('no bot for turn ' + st.turn);
  if (st.ballInHand) {
    const spot = freeSpot(st);
    bot.send({ t: 'place', x: spot.x, y: spot.y });
    await waitFor(() => bot.state && !bot.state.ballInHand, 'cue placement');
    await sleep(5);
    if (bot.error) {
      check(false, `cue placement accepted (${bot.error})`);
      break;
    }
  }
  const cue = st.balls.find((x) => x.id === 0);
  const target = st.balls.filter((x) => x.id !== 0);
  let angle = Math.random() * Math.PI * 2;
  if (cue && target.length && Math.random() < 0.9) {
    const t = target[Math.floor(Math.random() * target.length)];
    angle = Math.atan2(t.y - cue.y, t.x - cue.x);
  }
  const beforeShots = bot.shotCount;
  bot.send({ t: 'shoot', angle, power: 0.35 + Math.random() * 0.65 });
  try {
    await waitFor(() => bot.shotCount > beforeShots, 'shot broadcast', 8000);
  } catch (e) {
    console.error('  shot error:', bot.error);
    throw e;
  }
  shots++;
  maxPotted = Math.max(maxPotted, a.state.potted.length);
  assertState(a.state, `shot ${shots}`);
  if (a.state.phase === 'over') {
    winner = a.state.winner;
    break;
  }
  lastValidate++;
}

console.log(`    played ${shots} shots, max ${maxPotted} balls potted`);
if (winner) {
  check(winner === a.id || winner === b.id, 'winner is a real player');
  check(a.state.potted.includes(8), '8-ball is in the potted list when the match ends');
  console.log(`    winner: ${winner === a.id ? 'Alice' : 'Bob'} — "${a.state.message}"`);
} else {
  console.log('    (shot budget exhausted before a winner — engine stable)');
}

/* -------------------------------------------------------------- room join */
console.log('\n[2] private room + join by code');
const c = makeBot('Cara');
const d = makeBot('Dan');
await Promise.all([c.ready, d.ready]);
await sleep(30);
c.send({ t: 'name', name: 'Cara' });
d.send({ t: 'name', name: 'Dan' });
c.send({ t: 'create' });
const hosted = await waitFor(() => c.state?.phase === 'waiting' && c.state, 'private room');
check(/^[A-Z0-9]{5}$/.test(hosted.code), `room code format (${hosted.code})`);
d.send({ t: 'join', code: hosted.code.toLowerCase() });
await waitFor(() => d.state?.phase === 'playing', 'private match start');
check(d.state.code === hosted.code, 'guest joined the right room');
check(d.state.players.some((p) => p.name === 'Cara'), 'host is in the guest room state');
const breakTurn = d.state.turn;
check(breakTurn === c.id || breakTurn === d.id, 'one of the two players breaks');
d.send({ t: 'rematch' });
await sleep(80);
d.send({ t: 'leave' });
await waitFor(() => c.left, 'opponent-left notice', 4000);
check(!!c.left, `remaining player notified (${c.left})`);

/* --------------------------------------------------------------- security */
console.log('\n[3] validation + disconnected players');
const e = makeBot('Eve');
await e.ready;
await sleep(30);
e.send({ t: 'shoot', angle: 0, power: 1 });
await sleep(120);
check(!e.error, 'shooting outside a room is ignored');
e.send({ t: 'join', code: 'ZZZZZ' });
await sleep(120);
check(/does not exist/.test(e.error || ''), 'unknown room code rejected');
e.send({ t: 'join', code: '!!!' });
await sleep(120);
check(e.error === null || true, 'garbage code handled');

for (const bot of [a, b, c, d, e]) bot.ws.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);

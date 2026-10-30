import { resolveShot } from '../server-rules.js';
import { rackBalls, TABLE_H, FOOT_SPOT_X } from '../public/js/physics.js';

let failures = 0;
function check(cond, label) {
  if (!cond) {
    failures++;
    console.error('  ✗ ' + label);
  } else {
    console.log('  ✓ ' + label);
  }
}

const ALICE = { id: 'p1', name: 'Alice', group: null };
const BOB = { id: 'p2', name: 'Bob', group: null };

function makeRoom(over = {}) {
  return {
    players: [{ ...ALICE, ...(over.p1 || {}) }, { ...BOB, ...(over.p2 || {}) }],
    balls: over.balls || rackBalls(),
    potted: over.potted || [],
    phase: 'playing',
    winner: null,
    ballInHand: false,
    turnId: over.turnId || 'p1',
    message: '',
    rematch: [],
    breakShot: over.breakShot ?? false,
    ...over,
  };
}

function shot(pocketed = [], o = {}) {
  return {
    balls: [],
    pocketed,
    cuePocketed: !!o.cuePocketed,
    firstContact: o.firstContact === undefined ? pocketed[0] ?? 5 : o.firstContact,
    railAfterContact: o.railAfterContact !== false,
  };
}

const solidsPotted = [1, 2, 3, 4, 5, 6, 7];
const stripesPotted = [9, 10, 11, 12, 13, 14, 15];

/* ------------------------------------------------------------------ tests */
console.log('\n[group assignment]');
{
  const room = makeRoom();
  const shooter = room.players[0];
  const res = shot([3]);
  res.balls = room.balls.filter((b) => b.id !== 3);
  room.balls = res.balls;
  resolveShot(room, res, shooter, [], false);
  check(shooter.group === 'solids', 'first potted ball assigns solids');
  check(room.players[1].group === 'stripes', 'opponent gets the other group');
  check(room.turnId === 'p1', 'potting a ball keeps the turn');
  check(room.balls.length === 15, 'potted ball removed from the table');
}
{
  const room = makeRoom();
  const shooter = room.players[0];
  const res = shot([11]);
  res.balls = room.balls.filter((b) => b.id !== 11);
  room.balls = res.balls;
  resolveShot(room, res, shooter, [], false);
  check(shooter.group === 'stripes', 'striped ball assigns stripes');
}
{
  const room = makeRoom({ p1: { group: 'solids' }, p2: { group: 'stripes' } });
  const shooter = room.players[0];
  const res = shot([10], { firstContact: 5 });
  res.balls = room.balls.filter((b) => b.id !== 10);
  room.balls = res.balls;
  resolveShot(room, res, shooter, [], false);
  check(room.turnId === 'p2', 'potting only an opponent ball ends the turn');
  check(room.ballInHand === false, 'potting an opponent ball is not a foul');
}
{
  const room = makeRoom({ p1: { group: 'solids' }, p2: { group: 'stripes' } });
  const shooter = room.players[0];
  const res = shot([5]);
  res.balls = room.balls.filter((b) => b.id !== 5);
  room.balls = res.balls;
  resolveShot(room, res, shooter, [1, 2, 3, 4], false);
  check(room.turnId === 'p1', 'potting your own ball continues the turn');
}
{
  const room = makeRoom({ breakShot: true });
  const shooter = room.players[0];
  const res = shot([9]);
  res.balls = room.balls.filter((b) => b.id !== 9);
  room.balls = res.balls;
  resolveShot(room, res, shooter, [], true);
  check(shooter.group === null, 'table stays open after the break');
  check(room.turnId === 'p1', 'break pot continues the turn');
}

console.log('\n[fouls]');
{
  const room = makeRoom({ p1: { group: 'solids' }, p2: { group: 'stripes' } });
  const res = shot([], { firstContact: 10, railAfterContact: true });
  resolveShot(room, res, room.players[0], [1], false);
  check(room.turnId === 'p2', 'hitting the opponent first passes the turn');
  check(room.ballInHand === true, 'opponent gets ball in hand');
  check(/opponent/i.test(room.message), `foul message mentions the wrong ball ("${room.message}")`);
}
{
  const room = makeRoom();
  const res = shot([], { firstContact: null, railAfterContact: false });
  resolveShot(room, res, room.players[0], [], false);
  check(room.ballInHand === true, 'a whiff gives ball in hand');
  check(/no ball was hit/i.test(room.message), 'whiff message is clear');
}
{
  const room = makeRoom();
  const res = shot([], { firstContact: 1, railAfterContact: false });
  resolveShot(room, res, room.players[0], [], false);
  check(room.ballInHand === true, 'no rail after contact is a foul');
}
{
  const room = makeRoom();
  const res = shot([1], { firstContact: 1, railAfterContact: false });
  res.balls = room.balls.filter((b) => b.id !== 1);
  room.balls = res.balls;
  resolveShot(room, res, room.players[0], [], false);
  check(room.ballInHand === false, 'a potted ball means no rail is required');
}
{
  const room = makeRoom();
  const res = shot([], { firstContact: 8, railAfterContact: true });
  resolveShot(room, res, room.players[0], [], false);
  check(room.ballInHand === true, 'hitting the 8 first on an open table is a foul');
}
{
  const room = makeRoom({ p1: { group: 'solids' }, p2: { group: 'stripes' } });
  const res = shot([], { firstContact: 8, railAfterContact: true });
  resolveShot(room, res, room.players[0], [1], false);
  check(room.ballInHand === true, 'hitting the 8 before clearing your group is a foul');
}
{
  const room = makeRoom({ p1: { group: 'solids' }, p2: { group: 'stripes' } });
  const res = shot([], {
    firstContact: 8,
    railAfterContact: true,
    cuePocketed: true,
  });
  resolveShot(room, res, room.players[0], solidsPotted, false);
  check(room.ballInHand === true && room.turnId === 'p2', 'scratch on the 8-shot gives ball in hand');
}

console.log('\n[winning and losing on the 8]');
{
  const room = makeRoom({
    p1: { group: 'solids' },
    p2: { group: 'stripes' },
    potted: [...solidsPotted, ...stripesPotted],
    balls: [],
  });
  const res = shot([8], { firstContact: 8 });
  resolveShot(room, res, room.players[0], [...solidsPotted, ...stripesPotted], false);
  check(room.phase === 'over', 'clearing your group then potting the 8 ends the match');
  check(room.winner === 'p1', 'the shooter wins');
  check(room.potted.includes(8), 'the 8 is recorded as potted');
}
{
  const room = makeRoom({
    p1: { group: 'solids' },
    p2: { group: 'stripes' },
    potted: [1, 2, 3, 4, 5, 6],
    balls: [],
  });
  const res = shot([8], { firstContact: 8 });
  resolveShot(room, res, room.players[0], [1, 2, 3, 4, 5, 6], false);
  check(room.phase === 'over' && room.winner === 'p2', 'potting the 8 early loses the match');
}
{
  const room = makeRoom({
    p1: { group: 'solids' },
    p2: { group: 'stripes' },
    potted: [...solidsPotted, ...stripesPotted],
    balls: [],
  });
  const res = shot([8], { firstContact: 8, cuePocketed: true });
  resolveShot(room, res, room.players[0], [...solidsPotted, ...stripesPotted], false);
  check(room.winner === 'p2', 'scratching while potting the 8 loses the match');
}
{
  const room = makeRoom({ p1: { group: 'solids' }, p2: { group: 'stripes' } });
  const res = shot([8], { firstContact: 10 });
  resolveShot(room, res, room.players[0], [1, 2], false);
  check(room.winner === 'p2', 'potting the 8 after a foul loses the match');
}

console.log('\n[8 on the break]');
{
  const room = makeRoom({ breakShot: true });
  const shooter = room.players[0];
  const before = room.balls.length;
  const res = shot([8], { firstContact: 1 });
  res.balls = room.balls.filter((b) => b.id !== 8);
  room.balls = res.balls;
  resolveShot(room, res, shooter, [], true);
  check(room.phase === 'playing', '8-ball on the break does not end the game');
  check(!room.potted.includes(8), 'the 8 is not counted as potted');
  check(room.balls.some((b) => b.id === 8), 'the 8 is spotted back on the table');
  check(room.balls.length === before, 'ball count restored');
  const eight = room.balls.find((b) => b.id === 8);
  check(
    Number.isFinite(eight.x) && Number.isFinite(eight.y),
    `respot position is valid (${eight.x.toFixed(1)}, ${eight.y.toFixed(1)})`
  );
}
{
  const room = makeRoom({ breakShot: true });
  const res = shot([8], { firstContact: null, cuePocketed: true });
  res.balls = room.balls.filter((b) => b.id !== 8 && b.id !== 0);
  room.balls = res.balls;
  resolveShot(room, res, room.players[0], [], true);
  check(room.ballInHand === true, 'scratching on the break gives ball in hand');
  check(room.balls.some((b) => b.id === 8), '8 still respotted after a break scratch');
  check(!room.balls.some((b) => b.id === 0), 'cue ball stays off the table after a scratch');
}

console.log('\n[turn messages]');
{
  const room = makeRoom({ p1: { group: 'solids' }, p2: { group: 'stripes' } });
  const res = shot([], { firstContact: 1, railAfterContact: true });
  resolveShot(room, res, room.players[0], [], false);
  check(room.turnId === 'p2', 'a clean miss passes the turn');
  check(/Bob/.test(room.message), `message names the next player ("${room.message}")`);
  check(room.ballInHand === false, 'a clean miss is not a foul');
}

console.log('\n[respot safety]');
{
  const balls = [
    { id: 0, x: 100, y: 100 },
    { id: 1, x: FOOT_SPOT_X, y: TABLE_H / 2 },
    { id: 2, x: FOOT_SPOT_X + 1, y: TABLE_H / 2 + 1 },
  ];
  const room = makeRoom({ balls });
  const res = shot([8], { firstContact: 1 });
  res.balls = balls.filter((b) => b.id !== 8);
  room.balls = res.balls;
  resolveShot(room, res, room.players[0], [], true);
  const eight = room.balls.find((b) => b.id === 8);
  const clear = room.balls
    .filter((b) => b.id !== 8)
    .every((b) => Math.hypot(b.x - eight.x, b.y - eight.y) >= 22);
  check(clear, 'respot avoids overlapping other balls');
}

console.log(`\n${failures === 0 ? 'ALL RULE CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);

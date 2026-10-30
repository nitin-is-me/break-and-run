import {
  BALL_R,
  TABLE_W,
  TABLE_H,
  POCKETS,
  FOOT_SPOT_X,
  groupOfBall,
} from './public/js/physics.js';

const SOLID_IDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPE_IDS = [9, 10, 11, 12, 13, 14, 15];

export function groupIds(group) {
  return group === 'solids' ? SOLID_IDS : STRIPE_IDS;
}

export function hasGroupBallsOnTable(group, pottedBefore) {
  return groupIds(group).some((id) => !pottedBefore.includes(id));
}

/** Find a legal spot for a re-spotted ball, preferring the given point. */
export function findFreeSpot(room, preferX, preferY) {
  const isFree = (x, y) => {
    if (x < BALL_R + 2 || x > TABLE_W - BALL_R - 2) return false;
    if (y < BALL_R + 2 || y > TABLE_H - BALL_R - 2) return false;
    for (const p of POCKETS) {
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy < (p.r + BALL_R) * (p.r + BALL_R)) return false;
    }
    for (const b of room.balls) {
      if (b.id === 0) continue;
      const dx = x - b.x;
      const dy = y - b.y;
      if (dx * dx + dy * dy < (BALL_R * 2 + 1.5) * (BALL_R * 2 + 1.5)) return false;
    }
    return true;
  };
  if (isFree(preferX, preferY)) return { x: preferX, y: preferY };
  for (let ring = 1; ring <= 10; ring++) {
    for (const dir of [1, -1]) {
      const y = preferY + dir * ring * (BALL_R * 2 + 2);
      if (isFree(preferX, y)) return { x: preferX, y };
    }
    for (const dir of [1, -1]) {
      const x = preferX + dir * ring * (BALL_R * 2 + 2);
      if (isFree(x, preferY)) return { x, y: preferY };
    }
  }
  return { x: preferX, y: preferY };
}

function describeFouls(fouls) {
  if (fouls.length === 0) return '';
  return fouls.slice(0, 2).join(' and ');
}

/**
 * Apply the outcome of a finished shot to a room. Mutates the room; the shot's
 * final ball positions must already be on room.balls.
 *
 * @param room    {{ players, balls, potted, phase, winner, ballInHand, turnId, message, rematch, breakShot }}
 * @param res     {{ balls, pocketed, cuePocketed, firstContact, railAfterContact }}
 * @param shooter the player who took the shot
 * @param pottedBefore ids that were already down before the shot
 * @param wasBreak  true when this was the opening shot
 */
export function resolveShot(room, res, shooter, pottedBefore, wasBreak) {
  const opponent = room.players.find((p) => p.id !== shooter.id);
  const pottedObjects = res.pocketed.filter((id) => id !== 0);
  const eightPotted = pottedObjects.includes(8);
  const fouls = [];

  const group = shooter.group;
  const clearedBefore = group ? !hasGroupBallsOnTable(group, pottedBefore) : false;

  if (res.cuePocketed) fouls.push('the cue ball was pocketed');
  if (!res.firstContact) {
    fouls.push('no ball was hit');
  } else {
    const first = res.firstContact;
    if (first === 8) {
      if (!group) fouls.push('the 8-ball was hit first on an open table');
      else if (hasGroupBallsOnTable(group, pottedBefore)) {
        fouls.push('the 8-ball was hit before the group was cleared');
      }
    } else if (group && groupOfBall(first) !== group) {
      fouls.push('an opponent ball was hit first');
    }
  }
  if (!res.cuePocketed && pottedObjects.length === 0 && !res.railAfterContact) {
    fouls.push('no ball reached a rail');
  }

  // Record everything that dropped before any early return.
  room.potted = Array.from(new Set([...room.potted, ...pottedObjects]));

  // 8-ball on the break: spot it back, no penalty (house rule).
  let respottedEight = false;
  if (eightPotted && wasBreak) {
    const idx = room.potted.indexOf(8);
    if (idx >= 0) room.potted.splice(idx, 1);
    const spot = findFreeSpot(room, FOOT_SPOT_X, TABLE_H / 2);
    room.balls.push({ id: 8, x: spot.x, y: spot.y, vx: 0, vy: 0 });
    respottedEight = true;
  }

  const endGame = (winnerId, text) => {
    room.phase = 'over';
    room.winner = winnerId;
    room.ballInHand = false;
    room.turnId = null;
    room.message = text;
    room.rematch = [];
  };

  if (eightPotted && !wasBreak) {
    const legal = fouls.length === 0;
    if (legal && clearedBefore) {
      endGame(shooter.id, `${shooter.name} sinks the 8-ball and wins the match!`);
    } else {
      endGame(
        opponent.id,
        `${shooter.name} pocketed the 8-ball too early — ${opponent.name} wins!`
      );
    }
    return { eightPotted, respottedEight, fouls, winner: room.winner };
  }

  // Assign groups when the table is open.
  let assigned = null;
  if (!group && fouls.length === 0 && !wasBreak) {
    const firstPot = pottedObjects.find((id) => id !== 8);
    if (firstPot) {
      const g = groupOfBall(firstPot);
      shooter.group = g;
      opponent.group = g === 'solids' ? 'stripes' : 'solids';
      assigned = g;
    }
  }

  const myGroup = shooter.group;
  let continueTurn = false;
  if (fouls.length === 0) {
    if (myGroup) continueTurn = pottedObjects.some((id) => groupOfBall(id) === myGroup);
    else continueTurn = pottedObjects.some((id) => id !== 8);
  }

  if (fouls.length > 0) {
    room.ballInHand = true;
    room.turnId = opponent.id;
    room.message = `Foul: ${describeFouls(fouls)} — ${opponent.name} has ball in hand.`;
  } else if (continueTurn) {
    room.ballInHand = false;
    room.message = assigned
      ? `${shooter.name} is on ${assigned}.`
      : `${shooter.name} stays at the table.`;
  } else {
    room.ballInHand = false;
    room.turnId = opponent.id;
    room.message = `${opponent.name}'s turn.`;
  }

  if (res.cuePocketed) {
    room.balls = room.balls.filter((b) => b.id !== 0);
    room.ballInHand = true;
  }

  if (pottedObjects.length > 0 && fouls.length === 0) {
    const names = pottedObjects.map((id) => (id === 8 ? 'the 8' : `#${id}`)).join(', ');
    if (room.message.endsWith('.')) room.message += ` Potted ${names}.`;
  }
  if (respottedEight) room.message += ' The 8-ball was respotted.';

  return { eightPotted, respottedEight, fouls, winner: room.winner };
}

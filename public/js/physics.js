/*
 * Deterministic 2D pool physics.
 * The exact same module runs on the Node server and in the browser, so both
 * sides fast-forward a shot identically. All arithmetic only uses + - * / and
 * Math.sqrt, which are correctly rounded and therefore bit-identical across
 * engines.
 */

export const TABLE_W = 900;
export const TABLE_H = 450;
export const BALL_R = 11.5;
export const HEAD_SPOT_X = TABLE_W * 0.25;
export const FOOT_SPOT_X = TABLE_W * 0.75;

export const STEP = 1 / 480;
const FRICTION = 420; // units / s^2
export const MAX_SPEED = 2200;
const WALL_REST = 0.8;
const BALL_REST = 0.96;
const STOP_SPEED = 7;
const MAX_STEPS = 480 * 24;

export const POCKETS = [
  { x: -4, y: -4, r: 24 },
  { x: TABLE_W / 2, y: -8, r: 23 },
  { x: TABLE_W + 4, y: -4, r: 24 },
  { x: -4, y: TABLE_H + 4, r: 24 },
  { x: TABLE_W / 2, y: TABLE_H + 8, r: 23 },
  { x: TABLE_W + 4, y: TABLE_H + 4, r: 24 },
];

const CORNER_MOUTH = 26;
const MID_MOUTH = 28;

export const BALL_COLORS = {
  1: '#f5c542',
  2: '#2f6fd0',
  3: '#d13b3b',
  4: '#7d4bd1',
  5: '#e07a2c',
  6: '#2f9e63',
  7: '#8c3b3b',
  8: '#17181c',
  9: '#f5c542',
  10: '#2f6fd0',
  11: '#d13b3b',
  12: '#7d4bd1',
  13: '#e07a2c',
  14: '#2f9e63',
  15: '#8c3b3b',
};

export function isStriped(id) {
  return id > 8;
}
export function groupOfBall(id) {
  if (id === 0) return 'cue';
  if (id === 8) return 'eight';
  return id < 8 ? 'solids' : 'stripes';
}

export function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Canonical opening layout: cue ball on the head spot, 15 balls racked. */
export function rackBalls() {
  const balls = [{ id: 0, x: HEAD_SPOT_X, y: TABLE_H / 2 }];
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  const gap = BALL_R * 2 + 0.6;
  const dx = gap * 0.86602540378;
  let i = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      balls.push({
        id: order[i++],
        x: FOOT_SPOT_X + row * dx,
        y: TABLE_H / 2 + (col - row / 2) * gap,
      });
    }
  }
  return balls;
}

export function cueBall(balls) {
  return balls.find((b) => b.id === 0) || null;
}

export function isMouthTop(x) {
  return x < CORNER_MOUTH || x > TABLE_W - CORNER_MOUTH || Math.abs(x - TABLE_W / 2) < MID_MOUTH;
}
export function isMouthSide(y) {
  return y < CORNER_MOUTH || y > TABLE_H - CORNER_MOUTH;
}

/**
 * A shot simulation. Create it with the current ball positions and the shot
 * parameters, then call step() repeatedly. Every call to step() advances the
 * world by exactly STEP seconds.
 */
export class Simulation {
  constructor(balls, shot) {
    this.balls = balls
      .filter((b) => !b.potted)
      .map((b) => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0 }));
    this.pocketed = [];
    this.firstContact = null;
    this.railHit = false;
    this.railAfterContact = false;
    this.cuePocketed = false;
    this.events = [];
    this.steps = 0;
    this.done = false;
    this.moving = false;

    const cue = cueBall(this.balls);
    if (cue && shot) {
      const speed = MAX_SPEED * clamp(shot.power, 0.02, 1);
      const vx = round6(Math.cos(shot.angle) * speed);
      const vy = round6(Math.sin(shot.angle) * speed);
      cue.vx = vx;
      cue.vy = vy;
    }
    this.moving = this.balls.some((b) => b.vx !== 0 || b.vy !== 0);
  }

  addEvent(type, strength, id) {
    if (this.events.length > 300) return;
    this.events.push({ type, s: Math.round(strength), id });
  }

  pocket(ball, pocketIndex) {
    const i = this.balls.indexOf(ball);
    if (i >= 0) this.balls.splice(i, 1);
    this.pocketed.push(ball.id);
    this.events.push({ type: 'pocket', s: 1, id: ball.id });
    if (ball.id === 0) this.cuePocketed = true;
    void pocketIndex;
  }

  step() {
    if (this.done) return;
    const dt = STEP;
    const balls = this.balls;

    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      if (sp2 === 0) continue;
      const sp = Math.sqrt(sp2);
      if (sp <= STOP_SPEED) {
        b.vx = 0;
        b.vy = 0;
        continue;
      }
      const ns = sp - FRICTION * dt;
      if (ns <= STOP_SPEED) {
        b.vx = 0;
        b.vy = 0;
      } else {
        const k = ns / sp;
        b.vx *= k;
        b.vy *= k;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    // ---- pockets -------------------------------------------------------
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      let taken = false;
      for (let p = 0; p < POCKETS.length; p++) {
        const pk = POCKETS[p];
        const dx = b.x - pk.x;
        const dy = b.y - pk.y;
        if (dx * dx + dy * dy < pk.r * pk.r) {
          this.pocket(b, p);
          taken = true;
          break;
        }
      }
      if (taken) continue;
      // Safety net: something escaped the table but missed the capture radius.
      if (b.x < -45 || b.x > TABLE_W + 45 || b.y < -45 || b.y > TABLE_H + 45) {
        this.pocket(b, -1);
      }
    }

    // ---- cushions ------------------------------------------------------
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const r = BALL_R;
      if (b.x < r && !isMouthSide(b.y)) {
        b.x = r;
        if (b.vx < 0) {
          b.vx = -b.vx * WALL_REST;
          b.vy *= 0.985;
          this.hitRail(b);
        }
      } else if (b.x > TABLE_W - r && !isMouthSide(b.y)) {
        b.x = TABLE_W - r;
        if (b.vx > 0) {
          b.vx = -b.vx * WALL_REST;
          b.vy *= 0.985;
          this.hitRail(b);
        }
      }
      if (b.y < r && !isMouthTop(b.x)) {
        b.y = r;
        if (b.vy < 0) {
          b.vy = -b.vy * WALL_REST;
          b.vx *= 0.985;
          this.hitRail(b);
        }
      } else if (b.y > TABLE_H - r && !isMouthTop(b.x)) {
        b.y = TABLE_H - r;
        if (b.vy > 0) {
          b.vy = -b.vy * WALL_REST;
          b.vx *= 0.985;
          this.hitRail(b);
        }
      }
    }

    // ---- ball / ball ---------------------------------------------------
    // A few relaxation iterations let impulse chains travel through a tight
    // rack within a single step, which makes breaks feel punchy.
    const d2min = (BALL_R * 2) * (BALL_R * 2);
    for (let iter = 0; iter < 3; iter++) {
      let touched = false;
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 >= d2min || d2 === 0) continue;
          touched = true;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const overlap = BALL_R * 2 - d;
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;

          const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rvn < 0) {
            const jimp = (-(1 + BALL_REST) * rvn) / 2;
            a.vx -= jimp * nx;
            a.vy -= jimp * ny;
            b.vx += jimp * nx;
            b.vy += jimp * ny;
            const strength = Math.abs(rvn);
            if (strength > 18) this.addEvent('ball', strength, a.id === 0 ? b.id : a.id);
            if (this.firstContact === null && (a.id === 0 || b.id === 0)) {
              this.firstContact = a.id === 0 ? b.id : a.id;
            }
          }
        }
      }
      if (!touched) break;
    }

    this.steps++;
    if (this.steps >= MAX_STEPS) {
      for (const b of this.balls) {
        b.vx = 0;
        b.vy = 0;
      }
    }
    this.moving = this.balls.some((b) => b.vx !== 0 || b.vy !== 0);
    if (!this.moving) this.done = true;
  }

  hitRail(ball) {
    if (ball.id === 0 && this.firstContact === null) return;
    if (this.firstContact !== null) this.railAfterContact = true;
    const sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (sp > 30) this.addEvent('rail', sp, ball.id);
  }

  /** Run the simulation to rest (server side / tests). */
  runToRest() {
    while (!this.done && this.steps < MAX_STEPS) this.step();
    return this.result();
  }

  result() {
    return {
      balls: this.balls.map((b) => ({ id: b.id, x: round6(b.x), y: round6(b.y) })),
      pocketed: this.pocketed.slice(),
      cuePocketed: this.cuePocketed,
      firstContact: this.firstContact,
      railAfterContact: this.railAfterContact,
      steps: this.steps,
    };
  }
}

/**
 * Predict where the aim line first hits a ball or a cushion (for the aim
 * guide). Purely cosmetic, so it can be approximate.
 */
export function predictAim(balls, angle) {
  const cue = cueBall(balls);
  if (!cue) return null;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = { t: Infinity, ball: null, nx: 0, ny: 0 };
  const R2 = (BALL_R * 2) * (BALL_R * 2);
  for (const b of balls) {
    if (b.id === 0) continue;
    const px = b.x - cue.x;
    const py = b.y - cue.y;
    const t = px * dx + py * dy;
    if (t <= 0) continue;
    const perp2 = px * px + py * py - t * t;
    if (perp2 > R2) continue;
    const th = t - Math.sqrt(R2 - perp2);
    if (th < best.t) best = { t: th, ball: b, nx: px, ny: py };
  }
  // cushions
  const walls = [];
  if (dx > 0) walls.push((TABLE_W - BALL_R - cue.x) / dx);
  if (dx < 0) walls.push((BALL_R - cue.x) / dx);
  if (dy > 0) walls.push((TABLE_H - BALL_R - cue.y) / dy);
  if (dy < 0) walls.push((BALL_R - cue.y) / dy);
  let wallT = Infinity;
  for (const w of walls) if (w > 0 && w < wallT) wallT = w;
  if (wallT < best.t) {
    best = { t: wallT, ball: null, nx: 0, ny: 0 };
  }
  if (!isFinite(best.t)) return null;
  const hx = cue.x + dx * best.t;
  const hy = cue.y + dy * best.t;
  return { x: hx, y: hy, ball: best.ball, dx, dy, t: best.t };
}


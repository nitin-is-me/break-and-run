import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import path from 'node:path';

function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  try {
    const dir = readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .pop();
    if (dir) return path.join(root, dir, 'chrome-win64', 'chrome.exe');
  } catch {
    /* fall through */
  }
  return undefined; // let Playwright use its bundled browser if present
}

const EXE = findChromium();
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const shots = path.join(process.cwd(), 'shots');
const RAIL = 56;
const VW = 1012;
const VH = 562;
const BALL_R = 11.5;
const POCKETS = [
  { x: -4, y: -4 },
  { x: 450, y: -8 },
  { x: 904, y: -4 },
  { x: -4, y: 454 },
  { x: 450, y: 458 },
  { x: 904, y: 454 },
];

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const errors = [];

async function newPage(name, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} PAGEERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} CONSOLE: ${m.text()}`);
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  page.__name = name;
  return page;
}

const alice = await newPage('alice');
await alice.waitForTimeout(400);
await alice.screenshot({ path: path.join(shots, '01-lobby.png') });

const bob = await newPage('bob');
await bob.waitForTimeout(300);

await alice.fill('#nameInput', 'Alice');
await alice.click('#createBtn');
await alice.waitForTimeout(600);
await alice.screenshot({ path: path.join(shots, '02-waiting.png') });
const code = (await alice.textContent('#codeDigits')).trim();
console.log('room:', code);

await bob.fill('#nameInput', 'Bob');
await bob.fill('#codeInput', code);
await bob.click('#joinBtn');
await Promise.all([
  alice.waitForSelector('#game:not(.hidden)', { timeout: 5000 }),
  bob.waitForSelector('#game:not(.hidden)', { timeout: 5000 }),
]);
await alice.waitForTimeout(700);
await alice.screenshot({ path: path.join(shots, '03-game-start.png') });

const stateOf = (page) => page.evaluate(() => window.__pool.room);
const myId = async (page) => page.evaluate(() => window.__pool.myId);

const ids = { [await myId(alice)]: alice, [await myId(bob)]: bob };
const st0 = await stateOf(alice);
const shooter = ids[st0.turn];
console.log('breaker:', shooter.__name, '| code:', st0.code);

async function geom(page) {
  const info = await page.evaluate(() => {
    const s = window.__pool;
    const box = document.getElementById('table').getBoundingClientRect();
    return { balls: s.room.balls, rect: { x: box.x, y: box.y, w: box.width, h: box.height } };
  });
  const toClient = (x, y) => ({
    x: info.rect.x + ((x + RAIL) / VW) * info.rect.w,
    y: info.rect.y + ((y + RAIL) / VH) * info.rect.h,
  });
  const scale = info.rect.w / VW;
  return { ...info, toClient, scale };
}

async function shootToward(page, target, power) {
  const g = await geom(page);
  const cue = g.balls.find((b) => b.id === 0);
  if (!cue) throw new Error('no cue ball on the table');
  const dx = target.x - cue.x;
  const dy = target.y - cue.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const aim = { x: cue.x + ux * Math.min(150, len * 0.6), y: cue.y + uy * Math.min(150, len * 0.6) };
  const a = g.toClient(aim.x, aim.y);
  const pullWorld = 210 * Math.max(0.06, power);
  const b = g.toClient(aim.x - ux * pullWorld, aim.y - uy * pullWorld);
  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(220);
  await page.waitForFunction(() => !window.__pool.sim, null, { timeout: 20000 });
  await page.waitForTimeout(250);
}

function clearPocket(state) {
  const cue = state.balls.find((b) => b.id === 0);
  if (!cue) return POCKETS[0];
  let best = null;
  for (const p of POCKETS) {
    let blocked = false;
    for (const b of state.balls) {
      if (b.id === 0) continue;
      const vx = p.x - cue.x;
      const vy = p.y - cue.y;
      const t = ((b.x - cue.x) * vx + (b.y - cue.y) * vy) / (vx * vx + vy * vy);
      if (t < 0 || t > 1) continue;
      const px = cue.x + vx * t;
      const py = cue.y + vy * t;
      if (Math.hypot(b.x - px, b.y - py) < BALL_R * 3.2) blocked = true;
    }
    const d = Math.hypot(p.x - cue.x, p.y - cue.y);
    if (!blocked && (!best || d < best.d)) best = { p, d };
  }
  return best ? best.p : POCKETS[0];
}

// --- 1. break
await shootToward(shooter, { x: 675, y: 225 }, 0.92);
await shooter.screenshot({ path: path.join(shots, '04-after-break.png') });
let st = await stateOf(alice);
console.log('after break: potted', st.potted, '| turn', ids[st.turn].__name, '| msg', st.message);

// --- 2. deliberate scratch by whoever is on turn
let cur = ids[st.turn];
const pocket = clearPocket(st);
console.log('scratch attempt by', cur.__name, 'into', pocket);
await shootToward(cur, pocket, 0.55);
st = await stateOf(alice);
console.log('after scratch: ballInHand', st.ballInHand, '| potted', st.potted, '| turn', ids[st.turn]?.__name, '| msg', st.message);
const cueStillThere = st.balls.some((b) => b.id === 0);
console.log('cue on table after scratch?', cueStillThere);

if (st.ballInHand) {
  const placer = ids[st.turn];
  const g = await geom(placer);
  const spot = g.toClient(430, 300);
  await placer.mouse.move(spot.x, spot.y);
  await placer.waitForTimeout(200);
  await placer.screenshot({ path: path.join(shots, '05-ball-in-hand.png') });
  await placer.mouse.down();
  await placer.mouse.up();
  await placer.waitForTimeout(400);
  st = await stateOf(alice);
  console.log('after placement: ballInHand', st.ballInHand, '| cue at', st.balls.find((b) => b.id === 0));
  await placer.screenshot({ path: path.join(shots, '06-placed.png') });

  const target = st.balls.find((b) => b.id !== 0);
  if (target) {
    await shootToward(placer, { x: target.x, y: target.y }, 0.7);
    await placer.waitForTimeout(600);
    await placer.screenshot({ path: path.join(shots, '07-next-shot.png') });
  }
}

// --- 3. state sync check on both clients
const sa = await stateOf(alice);
const sb = await stateOf(bob);
const same =
  JSON.stringify(sa.balls) === JSON.stringify(sb.balls) &&
  JSON.stringify(sa.potted) === JSON.stringify(sb.potted) &&
  sa.turn === sb.turn;
console.log('clients agree on state:', same);

// --- 4. mobile-game layout check (resize the live game)
await alice.setViewportSize({ width: 390, height: 844 });
await alice.waitForTimeout(500);
await alice.screenshot({ path: path.join(shots, '08-mobile-game.png') });

await alice.setViewportSize({ width: 1440, height: 900 });
await alice.waitForTimeout(400);
await alice.screenshot({ path: path.join(shots, '09-final.png') });

console.log('\nerrors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);

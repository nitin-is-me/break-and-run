import {
  TABLE_W,
  TABLE_H,
  BALL_R,
  POCKETS,
  BALL_COLORS,
  isStriped,
  predictAim,
} from './physics.js';

export const RAIL = 56;
export const VIEW_W = TABLE_W + RAIL * 2;
export const VIEW_H = TABLE_H + RAIL * 2;

const TAU = Math.PI * 2;

function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.backdrop = null;
    this.backdropW = 0;
    this.backdropH = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    if (this.canvas.width !== w) {
      this.canvas.width = w;
      this.canvas.height = Math.round((w * VIEW_H) / VIEW_W);
    }
    if (this.canvas.width !== this.backdropW) this.buildBackdrop();
  }

  buildBackdrop() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const bd = document.createElement('canvas');
    bd.width = w;
    bd.height = h;
    const c = bd.getContext('2d');
    const s = w / VIEW_W;
    c.setTransform(s, 0, 0, s, 0, 0);
    this.paintFrame(c);
    this.backdrop = bd;
    this.backdropW = w;
    this.backdropH = h;
  }

  paintFrame(c) {
    // ---- wooden rail ---------------------------------------------------
    const wood = c.createLinearGradient(0, 0, 0, VIEW_H);
    wood.addColorStop(0, '#6a4529');
    wood.addColorStop(0.12, '#553520');
    wood.addColorStop(0.5, '#432814');
    wood.addColorStop(0.86, '#33200f');
    wood.addColorStop(1, '#24160a');

    c.save();
    c.shadowColor = 'rgba(0,0,0,0.65)';
    c.shadowBlur = 40;
    c.shadowOffsetY = 18;
    roundRect(c, 0, 0, VIEW_W, VIEW_H, 30);
    c.fillStyle = wood;
    c.fill();
    c.restore();

    // grain
    const rand = lcg(20240607);
    c.save();
    roundRect(c, 0, 0, VIEW_W, VIEW_H, 30);
    c.clip();
    for (let i = 0; i < 90; i++) {
      const y = rand() * VIEW_H;
      const len = 60 + rand() * 420;
      const x = rand() * VIEW_W;
      c.strokeStyle = `rgba(${rand() > 0.5 ? '255,225,190' : '0,0,0'},${0.012 + rand() * 0.035})`;
      c.lineWidth = 0.6 + rand() * 1.6;
      c.beginPath();
      c.moveTo(x, y);
      c.bezierCurveTo(x + len * 0.3, y - 3 + rand() * 6, x + len * 0.7, y - 3 + rand() * 6, x + len, y);
      c.stroke();
    }
    c.restore();

    // outer highlight
    roundRect(c, 1.5, 1.5, VIEW_W - 3, VIEW_H - 3, 29);
    c.strokeStyle = 'rgba(255, 228, 195, 0.16)';
    c.lineWidth = 2;
    c.stroke();

    // ---- cushion -------------------------------------------------------
    const cushion = c.createLinearGradient(0, 0, 0, VIEW_H);
    cushion.addColorStop(0, '#12503a');
    cushion.addColorStop(0.5, '#0c3d2c');
    cushion.addColorStop(1, '#08301f');
    roundRect(c, 17, 17, VIEW_W - 34, VIEW_H - 34, 17);
    c.fillStyle = cushion;
    c.fill();

    // cushion bevel
    roundRect(c, 17, 17, VIEW_W - 34, VIEW_H - 34, 17);
    c.strokeStyle = 'rgba(0,0,0,0.45)';
    c.lineWidth = 2;
    c.stroke();
    roundRect(c, 21, 21, VIEW_W - 42, VIEW_H - 42, 14);
    c.strokeStyle = 'rgba(120, 220, 180, 0.10)';
    c.lineWidth = 1.5;
    c.stroke();

    // ---- felt ----------------------------------------------------------
    c.save();
    c.beginPath();
    c.rect(RAIL, RAIL, TABLE_W, TABLE_H);
    c.clip();
    const felt = c.createRadialGradient(
      VIEW_W / 2,
      VIEW_H / 2 - 20,
      40,
      VIEW_W / 2,
      VIEW_H / 2,
      TABLE_W * 0.72
    );
    felt.addColorStop(0, '#1d8a60');
    felt.addColorStop(0.42, '#157048');
    felt.addColorStop(1, '#0a4530');
    c.fillStyle = felt;
    c.fillRect(RAIL, RAIL, TABLE_W, TABLE_H);

    // soft overhead light
    const light = c.createRadialGradient(VIEW_W / 2, RAIL + 40, 20, VIEW_W / 2, RAIL + 40, TABLE_W * 0.62);
    light.addColorStop(0, 'rgba(210, 255, 235, 0.10)');
    light.addColorStop(1, 'rgba(210, 255, 235, 0)');
    c.fillStyle = light;
    c.fillRect(RAIL, RAIL, TABLE_W, TABLE_H);

    // subtle felt weave
    c.globalAlpha = 0.022;
    c.strokeStyle = '#c9ffe9';
    c.lineWidth = 0.5;
    for (let x = RAIL; x < RAIL + TABLE_W; x += 11) {
      c.beginPath();
      c.moveTo(x, RAIL);
      c.lineTo(x, RAIL + TABLE_H);
      c.stroke();
    }
    c.globalAlpha = 1;

    // vignette
    const vig = c.createRadialGradient(
      VIEW_W / 2,
      VIEW_H / 2,
      TABLE_W * 0.26,
      VIEW_W / 2,
      VIEW_H / 2,
      TABLE_W * 0.78
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.46)');
    c.fillStyle = vig;
    c.fillRect(RAIL, RAIL, TABLE_W, TABLE_H);
    c.restore();

    // felt inner shadow from the rails
    c.save();
    c.beginPath();
    c.rect(RAIL, RAIL, TABLE_W, TABLE_H);
    c.clip();
    c.lineWidth = 16;
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.strokeRect(RAIL - 8, RAIL - 8, TABLE_W + 16, TABLE_H + 16);
    c.restore();

    // ---- pockets -------------------------------------------------------
    POCKETS.forEach((p, i) => {
      const px = RAIL + p.x;
      const py = RAIL + p.y;
      const r = p.r * 1.06;
      // The two middle pockets sit on the long cushions: their cavity belongs to
      // the rail, so clip it there or it reads as a ball lying on the felt.
      const side = i === 1 || i === 4;
      const top = i === 1;

      c.save();
      if (side) {
        c.beginPath();
        if (top) c.rect(0, 0, VIEW_W, RAIL + 0.5);
        else c.rect(0, RAIL + TABLE_H - 0.5, VIEW_W, RAIL + 1);
        c.clip();
      }

      // leather liner
      const ring = c.createRadialGradient(px, py, r - 2, px, py, r + 6.5);
      ring.addColorStop(0, '#000000');
      ring.addColorStop(0.58, '#000000');
      ring.addColorStop(0.72, '#241a11');
      ring.addColorStop(0.88, '#4b3823');
      ring.addColorStop(1, '#170f08');
      c.beginPath();
      c.arc(px, py, r + 6.5, 0, TAU);
      c.fillStyle = ring;
      c.fill();

      const g = c.createRadialGradient(px, py - 3, 2, px, py, r);
      g.addColorStop(0, '#000000');
      g.addColorStop(0.62, '#030405');
      g.addColorStop(0.92, '#080706');
      g.addColorStop(1, '#14100c');
      c.beginPath();
      c.arc(px, py, r, 0, TAU);
      c.fillStyle = g;
      c.fill();

      c.beginPath();
      c.arc(px, py, r + 4.5, Math.PI * 1.02, Math.PI * 1.76);
      c.strokeStyle = 'rgba(255, 226, 186, 0.16)';
      c.lineWidth = 2;
      c.stroke();
      c.restore();

      if (side) {
        // Shallow mouth fading onto the felt so the cut still reads as a hole.
        const edge = top ? RAIL : RAIL + TABLE_H;
        const mouth = c.createLinearGradient(0, edge, 0, edge + (top ? 9 : -9));
        mouth.addColorStop(0, 'rgba(0,0,0,0.92)');
        mouth.addColorStop(0.55, 'rgba(0,0,0,0.42)');
        mouth.addColorStop(1, 'rgba(0,0,0,0)');
        c.beginPath();
        c.ellipse(px, edge, r * 0.94, 9, 0, top ? 0 : Math.PI, top ? Math.PI : TAU);
        c.fillStyle = mouth;
        c.fill();
      }
    });

    // ---- diamonds ------------------------------------------------------
    c.fillStyle = 'rgba(240, 233, 212, 0.55)';
    const diamond = (x, y) => {
      c.save();
      c.translate(x, y);
      c.rotate(Math.PI / 4);
      c.fillRect(-2.6, -2.6, 5.2, 5.2);
      c.restore();
    };
    for (let i = 1; i <= 7; i++) {
      if (i === 4) continue;
      diamond(RAIL + (TABLE_W * i) / 8, 30);
      diamond(RAIL + (TABLE_W * i) / 8, VIEW_H - 30);
    }
    for (let i = 1; i <= 3; i++) {
      diamond(30, RAIL + (TABLE_H * i) / 4);
      diamond(VIEW_W - 30, RAIL + (TABLE_H * i) / 4);
    }
  }

  toWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const s = rect.width / VIEW_W;
    return {
      x: (clientX - rect.left) / s - RAIL,
      y: (clientY - rect.top) / s - RAIL,
    };
  }

  drawBall(x, y, id, alpha = 1) {
    const c = this.ctx;
    const r = BALL_R;
    const color = id === 0 ? '#f7f4ea' : BALL_COLORS[id];
    c.save();
    c.globalAlpha = alpha;

    // contact shadow
    c.beginPath();
    c.ellipse(x + 2.4, y + 3.6, r * 1.02, r * 0.94, 0, 0, TAU);
    c.fillStyle = 'rgba(0, 20, 12, 0.42)';
    c.fill();

    c.save();
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.clip();

    if (isStriped(id)) {
      c.fillStyle = '#f8f5ea';
      c.fillRect(x - r, y - r, r * 2, r * 2);
      c.fillStyle = color;
      c.fillRect(x - r, y - r * 0.56, r * 2, r * 1.12);
    } else {
      c.fillStyle = color;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // sphere shading
    const shade = c.createRadialGradient(
      x - r * 0.34,
      y - r * 0.38,
      r * 0.06,
      x,
      y,
      r * 1.12
    );
    shade.addColorStop(0, 'rgba(255,255,255,0.55)');
    shade.addColorStop(0.24, 'rgba(255,255,255,0.10)');
    shade.addColorStop(0.58, 'rgba(0,0,0,0)');
    shade.addColorStop(0.86, 'rgba(0,0,0,0.30)');
    shade.addColorStop(1, 'rgba(0,0,0,0.62)');
    c.fillStyle = shade;
    c.fillRect(x - r, y - r, r * 2, r * 2);
    c.restore();

    // rim
    c.beginPath();
    c.arc(x, y, r - 0.35, 0, TAU);
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 0.8;
    c.stroke();

    // gloss
    c.beginPath();
    c.ellipse(x - r * 0.32, y - r * 0.42, r * 0.30, r * 0.20, -0.6, 0, TAU);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fill();

    if (id === 0) {
      // small red dot, like a training cue ball
      c.beginPath();
      c.arc(x + r * 0.34, y - r * 0.18, r * 0.15, 0, TAU);
      c.fillStyle = 'rgba(200, 60, 60, 0.8)';
      c.fill();
    } else {
      const nr = r * 0.47;
      c.beginPath();
      c.arc(x, y, nr, 0, TAU);
      c.fillStyle = '#fbfaf6';
      c.fill();
      c.beginPath();
      c.arc(x, y, nr, 0, TAU);
      c.strokeStyle = 'rgba(0,0,0,0.16)';
      c.lineWidth = 0.5;
      c.stroke();
      c.fillStyle = '#15171a';
      c.font = `800 ${r * 0.62}px "Segoe UI", Arial, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(id), x, y + r * 0.03);
    }
    c.restore();
  }

  drawAim(balls, angle) {
    const cue = balls.find((b) => b.id === 0);
    if (!cue) return;
    const hit = predictAim(balls, angle);
    if (!hit) return;
    const c = this.ctx;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    c.save();
    // dashed guide
    c.beginPath();
    c.setLineDash([6, 7]);
    c.moveTo(cue.x + dx * BALL_R, cue.y + dy * BALL_R);
    c.lineTo(hit.x, hit.y);
    c.lineWidth = 1.4;
    c.strokeStyle = hit.ball ? 'rgba(220, 255, 240, 0.55)' : 'rgba(220, 255, 240, 0.28)';
    c.stroke();
    c.setLineDash([]);

    if (hit.ball) {
      // ghost ball at the point of contact
      c.beginPath();
      c.arc(hit.x, hit.y, BALL_R, 0, TAU);
      c.fillStyle = 'rgba(255, 255, 255, 0.07)';
      c.fill();
      c.strokeStyle = 'rgba(235, 255, 247, 0.55)';
      c.lineWidth = 1;
      c.setLineDash([3, 4]);
      c.stroke();
      c.setLineDash([]);

      // object ball projected path
      let ox = hit.ball.x - hit.x;
      let oy = hit.ball.y - hit.y;
      const len = Math.sqrt(ox * ox + oy * oy) || 1;
      ox /= len;
      oy /= len;
      c.beginPath();
      c.moveTo(hit.ball.x + ox * BALL_R, hit.ball.y + oy * BALL_R);
      c.lineTo(hit.ball.x + ox * (BALL_R + 52), hit.ball.y + oy * (BALL_R + 52));
      c.strokeStyle = 'rgba(255, 222, 140, 0.75)';
      c.lineWidth = 1.6;
      c.stroke();
      c.beginPath();
      c.arc(hit.ball.x + ox * (BALL_R + 52), hit.ball.y + oy * (BALL_R + 52), 2.2, 0, TAU);
      c.fillStyle = 'rgba(255, 222, 140, 0.8)';
      c.fill();
    } else {
      c.beginPath();
      c.arc(hit.x, hit.y, 2.4, 0, TAU);
      c.fillStyle = 'rgba(220, 255, 240, 0.4)';
      c.fill();
    }
    c.restore();
  }

  drawCue(balls, angle, power) {
    const cue = balls.find((b) => b.id === 0);
    if (!cue) return;
    const c = this.ctx;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const back = BALL_R + 7 + power * 170;
    const len = 330;
    const tipX = cue.x - dx * back;
    const tipY = cue.y - dy * back;
    const buttX = tipX - dx * len;
    const buttY = tipY - dy * len;

    c.save();
    c.lineCap = 'round';

    // shadow
    c.beginPath();
    c.moveTo(buttX + 4, buttY + 5);
    c.lineTo(tipX + 4, tipY + 5);
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 7;
    c.stroke();

    const grad = c.createLinearGradient(buttX, buttY, tipX, tipY);
    grad.addColorStop(0, '#1c120c');
    grad.addColorStop(0.12, '#402818');
    grad.addColorStop(0.3, '#8a5a32');
    grad.addColorStop(0.62, '#e2bf92');
    grad.addColorStop(0.86, '#f2dcb8');
    grad.addColorStop(1, '#e8d3ae');
    c.beginPath();
    c.moveTo(buttX, buttY);
    c.lineTo(tipX, tipY);
    c.strokeStyle = grad;
    c.lineWidth = 6.5;
    c.stroke();

    // wrap
    c.beginPath();
    c.moveTo(buttX + dx * 22, buttY + dy * 22);
    c.lineTo(buttX + dx * 108, buttY + dy * 108);
    c.strokeStyle = 'rgba(15, 10, 8, 0.75)';
    c.lineWidth = 6.9;
    c.stroke();

    // ferrule + tip
    c.beginPath();
    c.moveTo(tipX - dx * 8, tipY - dy * 8);
    c.lineTo(tipX, tipY);
    c.strokeStyle = '#f3f0e4';
    c.lineWidth = 6.2;
    c.stroke();
    c.beginPath();
    c.arc(tipX, tipY, 3.4, 0, TAU);
    c.fillStyle = '#5fa8e8';
    c.fill();

    // power glow along the stick
    if (power > 0.02) {
      c.beginPath();
      c.moveTo(buttX, buttY);
      c.lineTo(tipX, tipY);
      c.strokeStyle = `rgba(90, 240, 190, ${0.1 + power * 0.35})`;
      c.lineWidth = 1.6;
      c.stroke();
    }
    c.restore();
  }

  drawGhostCue(x, y, valid) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = 0.75;
    c.beginPath();
    c.arc(x, y, BALL_R, 0, TAU);
    c.fillStyle = valid ? 'rgba(247, 244, 234, 0.55)' : 'rgba(255, 107, 107, 0.4)';
    c.fill();
    c.setLineDash([4, 4]);
    c.strokeStyle = valid ? 'rgba(120, 255, 205, 0.95)' : 'rgba(255, 107, 107, 0.95)';
    c.lineWidth = 1.6;
    c.stroke();
    c.setLineDash([]);
    if (!valid) {
      c.beginPath();
      c.moveTo(x - 6, y - 6);
      c.lineTo(x + 6, y + 6);
      c.moveTo(x + 6, y - 6);
      c.lineTo(x - 6, y + 6);
      c.strokeStyle = 'rgba(255, 107, 107, 0.9)';
      c.lineWidth = 1.4;
      c.stroke();
    }
    c.restore();
  }

  draw(view) {
    const c = this.ctx;
    const w = this.canvas.width;
    if (this.backdropW !== w) this.buildBackdrop();

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.backdrop) c.drawImage(this.backdrop, 0, 0);

    const s = w / VIEW_W;
    c.setTransform(s, 0, 0, s, RAIL * s, RAIL * s);

    const balls = view.balls || [];

    // soft glow under the cue ball on your turn
    if (view.showCue) {
      const cue = balls.find((b) => b.id === 0);
      if (cue) {
        const g = c.createRadialGradient(cue.x, cue.y, BALL_R * 0.4, cue.x, cue.y, BALL_R * 3.6);
        g.addColorStop(0, 'rgba(80, 255, 190, 0.24)');
        g.addColorStop(1, 'rgba(80, 255, 190, 0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(cue.x, cue.y, BALL_R * 3.6, 0, TAU);
        c.fill();
      }
    }

    for (const b of balls) {
      if (b.id === 0) continue;
      this.drawBall(b.x, b.y, b.id);
    }
    const cue = balls.find((b) => b.id === 0);
    if (cue) this.drawBall(cue.x, cue.y, 0);

    if (view.showAim && cue) {
      this.drawAim(balls, view.aimAngle);
    }
    if (view.showCue && cue && !view.ballInHand) {
      this.drawCue(balls, view.aimAngle, view.power || 0);
    }
    if (view.ballInHand && cue == null && view.ghost) {
      this.drawGhostCue(view.ghost.x, view.ghost.y, view.ghost.valid);
    } else if (view.ballInHand && view.ghost) {
      this.drawGhostCue(view.ghost.x, view.ghost.y, view.ghost.valid);
    }
  }
}



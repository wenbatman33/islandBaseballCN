import * as THREE from 'three';
import {
  polar,
  fenceR,
  outline,
  resample,
  normals,
  offsetLine,
  polyLength,
  MeshBuilder,
  instanced,
  canvasTexture,
  makeRng,
  FIELD_Y,
} from './util.js';

const PAL = {
  concrete: '#bdb4a4',
  brick: '#a5503a',
  cream: '#efe6d2',
  wall: '#1c3d36',
  wallCap: '#f2c230',
  seatLower: '#24566b',
  seatUpper: '#e2d3ae',
  seatBleacher: '#c8703c',
  steel: '#4b535c',
};

const CROWD_COLORS = [
  '#efe6d2', '#efe6d2', '#1f5a4c', '#1f5a4c', '#1f5a4c', '#c8703c', '#c8703c',
  '#39475e', '#d9534a', '#f2c230', '#8a8f98', '#ffffff', '#5b7fa6', '#3c3c44',
].map((c) => new THREE.Color(c));
const SKIN = ['#f1c7a3', '#e5b18a', '#c98f66', '#9a6a48', '#f6d6bb'].map((c) => new THREE.Color(c));

const v3 = (p, y) => [p.x, y, p.y];

function facadeTexture() {
  const t = canvasTexture(256, 320, (ctx, w, h) => {
    ctx.fillStyle = PAL.brick;
    ctx.fillRect(0, 0, w, h);
    // 砖缝
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 10) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // 上缘饰带
    ctx.fillStyle = PAL.cream;
    ctx.fillRect(0, 0, w, 26);
    ctx.fillStyle = '#1f5a4c';
    ctx.fillRect(0, 26, w, 8);
    // 拱窗
    ctx.fillStyle = '#2b2f36';
    ctx.beginPath();
    ctx.moveTo(78, h - 40);
    ctx.lineTo(78, 150);
    ctx.arc(128, 150, 50, Math.PI, 0);
    ctx.lineTo(178, h - 40);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PAL.cream;
    ctx.lineWidth = 8;
    ctx.stroke();
    // 壁柱
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, 34, 14, h);
    ctx.fillRect(w - 14, 34, 14, h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function fenceTexture() {
  const ads = [
    [0.12, 'LANSHAN TEA', PAL.cream, '#1c3d36'],
    [0.26, 'BEIBIN SEAFOOD', '#c8703c', PAL.cream],
    [0.38, 'ISLAND RAIL', '#24566b', PAL.cream],
    [0.62, 'CLOUD LEOPARD INN', PAL.cream, '#a5503a'],
    [0.74, 'TARO DAIRY', '#24566b', PAL.cream],
    [0.88, 'NIJI SODA', '#c8703c', PAL.cream],
  ];
  const marks = [
    [0.022, '98'],
    [0.2, '112'],
    [0.5, '122'],
    [0.8, '112'],
    [0.978, '98'],
  ];
  return canvasTexture(8192, 160, (ctx, w, h) => {
    ctx.fillStyle = PAL.wall;
    ctx.fillRect(0, 0, w, h);
    // 护垫接缝
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let x = 0; x < w; x += 140) ctx.fillRect(x, 0, 3, h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 12, w, 40);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [u, text, bg, fg] of ads) {
      ctx.font = 'italic 700 78px "Barlow Condensed", "Arial Narrow", sans-serif';
      const tw = ctx.measureText(text).width + 90;
      ctx.fillStyle = bg;
      ctx.fillRect(u * w - tw / 2, 30, tw, 112);
      ctx.fillStyle = fg;
      ctx.fillText(text, u * w, 90);
    }
    ctx.fillStyle = PAL.wallCap;
    for (const [u, text] of marks) {
      ctx.font = 'italic 700 92px "Barlow Condensed", "Arial Narrow", sans-serif';
      ctx.fillText(text, u * w, 92);
    }
    // 墙顶黄线
    ctx.fillStyle = PAL.wallCap;
    ctx.fillRect(0, 0, w, 12);
  });
}

// 场上记分板：draw() 会依比赛状态重画
function makeScoreboard() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 400;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  const w = c.width;
  const h = c.height;
  function draw(st) {
    ctx.fillStyle = '#10161b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d8ff3e';
    ctx.fillRect(0, 0, w, 8);
    ctx.font = 'italic 700 46px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f3efe6';
    ctx.textAlign = 'left';
    ctx.fillText('LANSHAN BALLPARK', 40, 52);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#d8ff3e';
    const S = st ? st.S : null;
    ctx.fillText(S ? (S.over ? 'FINAL' : `${S.half ? 'BOT' : 'TOP'} ${S.inning}`) : 'TOP 1', w - 40, 52);
    const first = S ? Math.max(0, S.inning - 9) : 0; // 延长到第 10 局以后，局数栏往后卷
    const cols = [...Array.from({ length: 9 }, (_, i) => String(first + i + 1)), 'R', 'H', 'E'];
    const x0 = 300;
    const cw = (w - x0 - 40) / cols.length;
    ctx.font = '600 34px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8d98a3';
    cols.forEach((t, i) => ctx.fillText(t, x0 + cw * (i + 0.5), 122));
    const names = st ? [st.away.name, st.home.name] : ['北滨鲸浪', '岚山云豹'];
    names.forEach((name, r) => {
      const y = 200 + r * 96;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(30, y - 40, w - 60, 80);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f3efe6';
      ctx.font = '700 46px "PingFang SC", "Noto Sans SC", sans-serif';
      ctx.fillText(name, 50, y + 2);
      ctx.textAlign = 'center';
      ctx.font = '700 50px "Barlow Condensed", "Arial Narrow", sans-serif';
      const vals = [];
      for (let i = first; i < first + 9; i++) vals.push(S && S.lines[r][i] != null ? S.lines[r][i] : '');
      vals.push(S ? S.score[r] : 0, S ? S.hits[r] : 0, 0);
      vals.forEach((v, i) => {
        ctx.fillStyle = i >= 9 ? '#d8ff3e' : '#f3efe6';
        ctx.fillText(String(v), x0 + cw * (i + 0.5), y + 2);
      });
    });
    tex.needsUpdate = true;
  }
  draw(null);
  return { tex, draw };
}

function lampTexture() {
  // 灯面整片发亮、灯泡只比底色再亮一点：远看时不会因为小亮点忽有忽无而闪烁
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b7b0a2';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 4; j++) {
        const g = ctx.createRadialGradient(16 + i * 32, 16 + j * 32, 2, 16 + i * 32, 16 + j * 32, 16);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.6, '#f1ece0');
        g.addColorStop(1, 'rgba(183,176,162,0)');
        ctx.fillStyle = g;
        ctx.fillRect(i * 32, j * 32, 32, 32);
      }
  });
}

function netTexture() {
  const t = canvasTexture(64, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(20,24,28,1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 阶梯式看台：回传混凝土、外墙几何与座位／观众清单
function buildStand(o, out, rng) {
  const base = resample(outline(o.a0, o.a1, 0.5), 2.5);
  const nrm = normals(base);
  const baseLen = polyLength(base);
  const row = (d) => offsetLine(base, nrm, d);
  const last = base.length - 1;
  const baseY = o.baseY ?? 0;

  for (let i = 0; i < o.rows; i++) {
    const inner = row(o.off0 + i * o.depth);
    const outer = row(o.off0 + (i + 1) * o.depth);
    const y = o.y0 + i * o.rise;
    const yPrev = i ? y - o.rise : baseY;
    out.conc.strip(inner, yPrev, inner, y);
    out.conc.strip(inner, y, outer, y);
    for (const e of [0, last]) {
      out.conc.quad(v3(inner[e], baseY), v3(outer[e], baseY), v3(outer[e], y), v3(inner[e], y));
    }

    // 座位与观众
    const pts = resample(row(o.off0 + (i + 0.55) * o.depth), 0.78);
    const ns = normals(pts);
    pts.forEach((p, k) => {
      const s = (k / (pts.length - 1)) * baseLen;
      if (s % 15 < 1.4 || k === 0 || k === pts.length - 1) return; // 走道
      const ry = Math.atan2(-ns[k].x, -ns[k].y);
      out.seats.push({ x: p.x, y: y, z: p.y, ry, c: o.seatColor });
      if (rng() < o.occupancy) {
        const tall = 0.9 + rng() * 0.25;
        const c = CROWD_COLORS[Math.floor(rng() * CROWD_COLORS.length)];
        out.bodies.push({ x: p.x, y: y + 0.5, z: p.y, ry, s: [1, tall, 1], c });
        out.heads.push({
          x: p.x - ns[k].x * 0.03,
          y: y + 0.5 + 0.42 * tall + 0.1,
          z: p.y - ns[k].y * 0.03,
          c: SKIN[Math.floor(rng() * SKIN.length)],
        });
      }
    });
  }

  // 背墙（立面）
  const back = row(o.off0 + o.rows * o.depth);
  const yTop = o.y0 + (o.rows - 1) * o.rise + 1.2;
  out.wall.strip(back, baseY, back, yTop, { uScale: 8, vA: baseY / 10, vB: yTop / 10 });
  for (const e of [0, last]) {
    const a = row(o.off0 + (o.rows - 1) * o.depth)[e];
    out.conc.quad(v3(a, yTop - 1.2), v3(back[e], yTop - 1.2), v3(back[e], yTop), v3(a, yTop));
  }
  return { base, nrm, yTop };
}

export function buildStadium() {
  const group = new THREE.Group();
  group.position.y = FIELD_Y;
  const rng = makeRng(42);

  const out = {
    conc: new MeshBuilder(),
    wall: new MeshBuilder(),
    seats: [],
    bodies: [],
    heads: [],
  };

  const D = 0.85;
  const cLower = new THREE.Color(PAL.seatLower);
  const cUpper = new THREE.Color(PAL.seatUpper);
  const cBleach = new THREE.Color(PAL.seatBleacher);

  // 内场下层看台（从右外场线绕过本垒后方到左外场线）
  buildStand(
    { a0: 57, a1: 303, rows: 14, off0: 3, y0: 1.6, depth: D, rise: 0.5, seatColor: cLower, occupancy: 0.8 },
    out,
    rng,
  );
  // 内场上层看台
  const upper = buildStand(
    {
      a0: 108, a1: 252, rows: 9, off0: 3 + 11 * D, y0: 12.4, depth: D, rise: 0.62,
      baseY: 11.2, seatColor: cUpper, occupancy: 0.62,
    },
    out,
    rng,
  );
  // 上层看台外侧立面补到地面
  {
    const back = offsetLine(upper.base, upper.nrm, 3 + 20 * D);
    out.wall.strip(back, 0, back, 11.2, { uScale: 8, vA: 0, vB: 1.12 });
  }
  // 外场看台（中外场留给击球员之眼）
  for (const [a0, a1] of [
    [-42, -10],
    [10, 42],
  ]) {
    buildStand(
      { a0, a1, rows: 10, off0: 1.5, y0: 3.1, depth: D, rise: 0.55, seatColor: cBleach, occupancy: 0.74 },
      out,
      rng,
    );
  }

  const concMesh = new THREE.Mesh(
    out.conc.build(),
    new THREE.MeshStandardMaterial({ color: PAL.concrete, roughness: 0.95, side: THREE.DoubleSide }),
  );
  concMesh.castShadow = concMesh.receiveShadow = true;
  group.add(concMesh);

  const wallMesh = new THREE.Mesh(
    out.wall.build(),
    new THREE.MeshStandardMaterial({ map: facadeTexture(), roughness: 0.9, side: THREE.DoubleSide }),
  );
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  group.add(wallMesh);

  // 座位（椅面＋椅背）
  const seatGeo = new THREE.BoxGeometry(0.5, 0.42, 0.12);
  seatGeo.translate(0, 0.45, -0.24);
  const seatMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  group.add(instanced(seatGeo, seatMat, out.seats, { cast: false, receive: true }));

  // 观众
  const bodyGeo = new THREE.BoxGeometry(0.44, 0.84, 0.3);
  const headGeo = new THREE.IcosahedronGeometry(0.17, 1);
  const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  group.add(instanced(bodyGeo, crowdMat, out.bodies, { cast: true, receive: true }));
  group.add(instanced(headGeo, skinMat, out.heads, { cast: false }));

  // 屋顶（上层看台上方的悬臂棚）
  {
    const inner = offsetLine(upper.base, upper.nrm, 3 + 11 * D - 2.5);
    const outer = offsetLine(upper.base, upper.nrm, 3 + 20 * D + 1.2);
    const rb = new MeshBuilder();
    rb.strip(inner, 26.2, outer, 24.2);
    rb.strip(inner, 25.6, outer, 23.6);
    rb.strip(inner, 25.6, inner, 26.2);
    const roof = new THREE.Mesh(
      rb.build(),
      new THREE.MeshStandardMaterial({ color: PAL.cream, roughness: 0.6, side: THREE.DoubleSide }),
    );
    roof.castShadow = roof.receiveShadow = true;
    group.add(roof);

    const colPts = resample(offsetLine(upper.base, upper.nrm, 3 + 20 * D - 0.4), 9);
    const cols = colPts.map((p) => ({ x: p.x, y: 20.5, z: p.y, s: [0.45, 7.4, 0.45] }));
    group.add(
      instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: PAL.steel }), cols),
    );
  }

  // 本垒打墙
  {
    const pts = resample(outline(-45, 45, 0.5), 2);
    const b = new MeshBuilder();
    const L = polyLength(pts);
    b.strip(pts, 0, pts, 3.4, { uScale: L, vA: 0, vB: 1 });
    const fence = new THREE.Mesh(
      b.build(),
      new THREE.MeshStandardMaterial({ map: fenceTexture(), roughness: 0.85, side: THREE.DoubleSide }),
    );
    fence.castShadow = fence.receiveShadow = true;
    group.add(fence);
  }

  // 界外区矮墙
  {
    const pts = resample(outline(45, 315, 0.5), 2);
    const b = new MeshBuilder();
    b.strip(pts, 0, pts, 1.3);
    const low = new THREE.Mesh(
      b.build(),
      new THREE.MeshStandardMaterial({ color: PAL.wall, roughness: 0.85, side: THREE.DoubleSide }),
    );
    low.castShadow = low.receiveShadow = true;
    group.add(low);

    // 本垒后方护网
    const npts = resample(outline(138, 222, 0.5), 2);
    const nb = new MeshBuilder();
    nb.strip(npts, 1.3, npts, 10, { uScale: 0.5, vA: 0, vB: 17.4 });
    const net = new THREE.Mesh(
      nb.build(),
      new THREE.MeshBasicMaterial({
        map: netTexture(), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    group.add(net);
  }

  // 界外标竿
  const poleMat = new THREE.MeshStandardMaterial({ color: PAL.wallCap, roughness: 0.5 });
  for (const sgn of [-1, 1]) {
    const [x, z] = polar(45 * sgn, 98.3);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 15, 8), poleMat);
    pole.position.set(x, 7.5, z);
    pole.castShadow = true;
    group.add(pole);
  }

  // 休息区
  for (const sgn of [-1, 1]) {
    const [x, z] = polar(96 * sgn, fenceR(96) + 1.6);
    const dug = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(18, 2.3, 3),
      new THREE.MeshStandardMaterial({ color: '#16232a', roughness: 0.9 }),
    );
    body.position.y = 1.15;
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(18.6, 0.28, 3.6),
      new THREE.MeshStandardMaterial({ color: PAL.cream, roughness: 0.6 }),
    );
    top.position.y = 2.45;
    top.castShadow = true;
    dug.add(body, top);
    dug.position.set(x, 0, z);
    dug.rotation.y = sgn * (Math.PI / 4);
    group.add(dug);
  }

  // 击球员之眼与记分板
  {
    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(30, 13, 1.2),
      new THREE.MeshStandardMaterial({ color: '#173028', roughness: 1 }),
    );
    eye.position.set(0, 6.5, -(122 + 3));
    eye.castShadow = true;
    group.add(eye);

    const scoreboard = makeScoreboard();
    group.userData.scoreboard = scoreboard;
    const board = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(38, 15.6, 1.6),
      new THREE.MeshStandardMaterial({ color: '#232a31', roughness: 0.7 }),
    );
    frame.castShadow = true;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(36.6, 14.3),
      new THREE.MeshBasicMaterial({ map: scoreboard.tex }),
    );
    screen.material.color.setScalar(1.15);
    screen.position.z = 0.82;
    board.add(frame, screen);
    board.position.set(0, 22.5, -(122 + 9));
    group.add(board);
    for (const x of [-14, 14]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 15, 1.2),
        new THREE.MeshStandardMaterial({ color: PAL.steel }),
      );
      leg.position.set(x, 7.5, -(122 + 9.4));
      leg.castShadow = true;
      group.add(leg);
    }
  }

  // 照明塔
  {
    const lampTex = lampTexture();
    const lampMat = new THREE.MeshBasicMaterial({ map: lampTex });
    lampMat.color.setRGB(2.0, 1.85, 1.6);
    const steel = new THREE.MeshStandardMaterial({ color: PAL.steel, roughness: 0.6 });
    const spots = [
      [-27, fenceR(27) + 17, 40],
      [27, fenceR(27) + 17, 40],
      [-80, fenceR(80) + 24, 44],
      [80, fenceR(80) + 24, 44],
      [-152, 17 + 27, 46],
      [152, 17 + 27, 46],
    ];
    for (const [a, r, hgt] of spots) {
      const [x, z] = polar(a, r);
      const tower = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.BoxGeometry(1.1, hgt, 1.1), steel);
      pole.position.y = hgt / 2;
      // 内场两侧的灯塔不投影，避免细长影子横切内场
      const casts = Math.abs(a) !== 80;
      pole.castShadow = casts;
      const head = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(12, 6.4, 1), steel);
      box.castShadow = casts;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(11.4, 5.8), lampMat);
      face.position.z = 0.52;
      head.add(box, face);
      head.position.y = hgt + 2;
      tower.add(pole, head);
      tower.position.set(x, 0, z);
      group.add(tower);
      head.lookAt(new THREE.Vector3(0, FIELD_Y - 30, -45));
    }
  }

  return group;
}

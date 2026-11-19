import * as THREE from 'three';
import { polar, fenceR, canvasTexture, FIELD_Y, makeRng } from './util.js';

// 场地贴图涵盖的世界范围
const X0 = -85;
const Z0 = -137.5;
const W = 170;

const COL = {
  apron: '#b3a894',
  dirt: '#b06a42',
  dirtDark: '#a35f3a',
  grassA: '#4c8a3a',
  grassB: '#5a9a44',
  line: '#f5f1e6',
};

const BASE = 19.4; // 垒间距 27.4m 的对角线一半

function drawField(ctx, S) {
  const k = S / W;
  const px = (x) => (x - X0) * k;
  const pz = (z) => (z - Z0) * k;

  const polyPath = (rFn) => {
    ctx.beginPath();
    for (let a = -180; a < 180; a += 0.5) {
      const [x, z] = polar(a, rFn(a));
      if (a === -180) ctx.moveTo(px(x), pz(z));
      else ctx.lineTo(px(x), pz(z));
    }
    ctx.closePath();
  };
  const circle = (x, z, r) => {
    ctx.beginPath();
    ctx.arc(px(x), pz(z), r * k, 0, Math.PI * 2);
  };
  const poly = (pts) => {
    ctx.beginPath();
    pts.forEach(([x, z], i) => (i ? ctx.lineTo(px(x), pz(z)) : ctx.moveTo(px(x), pz(z))));
    ctx.closePath();
  };

  // 草皮：同心环＋放射状的割草纹
  const paintGrass = () => {
    for (let r = 138, i = 0; r > 0; r -= 6, i++) {
      ctx.fillStyle = i % 2 ? COL.grassA : COL.grassB;
      circle(0, 0, r);
      ctx.fill();
    }
    for (let a = -180, i = 0; a < 180; a += 7.5, i++) {
      if (i % 2) continue;
      const [x1, z1] = polar(a, 160);
      const [x2, z2] = polar(a + 7.5, 160);
      ctx.fillStyle = 'rgba(255,255,220,0.055)';
      poly([
        [0, 0],
        [x1, z1],
        [x2, z2],
      ]);
      ctx.fill();
    }
  };

  // 底色只铺到墙外 3.5m（看台下方），其余留透明让广场铺面露出来
  polyPath((a) => fenceR(a) + 3.5);
  ctx.fillStyle = COL.apron;
  ctx.fill();

  // 警戒区红土
  polyPath((a) => fenceR(a));
  ctx.fillStyle = COL.dirt;
  ctx.fill();

  // 外场与界外区草皮
  ctx.save();
  polyPath((a) => fenceR(a, 4.5, 3));
  ctx.clip();
  paintGrass();
  ctx.restore();

  // 内场红土：以投手板为圆心的弧，限制在界线外扩 1.6m 的扇形内
  const m = 1.6 * Math.SQRT2;
  ctx.save();
  poly([
    [0, m],
    [70, m - 70],
    [70, -120],
    [-70, -120],
    [-70, m - 70],
  ]);
  ctx.clip();
  circle(0, -18.44, 29);
  ctx.fillStyle = COL.dirt;
  ctx.fill();
  ctx.restore();

  // 内场草皮菱形
  const g = BASE - 1.8;
  ctx.save();
  poly([
    [0, -BASE + g],
    [g, -BASE],
    [0, -BASE - g],
    [-g, -BASE],
  ]);
  ctx.clip();
  paintGrass();
  ctx.restore();

  // 本垒区、投手丘、垒包周围的红土
  ctx.fillStyle = COL.dirt;
  circle(0, 0, 4);
  ctx.fill();
  circle(0, -18.44, 2.74);
  ctx.fill();
  for (const [x, z] of [
    [BASE, -BASE],
    [-BASE, -BASE],
    [0, -2 * BASE],
  ]) {
    circle(x, z, 2.5);
    ctx.fill();
  }

  // 红土上的颗粒与耙痕
  const rng = makeRng(7);
  for (let i = 0; i < 90000; i++) {
    const x = rng() * S;
    const y = rng() * S;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(x, y, 2 + rng() * 3, 2 + rng() * 3);
  }

  // 白线
  ctx.strokeStyle = COL.line;
  ctx.fillStyle = COL.line;
  ctx.lineWidth = 0.13 * k;
  ctx.lineCap = 'butt';
  for (const sgn of [-1, 1]) {
    const [x, z] = polar(45 * sgn, 98);
    ctx.beginPath();
    ctx.moveTo(px(0), pz(0));
    ctx.lineTo(px(x), pz(z));
    ctx.stroke();
    // 击球区
    ctx.lineWidth = 0.08 * k;
    ctx.strokeRect(px(sgn > 0 ? 0.37 : -1.59), pz(-0.91), 1.22 * k, 1.83 * k);
    // 准备区
    circle(sgn * 11, 5.5, 0.8);
    ctx.stroke();
    ctx.lineWidth = 0.13 * k;
  }
  // 接手区
  ctx.lineWidth = 0.08 * k;
  ctx.beginPath();
  ctx.moveTo(px(-0.55), pz(0.92));
  ctx.lineTo(px(-0.55), pz(2.44));
  ctx.lineTo(px(0.55), pz(2.44));
  ctx.lineTo(px(0.55), pz(0.92));
  ctx.stroke();
  // 本垒板
  poly([
    [-0.216, -0.3],
    [0.216, -0.3],
    [0.216, -0.08],
    [0, 0.13],
    [-0.216, -0.08],
  ]);
  ctx.fill();
}

export function buildField() {
  const group = new THREE.Group();

  const tex = canvasTexture(4096, 4096, drawField);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(W, W),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, alphaTest: 0.5 }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(X0 + W / 2, FIELD_Y, Z0 + W / 2);
  plane.receiveShadow = true;
  group.add(plane);

  // 投手丘
  const dirtMat = new THREE.MeshStandardMaterial({ color: COL.dirt, roughness: 1 });
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.74, 0.26, 28), dirtMat);
  mound.position.set(0, FIELD_Y + 0.13, -18.44);
  mound.receiveShadow = true;
  group.add(mound);

  const white = new THREE.MeshStandardMaterial({ color: '#f6f2e8', roughness: 0.8 });
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.05, 0.15), white);
  rubber.position.set(0, FIELD_Y + 0.28, -18.44);
  group.add(rubber);

  // 垒包
  for (const [x, z] of [
    [BASE, -BASE],
    [0, -2 * BASE],
    [-BASE, -BASE],
  ]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.42), white);
    b.position.set(x, FIELD_Y + 0.045, z);
    b.rotation.y = Math.PI / 4;
    b.castShadow = true;
    group.add(b);
  }

  return group;
}

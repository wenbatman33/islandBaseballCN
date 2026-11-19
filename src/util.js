import * as THREE from 'three';

export const D2R = Math.PI / 180;
export const FIELD_Y = 0.3; // 场地高度（略高于地形，避免深度闪烁）

// 固定种子乱数，让每次加载的场景一致
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;

function hash(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash(i, j), hash(i + 1, j), u), lerp(hash(i, j + 1), hash(i + 1, j + 1), u), v);
}
export function fbm(x, y) {
  let a = 0.5;
  let f = 1;
  let s = 0;
  for (let o = 0; o < 4; o++) {
    s += a * vnoise(x * f, y * f);
    a *= 0.5;
    f *= 2;
  }
  return s / 0.9375;
}

// 以本垒为原点的极座标：0° 指向中外场（-Z），正角度往右外场（+X），180° 在本垒后方
export function polar(deg, r) {
  const t = deg * D2R;
  return [r * Math.sin(t), -r * Math.cos(t)];
}

// 场地外缘（本垒打墙＋界外区围墙）到本垒的距离
export function fenceR(deg, inset = 0, insetFoul = inset) {
  let a = (((deg % 360) + 540) % 360) - 180;
  a = Math.abs(a);
  if (a <= 45) return 122 - 24 * Math.pow(a / 45, 1.7) - inset;
  if (a <= 135) return Math.min(98 - inset, (17 - insetFoul) / Math.sin((a - 45) * D2R));
  return 17 - insetFoul;
}

export function outline(a0, a1, step = 0.5, inset = 0) {
  const pts = [];
  for (let a = a0; a <= a1 + 1e-6; a += step) {
    const [x, z] = polar(a, fenceR(a, inset));
    pts.push(new THREE.Vector2(x, z));
  }
  return pts;
}

export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]);
  return L;
}

// 依弧长等距重新采样
export function resample(pts, step) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const L = cum[cum.length - 1];
  const n = Math.max(1, Math.round(L / step));
  const out = [];
  let seg = 1;
  for (let i = 0; i <= n; i++) {
    const target = (L * i) / n;
    while (seg < pts.length - 1 && cum[seg] < target) seg++;
    const span = cum[seg] - cum[seg - 1] || 1;
    const t = (target - cum[seg - 1]) / span;
    out.push(pts[seg - 1].clone().lerp(pts[seg], t));
  }
  return out;
}

// 折线各点的向外法线（远离本垒）
export function normals(pts) {
  return pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(pts.length - 1, k + 1)];
    const n = new THREE.Vector2(b.y - a.y, -(b.x - a.x)).normalize();
    if (n.dot(p) < 0) n.multiplyScalar(-1);
    return n;
  });
}

export function offsetLine(pts, nrm, d) {
  return pts.map((p, k) => new THREE.Vector2(p.x + nrm[k].x * d, p.y + nrm[k].y * d));
}

// 简易三角面建构器（非索引，computeVertexNormals 后即为平面着色）
export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.uv = [];
  }
  quad(a, b, c, d, uvs) {
    const u = uvs || [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const push = (p, t) => {
      this.pos.push(p[0], p[1], p[2]);
      this.uv.push(t[0], t[1]);
    };
    push(a, u[0]);
    push(b, u[1]);
    push(c, u[2]);
    push(a, u[0]);
    push(c, u[2]);
    push(d, u[3]);
  }
  // A、B 为等长的 Vector2 折线（x→X、y→Z），yA / yB 为高度
  strip(A, yA, B, yB, { uScale = 1, vA = 0, vB = 1 } = {}) {
    let s = 0;
    for (let k = 0; k < A.length - 1; k++) {
      const len = A[k].distanceTo(A[k + 1]);
      const u0 = s / uScale;
      const u1 = (s + len) / uScale;
      this.quad(
        [A[k].x, yA, A[k].y],
        [A[k + 1].x, yA, A[k + 1].y],
        [B[k + 1].x, yB, B[k + 1].y],
        [B[k].x, yB, B[k].y],
        [
          [u0, vA],
          [u1, vA],
          [u1, vB],
          [u0, vB],
        ],
      );
      s += len;
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

// items: [{x,y,z,ry,s,c}]，s 可为数字或 [sx,sy,sz]
export function instanced(geo, mat, items, { cast = true, receive = false } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  const d = new THREE.Object3D();
  items.forEach((it, i) => {
    d.position.set(it.x, it.y, it.z);
    d.rotation.set(it.rx || 0, it.ry || 0, 0);
    if (Array.isArray(it.s)) d.scale.set(it.s[0], it.s[1], it.s[2]);
    else d.scale.setScalar(it.s || 1);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
    if (it.c) m.setColorAt(i, it.c);
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.frustumCulled = false;
  return m;
}

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

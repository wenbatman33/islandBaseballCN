import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, smoothstep, lerp, instanced, makeRng, canvasTexture } from './util.js';

const CENTER = { x: 0, z: -50 }; // 球场中心
const LAKE = { x: 365, z: -295, r: 200 };
const TOWN = { x: -70, z: 240, rx: 130, rz: 75 };

// 地形高度：球场周围平坦，往外升成丘陵，东北侧凹成湖
export function terrainH(x, z) {
  const d = Math.hypot(x - CENTER.x, z - CENTER.z);
  const rise = smoothstep(150, 800, d);
  const n = fbm(x * 0.0032 + 11.3, z * 0.0032 + 27.9);
  const back = 0.55 + 0.45 * smoothstep(-150, 700, -z); // 中外场后方的山较高
  let h = rise * (14 + 300 * n * n) * back;
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  const lake = 1 - smoothstep(LAKE.r * 0.72, LAKE.r * 1.25, dl);
  h = lerp(h, -9, lake);
  return h;
}

// 广场铺面：同心环砖带＋放射状分缝＋外圈草带
function plazaTexture() {
  return canvasTexture(2048, 2048, (ctx, w) => {
    const c = w / 2;
    const k = c / 124; // 每公尺像素
    ctx.fillStyle = '#7fa651';
    ctx.fillRect(0, 0, w, w);
    const bands = [
      [124, '#8fae5a'],
      [117, '#c9b99c'],
      [113, '#a5503a'],
      [111, '#c4b396'],
      [104, '#b8a88c'],
    ];
    for (const [r, col] of bands) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(c, c, r * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(70,50,35,0.16)';
    ctx.lineWidth = 2;
    for (let r = 20; r < 111; r += 6.5) {
      ctx.beginPath();
      ctx.arc(c, c, r * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let a = 0; a < 360; a += 5) {
      const t = (a * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(t) * 20 * k, c + Math.sin(t) * 20 * k);
      ctx.lineTo(c + Math.cos(t) * 111 * k, c + Math.sin(t) * 111 * k);
      ctx.stroke();
    }
  });
}

export function buildEnvironment() {
  const group = new THREE.Group();
  const rng = makeRng(2026);

  // ── 地形 ──
  const SIZE = 3600;
  const SEG = 170;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color('#7fa651');
  const cMeadow = new THREE.Color('#9db55a');
  const cForest = new THREE.Color('#4c7845');
  const cRock = new THREE.Color('#8f8775');
  const cPeak = new THREE.Color('#c1b8a6');
  const cSand = new THREE.Color('#cdbb8c');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainH(x, z);
    pos.setY(i, h);
    c.copy(cGrass).lerp(cMeadow, fbm(x * 0.01, z * 0.01));
    c.lerp(cForest, smoothstep(6, 70, h));
    c.lerp(cRock, smoothstep(120, 190, h));
    c.lerp(cPeak, smoothstep(200, 260, h));
    if (h < 0.6) c.lerp(cSand, smoothstep(0.6, -1.2, h));
    const j = 0.94 + rng() * 0.12;
    colors[i * 3] = c.r * j;
    colors[i * 3 + 1] = c.g * j;
    colors[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const terrain = new THREE.Mesh(
    flat,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
  );
  terrain.receiveShadow = true;
  group.add(terrain);

  // ── 球场外广场 ──
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(124, 72),
    new THREE.MeshStandardMaterial({ map: plazaTexture(), roughness: 1 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(CENTER.x, 0.15, CENTER.z);
  plaza.receiveShadow = true;
  group.add(plaza);

  // ── 湖 ──
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(LAKE.r * 1.5, 48),
    new THREE.MeshPhongMaterial({ color: '#3f86b5', shininess: 140, specular: '#ffe2b8' }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, -1.4, LAKE.z);
  group.add(water);

  // ── 树 ──
  const pineGeo = mergeGeometries([
    new THREE.ConeGeometry(1, 1.5, 7).translate(0, 1.25, 0),
    new THREE.ConeGeometry(0.76, 1.25, 7).translate(0, 2.05, 0),
    new THREE.ConeGeometry(0.5, 1.05, 7).translate(0, 2.8, 0),
  ]);
  const blobGeo = mergeGeometries([
    new THREE.IcosahedronGeometry(1, 0).translate(0, 2.0, 0),
    new THREE.IcosahedronGeometry(0.7, 0).translate(0.6, 1.6, 0.3),
    new THREE.IcosahedronGeometry(0.62, 0).translate(-0.55, 1.7, -0.2),
  ]);
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.15, 1.2, 6).translate(0, 0.6, 0);
  const pineCols = ['#2f5d3a', '#3a6e42', '#28503a', '#447a48'].map((x) => new THREE.Color(x));
  const blobCols = ['#6f9a45', '#86a84a', '#d08a3c', '#d9a640', '#b86a34', '#5f8f48'].map(
    (x) => new THREE.Color(x),
  );
  const pines = [];
  const blobs = [];
  const trunks = [];
  const inTown = (x, z) => ((x - TOWN.x) / TOWN.rx) ** 2 + ((z - TOWN.z) / TOWN.rz) ** 2 < 1.15;
  for (let i = 0; i < 5200; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = 131 + Math.pow(rng(), 1.5) * 1300;
    const x = CENTER.x + Math.cos(ang) * dist;
    const z = CENTER.z + Math.sin(ang) * dist;
    const h = terrainH(x, z);
    if (h < 0.4 || h > 205 || inTown(x, z)) continue;
    const dens = fbm(x * 0.008 + 3, z * 0.008 + 9);
    if (dist > 240 && dens < 0.42) continue;
    const s = 2.6 + rng() * 2.6;
    const ry = rng() * Math.PI * 2;
    const isBlob = h < 30 && rng() < 0.42;
    const item = { x, y: h - 0.2, z, ry, s: [s, s * (0.9 + rng() * 0.35), s] };
    if (isBlob) blobs.push({ ...item, c: blobCols[Math.floor(rng() * blobCols.length)] });
    else pines.push({ ...item, c: pineCols[Math.floor(rng() * pineCols.length)] });
    trunks.push(item);
  }
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
  group.add(instanced(pineGeo, leafMat, pines));
  group.add(instanced(blobGeo, leafMat, blobs));
  group.add(instanced(trunkGeo, new THREE.MeshStandardMaterial({ color: '#6b4a34', roughness: 1 }), trunks));

  // ── 小镇 ──
  const wallCols = ['#efe6d2', '#f4efe4', '#e3d3b4', '#d9c3a0', '#c9d3d6'].map((x) => new THREE.Color(x));
  const roofCols = ['#b5533c', '#a5503a', '#4f5d6b', '#2f6b62', '#8a4a34'].map((x) => new THREE.Color(x));
  const bodies = [];
  const roofs = [];
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng());
    const x = TOWN.x + Math.cos(a) * r * TOWN.rx;
    const z = TOWN.z + Math.sin(a) * r * TOWN.rz;
    if (Math.hypot(x - CENTER.x, z - CENTER.z) < 200) continue;
    const w = 7 + rng() * 5;
    const d = 6 + rng() * 4;
    const hgt = 4 + rng() * 3.5;
    const y = terrainH(x, z);
    const ry = Math.round(rng() * 3) * (Math.PI / 2) + (rng() - 0.5) * 0.3;
    bodies.push({ x, y: y + hgt / 2 - 0.3, z, ry, s: [w, hgt, d], c: wallCols[Math.floor(rng() * wallCols.length)] });
    roofs.push({ x, y: y + hgt - 0.3, z, ry, s: [w * 1.12, 2.6 + rng(), d * 1.12], c: roofCols[Math.floor(rng() * roofCols.length)] });
  }
  const roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const houseMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), houseMat, bodies));
  group.add(instanced(roofGeo, houseMat, roofs));

  // ── 云 ──
  const cloudGeo = mergeGeometries([
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.IcosahedronGeometry(0.72, 1).translate(0.95, -0.12, 0.1),
    new THREE.IcosahedronGeometry(0.62, 1).translate(-0.9, -0.16, -0.1),
    new THREE.IcosahedronGeometry(0.5, 1).translate(0.3, 0.1, 0.7),
  ]);
  const clouds = [];
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const r = 500 + rng() * 1500;
    const s = 45 + rng() * 70;
    clouds.push({
      x: Math.cos(a) * r, y: 300 + rng() * 190, z: -50 + Math.sin(a) * r,
      ry: rng() * Math.PI, s: [s, s * 0.3, s * 0.6],
    });
  }
  const cloudMat = new THREE.MeshLambertMaterial({
    color: '#ffffff', emissive: '#f0cdb4', emissiveIntensity: 0.5, flatShading: true,
  });
  group.add(instanced(cloudGeo, cloudMat, clouds, { cast: false }));

  return group;
}

// ── 天空 ──
export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uTop, uMid, uHorizon, uSunColor, uSunDir;
      void main() {
        vec3 d = normalize(vDir);
        // 三段渐层：地平线暖色 → 浅蓝 → 天顶深蓝（避免橘蓝直接混成灰）
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, d.y));
        col = mix(col, uTop, smoothstep(0.12, 0.75, d.y));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(s, 900.0) * 9.0 + pow(s, 40.0) * 0.7 + pow(s, 5.0) * 0.22);
        col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.12, d.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 16), mat);
  sky.frustumCulled = false;
  return sky;
}

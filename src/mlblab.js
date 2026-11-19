// 大联盟球员分析页：独立页面，不改动游戏。
// 分两个分页：球员模型（身体比例对照与比例优化预览）、打击人员（击球阶段逐格分析、数据、预备姿势类型）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import { GAME } from './data.js';
import { loadPlayerModel, makeActor } from './player3d.js';
import { BATPOSE, BATPOSE_DEFAULT } from './batpose.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ── 场景 ──
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9aa3ad');
scene.add(new THREE.HemisphereLight('#ffffff', '#7d6c5a', 1.5));
const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
sun.position.set(3, 6, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2 });
scene.add(sun);
const rim = new THREE.DirectionalLight('#dfe8ff', 1.3);
rim.position.set(-4, 4, -5);
scene.add(rim);
const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ color: '#a2865f', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// 文本标签（尺规刻度用）
function label(text, color = '#ffffff', size = 0.07) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 40px "Barlow Condensed", sans-serif';
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 6, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(size * 4, size, 1);
  s.center.set(0, 0.5);
  return s;
}

// ════════ 量测：直接取蒙皮后的顶点与骨头位置 ════════
const P = 'mixamorig';
function bonesOf(inner) {
  const B = {};
  inner.traverse((o) => {
    if (o.isBone && o.name.startsWith(P)) B[o.name.slice(P.length)] = o;
  });
  return B;
}
const wpos = (o) => o.getWorldPosition(new THREE.Vector3());

// 每个顶点权重最大的骨头（只算一次）
function dominantBone(mesh) {
  if (mesh.userData.dom) return mesh.userData.dom;
  const si = mesh.geometry.attributes.skinIndex;
  const sw = mesh.geometry.attributes.skinWeight;
  const dom = new Int16Array(si.count);
  for (let i = 0; i < si.count; i++) {
    let best = 0;
    let bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) {
        bw = w;
        best = si.getComponent(i, k);
      }
    }
    dom[i] = best;
  }
  mesh.userData.dom = dom;
  return dom;
}

function measureBody(actor) {
  const inner = actor.group.userData.inner;
  inner.updateMatrixWorld(true);
  const B = bonesOf(inner);
  let top = -1e9;
  let bottom = 1e9;
  let chin = 1e9;
  let hx0 = 1e9;
  let hx1 = -1e9;
  const v = new THREE.Vector3();
  inner.traverse((o) => {
    if (!o.isSkinnedMesh || o.name === 'bat_mesh' || !o.visible) return;
    const pos = o.geometry.attributes.position;
    const headIdx = o.skeleton.bones.indexOf(B.Head);
    const dom = o.name === 'cap' ? null : dominantBone(o);
    for (let i = 0; i < pos.count; i += 2) {
      o.getVertexPosition(i, v);
      o.localToWorld(v);
      top = Math.max(top, v.y);
      bottom = Math.min(bottom, v.y);
      if (dom && dom[i] === headIdx) {
        chin = Math.min(chin, v.y);
        hx0 = Math.min(hx0, v.x);
        hx1 = Math.max(hx1, v.x);
      }
    }
  });
  const H = top - bottom;
  // 下巴：头骨往下约 4 公分（头骨缩放时跟着缩）。直接用「属于头骨的顶点最低点」会把颈部上段也算进去，头量太高
  const hs = B.Head.getWorldScale(new THREE.Vector3()).y;
  chin = Math.max(chin, wpos(B.Head).y - 0.04 * hs);
  const head = top - chin;
  const seg = (a, b) => wpos(B[a]).distanceTo(wpos(B[b]));
  const arm = seg('RightArm', 'RightForeArm') + seg('RightForeArm', 'RightHand');
  const leg = wpos(B.RightUpLeg).y - bottom;
  const shoulders = wpos(B.LeftArm).distanceTo(wpos(B.RightArm)) + 0.1; // 两肩关节距离＋两侧三角肌
  return { H, head, heads: H / head, headW: hx1 - hx0, shoulders, headRatio: (hx1 - hx0) / shoulders, arm: arm / H, leg: leg / H };
}

// ════════ 球员模型分页：比例优化预览（用骨头缩放近似） ════════
const PROP_DEFAULT = { head: 1, arms: 1, legs: 1, shoulders: 1, bulk: 1 };
const PROP_MLB = { head: 0.86, arms: 1.22, legs: 1.14, shoulders: 1.12, bulk: 1.08 };
const prop = { ...PROP_DEFAULT }; // 球员模型分页
const batProp = { ...PROP_DEFAULT }; // 打击人员分页

function applyProportions(actor, p) {
  const B = bonesOf(actor.group.userData.inner);
  if (!B.Head) return;
  const build = actor.group.userData.build;
  B.Head.scale.set(p.head / build.w, p.head / build.h, p.head / build.w);
  for (const s of ['Left', 'Right']) {
    // 上臂沿骨头方向拉长，前臂跟着一起变长（手臂下垂时两段方向接近），手掌缩回原长
    B[s + 'Arm'].scale.set(p.bulk, p.arms, p.bulk);
    B[s + 'Hand'].scale.set(1 / p.bulk, 1 / p.arms, 1 / p.bulk);
    B[s + 'UpLeg'].scale.set(1, p.legs, 1);
    B[s + 'Foot'].scale.set(1, 1 / p.legs, 1);
    // 肩宽：把手臂往外移（不用缩放，避免手臂跟着变形）
    const arm = B[s + 'Arm'];
    if (!arm.userData.p0) arm.userData.p0 = arm.position.clone();
    arm.position.copy(arm.userData.p0).multiplyScalar(p.shoulders);
  }
  B.Spine2.scale.set(p.bulk, 1, p.bulk);
  B.Neck.scale.set(1 / p.bulk, 1, 1 / p.bulk);
  // 腿变长时把整个人往上擡，脚才不会陷进地面（大腿＋小腿约 0.76 公尺）
  actor.group.position.y = (p.legs - 1) * 0.76 * build.h;
  actor.group.updateMatrixWorld(true);
}

// ════════ 打击人员分页：挥棒逐格分析 ════════
const SWING_DUR = 0.34; // 游戏里一次挥棒的秒数
const SWING_MAP = [[0, 0.45], [0.42, 0.67], [1, 1.13]]; // 游戏进度 → 动作档时间（真人动作捕捉的实际秒数）
const CONTACT_U = 0.42;
const CLIP_END = 1.13; // 挥棒动作档全长（秒，真人原速）
const GAME_T0 = 0.45; // 游戏里的挥棒从动作档这个时间点才开始（之前的载重、跨步被跳过）
const CONTACT_F = 0.67 / CLIP_END; // 时间轴上击球瞬间的位置
const GAME_F = GAME_T0 / CLIP_END;
// 动作档时间 → 游戏进度（游戏开始之前＝0）
const gameU = (t) => {
  if (t <= SWING_MAP[0][1]) return 0;
  for (let i = 1; i < SWING_MAP.length; i++) {
    const [u0, t0] = SWING_MAP[i - 1];
    const [u1, t1] = SWING_MAP[i];
    if (t <= t1) return u0 + ((t - t0) / (t1 - t0)) * (u1 - u0);
  }
  return 1;
};

function batTip(actor) {
  const inner = actor.group.userData.inner;
  let mesh = null;
  inner.traverse((o) => {
    if (o.name === 'bat_mesh') mesh = o;
  });
  const B = bonesOf(inner);
  const bat = inner.getObjectByName('bat');
  const knob = wpos(bat);
  const v = new THREE.Vector3();
  let best = null;
  let bd = -1;
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    mesh.getVertexPosition(i, v);
    mesh.localToWorld(v);
    const d = v.distanceTo(knob);
    if (d > bd) {
      bd = d;
      best = v.clone();
    }
  }
  return { tip: best, knob, B };
}

// f：时间轴位置 0～1，对应整段真人挥棒动作（含游戏跳过的载重、跨步）
function swingPose(actor, f) {
  const t = clamp(f, 0, 1) * CLIP_END;
  if (actor.pose !== 'swing') actor.play('swing', 1e6, 'stance');
  actor.dur = 1e6;
  actor.u = clamp(gameU(t), 0, 0.999);
  actor.aimY = 0.78;
  actor.update(0);
  // 直接把动作档时间设到 t（游戏开始之前的部分也看得到），再套一次姿势微调
  actor.group.userData.actions.swing.time = Math.min(t, CLIP_END - 1e-3);
  actor.group.userData.mixer.update(0);
  actor._tweak();
  actor.group.updateMatrixWorld(true);
}

function frameMetrics(actor) {
  const { tip, knob, B } = batTip(actor);
  const lh = wpos(B.LeftHand);
  const rh = wpos(B.RightHand);
  const hands = lh.clone().add(rh).multiplyScalar(0.5);
  const d = tip.clone().sub(knob);
  const flat = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);
  let sep = (flat(wpos(B.LeftUpLeg), wpos(B.RightUpLeg)) - flat(wpos(B.LeftArm), wpos(B.RightArm))) * (180 / Math.PI);
  sep = ((sep + 540) % 360) - 180;
  const inner = actor.group.userData.inner;
  const plate = new THREE.Vector3(-1, 0, 0).transformDirection(inner.matrixWorld);
  const root = actor.group.position;
  return {
    tip,
    reach: (tip.clone().sub(root).dot(plate)) * 100,
    handsY: hands.y,
    batAngle: Math.asin(clamp(d.y / d.length(), -1, 1)) * (180 / Math.PI),
    foot: wpos(B.LeftFoot),
    head: wpos(B.Head),
    sep: Math.abs(sep),
  };
}

// 先把整段挥棒采样，算出速度曲线与各阶段的时间点
function analyzeSwing(actor) {
  const N = 120;
  const S = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    swingPose(actor, u);
    S.push({ u, ...frameMetrics(actor) });
  }
  const f0 = S[0].foot;
  const h0 = S[0].head;
  for (let i = 0; i <= N; i++) {
    const s = S[i];
    s.stride = Math.hypot(s.foot.x - f0.x, s.foot.z - f0.z) * 100;
    s.footUp = (s.foot.y - f0.y) * 100;
    s.headMove = Math.hypot(s.head.x - h0.x, s.head.z - h0.z) * 100;
    s.handsCm = s.handsY * 100;
    const a = S[Math.max(0, i - 1)];
    const b = S[Math.min(N, i + 1)];
    const dist = a.tip.distanceTo(b.tip);
    const du = gameU(b.u * CLIP_END) - gameU(a.u * CLIP_END);
    s.speedGame = du > 1e-6 ? (dist / (du * SWING_DUR)) * 3.6 : 0;
    s.speedReal = (dist / (((b.u - a.u) * CLIP_END) || 1e-6)) * 3.6;
  }
  const vmax = Math.max(...S.map((s) => s.speedReal));
  const peak = S.reduce((m, s) => (s.u < CONTACT_F && s.footUp > m.footUp ? s : m), S[0]);
  const land = S.find((s) => s.u > peak.u && s.footUp < 1.5) || peak;
  const launch = S.find((s) => s.u > land.u && s.speedReal > vmax * 0.3) || land;
  const slow = S.find((s) => s.u > CONTACT_F + 0.05 && s.speedReal < vmax * 0.3) || S[N];
  const phases = [
    { name: '载重', a: 0, b: Math.max(0.04, peak.u), c: '#7fb2ff' },
    { name: '跨步', a: Math.max(0.04, peak.u), b: Math.max(peak.u + 0.04, land.u), c: '#a0e4ff' },
    { name: '启动', a: Math.max(peak.u + 0.04, land.u), b: CONTACT_F - 0.01, c: '#ffd36b' },
    { name: '击球', a: CONTACT_F - 0.01, b: CONTACT_F + 0.02, c: '#ff7a4d' },
    { name: '延伸', a: CONTACT_F + 0.02, b: Math.max(CONTACT_F + 0.06, slow.u), c: '#c9ff7a' },
    { name: '收棒', a: Math.max(CONTACT_F + 0.06, slow.u), b: 1, c: '#b8c4cf' },
  ];
  const at = (u) => S[Math.round(clamp(u, 0, 1) * N)];
  const reachMax = Math.max(...S.filter((s) => Math.abs(s.u - CONTACT_F) < 0.08).map((s) => s.reach));
  return { S, phases, at, land, peak, contact: at(CONTACT_F), vmax, reachMax };
}

// ════════ 接口 ════════
const panel = $('#panel');
let tab = 'body';
let bodyActor;
let batActor;
let swing = null;
let playing = false;
let speed = 0.25;
let scrubU = 0;
let inStance = true;
const rulerGroup = new THREE.Group();
scene.add(rulerGroup);
const plateGroup = new THREE.Group();
scene.add(plateGroup);

const SOURCES = `
  <p class="src">公开数据源：
  <a href="https://www.mlbplayers.com/post/behind-the-scenes-sony-mlb-the-show-19-player-scans" target="_blank">MLBPA：MLB The Show 19 球员扫描幕后</a>、
  <a href="https://www.foxsports.com/stories/other/braves-players-get-face-to-face-with-video-game-design" target="_blank">Fox Sports：勇士队球员脸部 3D 扫描</a>、
  <a href="https://gameinformer.com/b/features/archive/2017/02/13/the-sports-desk-48-mlb-the-show-17-details-gameplay-graphics-diamond-dynasty-and-more" target="_blank">Game Informer：MLB The Show 17 体型与捏人</a>、
  <a href="https://blog.playstation.com/?p=377481" target="_blank">PlayStation Blog：MLB The Show 23 添加 5,000+ 动作</a>、
  <a href="https://www.pushsquare.com/guides/mlb-the-show-25-how-to-use-face-scan-when-creating-your-ballplayer" target="_blank">Push Square：MLB The Show 25 脸部扫描</a>。
  只整理公开说明与业界常见做法，不使用、不拷贝任何游戏的模型或美术。</p>`;

function metricRow(name, us, mlb, lo, hi, fmt, note) {
  const pct = (x) => `${(clamp((x - lo) / (hi - lo), 0, 1) * 100).toFixed(1)}%`;
  return `<div class="metric"><span class="name">${name}</span><span class="val">${fmt(us)} <small style="color:var(--dim)">／目标 ${fmt(mlb)}</small></span>
    <div class="bar"><i class="mlb" style="left:${pct(mlb)}"></i><i class="us" style="left:${pct(us)}"></i></div>${note ? `<span class="ref">${note}</span>` : ''}</div>`;
}

const bodyTag = (ok) => (ok === 2 ? '<span class="tag ok">已接近</span>' : ok === 1 ? '<span class="tag mid">有差距</span>' : '<span class="tag no">差很多</span>');
const grade = (v, t, tol) => (Math.abs(v - t) <= tol ? 2 : Math.abs(v - t) <= tol * 2.5 ? 1 : 0);
function bodyMetricsHTML(m) {
  const tag = bodyTag;
  return `
    ${metricRow('头身比', m.heads, 7.5, 5, 8.5, (x) => `${x.toFixed(1)} 头身`, `${tag(grade(m.heads, 7.5, 0.3))} 写实成年男性约 7.5 头身，大联盟游戏用写实比例`)}
    ${metricRow('头宽 ÷ 肩宽', m.headRatio, 0.33, 0.2, 0.8, (x) => x.toFixed(2), `${tag(grade(m.headRatio, 0.33, 0.04))} 越大代表头越大、肩越窄`)}
    ${metricRow('手臂长（肩到手腕）÷ 身高', m.arm, 0.32, 0.2, 0.38, (x) => `${(x * 100).toFixed(0)}%`, `${tag(grade(m.arm, 0.32, 0.015))} 手臂太短，击球时球棒就搆不到本垒板外侧`)}
    ${metricRow('腿长（髋关节到地）÷ 身高', m.leg, 0.5, 0.38, 0.56, (x) => `${(x * 100).toFixed(0)}%`, `${tag(grade(m.leg, 0.5, 0.015))} 腿短看起来矮胖、跑垒步幅小`)}
    <p style="font-size:12px;color:var(--dim);margin:6px 0 0">身高 ${m.H.toFixed(2)} 公尺（含帽）、头高 ${(m.head * 100).toFixed(0)} 公分、头宽 ${(m.headW * 100).toFixed(0)} 公分、肩宽约 ${(m.shoulders * 100).toFixed(0)} 公分</p>`;
}

function compareBlock(src, title) {
  return `<h2>${title}</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <figure style="margin:0"><img class="concept" src="${src}" style="aspect-ratio:2/3;object-fit:cover" /><figcaption style="font-size:12px;color:var(--good);text-align:center;margin-top:4px">大联盟写实目标（AI 概念图，原创）</figcaption></figure>
    <figure style="margin:0"><img class="concept" id="snap" style="aspect-ratio:2/3;object-fit:cover;background:#9aa3ad" /><figcaption style="font-size:12px;color:var(--warn);text-align:center;margin-top:4px">我们目前（同角度即时截屏）</figcaption></figure>
  </div>`;
}

// 用主画面的渲染器拍一张固定角度的截屏（直式 2:3）
function snapshot(kind) {
  const img = $('#snap');
  if (!img) return;
  const cam = new THREE.PerspectiveCamera(kind === 'bat' ? 30 : 26, 2 / 3, 0.05, 100);
  if (kind === 'bat') {
    const inner = batActor.group.userData.inner;
    inner.updateMatrixWorld(true);
    const dir = (x, y, z) => new THREE.Vector3(x, y, z).transformDirection(inner.matrixWorld);
    const plate = dir(-1, 0, 0);
    const catcher = dir(0, 0, -1);
    const at = (p, q, u) => plate.clone().multiplyScalar(p).add(catcher.clone().multiplyScalar(q)).add(new THREE.Vector3(0, u, 0));
    cam.position.copy(at(-2.4, 2.6, 1.55));
    cam.lookAt(at(0.25, -0.1, 0.95));
  } else {
    cam.position.set(0.15, 1.0, 5.6);
    cam.lookAt(0, 0.98, 0);
  }
  const size = renderer.getSize(new THREE.Vector2());
  const rulerVis = rulerGroup.visible;
  rulerGroup.visible = false;
  renderer.setSize(400, 600, false);
  renderer.render(scene, cam);
  img.src = canvas.toDataURL('image/jpeg', 0.85);
  renderer.setSize(size.x, size.y, false);
  rulerGroup.visible = rulerVis;
  resize();
}

function renderBodyPanel(m) {
  const tag = bodyTag;
  panel.innerHTML = `
  ${compareBlock('/lab/concept_fielder.webp', '对照：大联盟写实目标 vs 我们目前')}
  <h2>球员模型：我们的版本 vs 大联盟写实比例</h2>
  <div class="legend"><span><b style="background:var(--warn)"></b>我们目前（即时量测）</span><span><b style="background:var(--good)"></b>写实职业球员目标</span></div>
  <div class="card" id="bodyMetrics">${bodyMetricsHTML(m)}</div>

  <h2>比例优化预览（拖滑杆即时看）</h2>
  <div class="row">
    <button class="chip ${isProp(PROP_DEFAULT) ? 'on' : ''}" data-preset="orig">目前游戏比例</button>
    <button class="chip ${isProp(PROP_MLB) ? 'on' : ''}" data-preset="mlb">大联盟比例建议</button>
  </div>
  ${slider('head', '头部大小', 0.6, 1.1, 0.01)}
  ${slider('arms', '手臂长度', 0.9, 1.35, 0.01)}
  ${slider('legs', '腿长', 0.9, 1.3, 0.01)}
  ${slider('shoulders', '肩宽', 0.9, 1.25, 0.01)}
  ${slider('bulk', '体格（胸背、手臂粗细）', 0.9, 1.2, 0.01)}
  <p style="font-size:12px;color:var(--dim)">这是用骨头缩放「近似」改比例，站姿、预备姿势看得最准；手肘大幅弯曲时前臂会有些变形。真正的写实模型要重做模型本体（见下方「优化路线」）。</p>

  <p style="font-size:12px;color:var(--dim)">概念图为原创设计（队名 ISLAND 为虚构），不仿任何真实球队、球员或游戏。</p>

  <h2>大联盟游戏球员模型的做法（公开数据整理）</h2>
  <ul>
    <li><b>脸：</b>真实球员做 3D 脸部扫描；近年开放照片扫脸，再调发型、胡子、肤色。</li>
    <li><b>体型：</b>多种体型（含壮硕型），捏人可调臀部、肩宽、脊椎长度等。</li>
    <li><b>动作：</b>大量动作捕捉，MLB The Show 23 一次添加 5,000 个以上比赛动作；击球员有各自的预备姿势与挥棒。</li>
  </ul>
  <h2>对照：写实 3D 运动游戏角色的常见做法 vs 我们</h2>
  <div class="card">
    <p>${tag(m.heads > 7 ? 2 : 0)}<b>写实 7～7.5 头身比例</b>：我们是卡通大头比例（约 ${m.heads.toFixed(1)} 头身）。</p>
    <p>${tag(0)}<b>手臂扭转骨（twist bone）</b>：前臂转动时分段扭转，不会像糖果纸扭成一团；我们的骨架没有。</p>
    <p>${tag(0)}<b>五指分开的手</b>：握棒、接球需要；我们的手指是黏在一起雕的，靠击球手套遮住。</p>
    <p>${tag(1)}<b>布料：</b>宽松球衣、裤子皱褶用法线贴图与材质表现；我们只保留颜色贴图（减面后原法线贴图对不上）。</p>
    <p>${tag(2)}<b>装备分件：</b>头盔、击球手套、护腕、防守手套、接手护具都是独立配件（已做）。</p>
    <p>${tag(1)}<b>多种体型与脸：</b>我们全队共用一个脸与发型，只有身高胖瘦与头型缩放。</p>
    <p>${tag(2)}<b>真人动作捕捉击球：</b>已改用真人挥棒动作（CMU 开放数据），并可微调预备姿势。</p>
  </div>
  <h2>优化路线（建议顺序）</h2>
  <ol style="font-size:13px;line-height:1.7;padding-left:18px">
    <li>用上面的写实概念图重新生成 3D 模型（Meshy 图片转 3D，会用到点数，做之前先问你）。</li>
    <li>重新绑骨架时加入前臂扭转骨、五指骨架，并重算权重。</li>
    <li>保留布料法线贴图（改用重新拓朴后再烘焙，减面后才对得上）。</li>
    <li>多做 3～4 种体型与脸，让每位球员看得出差别。</li>
  </ol>
  ${SOURCES}`;
  bindPanel();
  requestAnimationFrame(() => snapshot('body'));
}

function isProp(p) {
  return Object.keys(p).every((k) => Math.abs(prop[k] - p[k]) < 1e-3);
}
function slider(key, name, min, max, step) {
  return `<div class="slider"><span>${name}</span><input type="range" data-prop="${key}" min="${min}" max="${max}" step="${step}" value="${prop[key]}" /><output>${prop[key].toFixed(2)}×</output></div>`;
}

let measureTimer = 0;
function refreshBody(delay = 0, full = false) {
  clearTimeout(measureTimer);
  measureTimer = setTimeout(() => {
    bodyActor.update(0);
    const m = measureBody(bodyActor);
    drawRuler(m);
    const box = $('#bodyMetrics');
    if (!box || full) return renderBodyPanel(m);
    // 拖滑杆时只更新数据卡，不重画整个面板（正在拖的滑杆才不会被换掉）
    box.innerHTML = bodyMetricsHTML(m);
    snapshot('body');
    panel.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('on', isProp(b.dataset.preset === 'mlb' ? PROP_MLB : PROP_DEFAULT)));
  }, delay);
}

function drawRuler(m) {
  rulerGroup.clear();
  if (tab !== 'body') return;
  const x = -0.75;
  const mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
  const top = m.H;
  const n = Math.ceil(m.heads);
  for (let i = 0; i <= n; i++) {
    const y = top - i * m.head;
    if (y < -0.01) break;
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x - 0.08, y, 0), new THREE.Vector3(x + 0.08, y, 0)]);
    rulerGroup.add(new THREE.Line(g, mat));
    if (i > 0) {
      const l = label(String(i), '#ffffff', 0.06);
      l.position.set(x + 0.1, y + m.head / 2, 0);
      rulerGroup.add(l);
    }
  }
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, top, 0)]);
  rulerGroup.add(new THREE.Line(g, mat));
  const t = label(`${m.heads.toFixed(1)} 头身`, '#d8ff3e', 0.08);
  t.position.set(x - 0.05, top + 0.12, 0);
  rulerGroup.add(t);
}

// ── 击球面板 ──
const BAT_ORIG = { ...BATPOSE_DEFAULT }; // 一律用写进程式的游戏默认值（你锁定的那组），不读浏览器里暂存的版本
const STANCES = {
  game: { name: '游戏目前（你调的）', v: {} },
  high: { name: '高手位', v: { gripUp: -12, tiltBack: -15 } },
  low: { name: '低手位、球棒平放', v: { gripUp: -40, tiltBack: -55 } },
  crouch: { name: '蹲低重心', v: { crouch: 14, spread: 10, lean: 8 } },
  upright: { name: '直立窄站', v: { crouch: 0, spread: -14, lean: 0 } },
};
let stanceKey = 'game';
function applyStance(key) {
  stanceKey = key;
  Object.assign(BATPOSE, BAT_ORIG, STANCES[key].v, { freeze: false }); // 只改这一页的内存，不存回游戏
  swing = analyzeSwing(batActor);
  if (inStance) batActor.set('stance');
  renderBatPanel();
  drawPhases();
}

function sparkline(key, color, unit) {
  const S = swing.S;
  const vals = S.map((s) => s[key]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pts = S.map((s, i) => `${(i / (S.length - 1)) * 300},${48 - ((s[key] - lo) / (hi - lo || 1)) * 44}`).join(' ');
  return `<svg viewBox="0 0 300 52" style="width:100%;height:52px;display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>
    <line class="cursor" x1="0" x2="0" y1="0" y2="52" stroke="#fff" stroke-width="1" opacity="0.7"/>
    <line x1="${CONTACT_F * 300}" x2="${CONTACT_F * 300}" y1="0" y2="52" stroke="#ff7a4d" stroke-dasharray="3 3"/>
    <line x1="${GAME_F * 300}" x2="${GAME_F * 300}" y1="0" y2="52" stroke="#d8ff3e" stroke-dasharray="2 4"/></svg>
    <div style="font-size:11px;color:var(--dim)">范围 ${lo.toFixed(0)}～${hi.toFixed(0)} ${unit}（橘线＝击球瞬间，黄线＝游戏从这里才开始挥）</div>`;
}

function renderBatPanel() {
  const c = swing.contact;
  const l = swing.land;
  const chips = Object.entries(STANCES).map(([k, s]) => `<button class="chip ${k === stanceKey ? 'on' : ''}" data-stance="${k}">${s.name}</button>`).join('');
  const tag = (g) => (g === 2 ? '<span class="tag ok">符合</span>' : g === 1 ? '<span class="tag mid">接近</span>' : '<span class="tag no">差距大</span>');
  const vReal = c.speedReal;
  const propChips = `<div class="row">
    <button class="chip ${isBatProp(PROP_DEFAULT) ? 'on' : ''}" data-batprop="orig">游戏目前比例</button>
    <button class="chip ${isBatProp(PROP_MLB) ? 'on' : ''}" data-batprop="mlb">大联盟比例</button></div>`;
  const plateFar = 85 + 21.6;
  panel.innerHTML = `
  ${compareBlock('/lab/concept_batter.webp', '对照：大联盟写实击球员 vs 我们目前（预备姿势）')}
  <h2>击球员模型的比例优化</h2>
  ${propChips}
  <div class="card">
    <p>${swing.reachMax >= plateFar ? '<span class="tag ok">涵盖</span>' : '<span class="tag no">搆不到</span>'}<b>击球前后棒头最远伸到：</b>${swing.reachMax.toFixed(0)} 公分（本垒板外侧边缘在 ${plateFar.toFixed(0)} 公分）</p>
    <p style="font-size:12px;color:var(--dim);margin:0">切换「大联盟比例」会把头缩小、手臂和腿拉长，挥棒数据会重新计算，可以直接看比例对击球的影响。手肘大幅弯曲时前臂会有些变形（骨头缩放近似），真正写实要重做模型。</p>
  </div>
  <h2>打击人员：挥棒逐格分析</h2>
  <p style="font-size:12px;color:var(--dim)">下方时间轴是整段真人挥棒动作（含游戏跳过的载重、跨步），可拖曳逐格看，或按播放（可选慢速）。数据即时计算自目前的模型与动作。</p>
  <div class="card" id="liveCard"></div>

  <h2>关键发现</h2>
  <div class="card">
    <p><span class="tag no">差距大</span><b>游戏跳过了载重与跨步：</b>游戏的挥棒从真人动作的 ${GAME_T0.toFixed(2)} 秒才开始（时间轴上的黄色虚线），预备姿势直接切到「启动」。大联盟击球员的节奏是预备 → 擡脚载重 → 跨步落地 → 启动，这两段在我们游戏里看不到。</p>
    <p><span class="tag no">差距大</span><b>真人数据是慢速示范挥棒：</b>原速棒头速度只有 ${c.speedReal.toFixed(0)} km/h，大联盟平均约 113～121 km/h；游戏用约 2 倍速播放才显得够快，但手脚的节奏也因此不自然。</p>
  </div>

  <h2>击球瞬间 vs 大联盟通用参考</h2>
  <div class="card">
    <p>${tag(vReal >= 105 ? 2 : vReal >= 85 ? 1 : 0)}<b>棒头速度：</b>${vReal.toFixed(0)} km/h（真人动作原速）<br><span class="src">大联盟平均约 113～121 km/h（70～75 mph，Statcast 挥棒速度）。游戏中实际播放出来的速度：${c.speedGame.toFixed(0)} km/h。</span></p>
    <p>${tag(l.sep >= 25 && l.sep <= 60 ? 2 : l.sep >= 15 ? 1 : 0)}<b>跨步落地时髋肩分离：</b>${l.sep.toFixed(0)}°<br><span class="src">击球力学常见范围约 30～50°：下半身先转、肩膀留在后面，力量才传得上来。</span></p>
    <p>${tag(c.headMove <= 10 ? 2 : c.headMove <= 18 ? 1 : 0)}<b>击球时头部位移：</b>${c.headMove.toFixed(0)} 公分<br><span class="src">头越稳越好，一般希望在 10 公分以内。</span></p>
    <p>${tag(c.batAngle <= 5 && c.batAngle >= -35 ? 2 : 1)}<b>击球时球棒角度：</b>${c.batAngle.toFixed(0)}°（负值＝棒头低于握把）<br><span class="src">中间高度的球，球棒接近水平或棒头稍低。</span></p>
    <p>${tag(l.stride >= 15 && l.stride <= 60 ? 2 : 1)}<b>跨步距离：</b>${l.stride.toFixed(0)} 公分（前脚最高擡起 ${swing.peak.footUp.toFixed(0)} 公分）</p>
  </div>

  <h2>预备姿势类型（大联盟常见的几种）</h2>
  <div class="row">${chips}</div>
  <p style="font-size:12px;color:var(--dim)">切换只影响这一页，不会改到游戏。选好喜欢的类型，再跟我说要不要套进游戏。</p>

  <h2>曲线</h2>
  <div class="card"><b style="font-size:13px">棒头速度（km/h，真人原速）</b>${sparkline('speedReal', '#ff7a4d', 'km/h')}</div>
  <div class="card"><b style="font-size:13px">双手高度（公分）</b>${sparkline('handsCm', '#7fb2ff', '公分')}</div>
  <div class="card"><b style="font-size:13px">前脚擡起高度（公分）</b>${sparkline('footUp', '#a0e4ff', '公分')}</div>


  <h2>击球动作的优化方向</h2>
  <ul>
    <li><b>比例先修：</b>手臂短是棒子搆不到的主因，换成写实比例后，挥棒轨迹自然能涵盖整个本垒板。</li>
    <li><b>多段动作库：</b>大联盟游戏每位击球员有自己的预备与挥棒；我们目前全队共用一套，可先做 4～5 种预备类型。</li>
    <li><b>依球路调整：</b>已做挥棒高度跟着瞄准点；下一步是内外角改变击球点前后（内角早击、外角晚击）。</li>
    <li><b>手指握棒：</b>需要五指分开的手模型才能真正握住，现在靠击球手套遮住。</li>
  </ul>
  ${SOURCES}`;
  bindPanel();
  updateLive();
  requestAnimationFrame(() => {
    if (inStance) snapshot('bat');
  });
}
function isBatProp(p) {
  return Object.keys(p).every((k) => Math.abs(batProp[k] - p[k]) < 1e-3);
}

function updateLive() {
  const card = $('#liveCard');
  if (!card || !swing) return;
  const s = swing.at(scrubU);
  const ph = swing.phases.find((p) => scrubU >= p.a && scrubU <= p.b);
  card.innerHTML = inStance
    ? '<p style="margin:0">目前显示：<b>预备姿势</b>（按播放或拖时间轴看挥棒）</p>'
    : `<div class="metric"><span class="name">阶段</span><span class="val">${ph ? ph.name : ''}</span></div>
      <div class="metric"><span class="name">棒头速度（真人原速）</span><span class="val">${s.speedReal.toFixed(0)} km/h</span></div>
      <div class="metric"><span class="name">双手高度</span><span class="val">${(s.handsY * 100).toFixed(0)} 公分</span></div>
      <div class="metric"><span class="name">球棒角度</span><span class="val">${s.batAngle.toFixed(0)}°</span></div>
      <div class="metric"><span class="name">跨步距离</span><span class="val">${s.stride.toFixed(0)} 公分</span></div>
      <div class="metric"><span class="name">髋肩分离</span><span class="val">${s.sep.toFixed(0)}°</span></div>
      <div class="metric"><span class="name">头部位移</span><span class="val">${s.headMove.toFixed(0)} 公分</span></div>`;
  document.querySelectorAll('svg .cursor').forEach((l) => {
    l.setAttribute('x1', scrubU * 300);
    l.setAttribute('x2', scrubU * 300);
  });
  $('#tlLabel').textContent = inStance ? '预备' : `${ph ? ph.name : ''} ${(scrubU * 100).toFixed(0)}%`;
}

function drawPhases() {
  $('#phases').innerHTML = swing.phases
    .map((p) => `<div class="phase" style="left:${p.a * 100}%;width:${(p.b - p.a) * 100}%;background:${p.c}">${p.name}</div>`)
    .join('') + `<div style="position:absolute;left:${GAME_F * 100}%;top:-26px;height:46px;border-left:2px dashed #d8ff3e"></div>
      <div style="position:absolute;left:calc(${GAME_F * 100}% + 4px);top:-26px;font-size:11px;color:#d8ff3e;white-space:nowrap">游戏从这里才开始挥</div>`;
}

function bindPanel() {
  panel.querySelectorAll('[data-prop]').forEach((el) => {
    el.addEventListener('input', () => {
      prop[el.dataset.prop] = +el.value;
      el.nextElementSibling.textContent = `${(+el.value).toFixed(2)}×`;
      refreshBody(60);
    });
  });
  panel.querySelectorAll('[data-preset]').forEach((el) => {
    el.addEventListener('click', () => {
      Object.assign(prop, el.dataset.preset === 'mlb' ? PROP_MLB : PROP_DEFAULT);
      refreshBody(0, true);
    });
  });
  panel.querySelectorAll('[data-stance]').forEach((el) => el.addEventListener('click', () => applyStance(el.dataset.stance)));
  panel.querySelectorAll('[data-batprop]').forEach((el) =>
    el.addEventListener('click', () => {
      Object.assign(batProp, el.dataset.batprop === 'mlb' ? PROP_MLB : PROP_DEFAULT);
      applyStance(stanceKey); // 重新采样整段挥棒
    }),
  );
}

// ── 镜头 ──
const CAMS = {
  body: {
    正面: [[0.4, 1.1, 4.6], [0, 0.95, 0]],
    侧面: [[4.6, 1.1, 0.4], [0, 0.95, 0]],
    斜前: [[3.0, 1.4, 3.4], [0, 0.95, 0]],
    背面: [[-0.3, 1.2, -4.6], [0, 0.95, 0]],
  },
  bat: {
    '斜后方（视频角度）': 'video',
    投手方向: 'pitcher',
    接手方向: 'catcher',
    正面: 'front',
    上视图: 'top',
  },
};
function setCam(name) {
  const c = CAMS[tab][name];
  if (Array.isArray(c)) {
    camera.position.fromArray(c[0]);
    controls.target.fromArray(c[1]);
  } else {
    const inner = batActor.group.userData.inner;
    inner.updateMatrixWorld(true);
    const dir = (x, y, z) => new THREE.Vector3(x, y, z).transformDirection(inner.matrixWorld);
    const plate = dir(-1, 0, 0);
    const catcher = dir(0, 0, -1);
    const at = (p, q, u) => plate.clone().multiplyScalar(p).add(catcher.clone().multiplyScalar(q)).add(new THREE.Vector3(0, u, 0));
    const presets = {
      video: [at(-3.0, 2.8, 1.8), at(0.25, -0.35, 1.0)],
      pitcher: [at(0.3, -4.2, 1.4), at(0.2, 0, 1.05)],
      catcher: [at(0.3, 4.2, 1.5), at(0.2, 0, 1.05)],
      front: [at(4.2, 0, 1.4), at(0, 0, 1.05)],
      top: [at(0.4, 0.01, 5.2), at(0.4, 0, 0)],
    };
    camera.position.copy(presets[c][0]);
    controls.target.copy(presets[c][1]);
  }
  controls.update();
  document.querySelectorAll('#cams .chip').forEach((b) => b.classList.toggle('on', b.textContent === name));
}
function buildCams() {
  $('#cams').innerHTML = Object.keys(CAMS[tab]).map((n) => `<button class="chip">${n}</button>`).join('')
    + (tab === 'body' ? ['idle', 'ready', 'run'].map((p) => `<button class="chip pose" data-pose="${p}">${{ idle: '站姿', ready: '防守预备', run: '跑步' }[p]}</button>`).join('') : '<button class="chip pose" id="toStance">回到预备姿势</button>');
  $('#cams').querySelectorAll('.chip:not(.pose)').forEach((b) => b.addEventListener('click', () => setCam(b.textContent)));
  $('#cams').querySelectorAll('[data-pose]').forEach((b) =>
    b.addEventListener('click', () => {
      bodyActor.set(b.dataset.pose);
      refreshBody(400);
    }),
  );
  const ts = $('#toStance');
  if (ts) ts.addEventListener('click', toStance);
}
function toStance() {
  inStance = true;
  playing = false;
  $('#play').textContent = '▶ 播放';
  batActor.set('stance');
  updateLive();
}

function drawPlate() {
  plateGroup.clear();
  if (tab !== 'bat') return;
  const inner = batActor.group.userData.inner;
  inner.updateMatrixWorld(true);
  const plate = new THREE.Vector3(-1, 0, 0).transformDirection(inner.matrixWorld);
  const shape = new THREE.Shape([[-0.216, 0], [0.216, 0], [0.216, 0.216], [0, 0.432], [-0.216, 0.216]].map(([x, y]) => new THREE.Vector2(x, y)));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: '#f4f1ea' }));
  m.rotation.x = -Math.PI / 2;
  const c = plate.clone().multiplyScalar(0.85);
  m.position.set(c.x, 0.004, c.z);
  plateGroup.add(m);
  // 好球区（中间高度约 0.48～1.08 公尺）
  const zone = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.43, 0.6, 0.43)),
    new THREE.LineBasicMaterial({ color: '#d8ff3e', transparent: true, opacity: 0.6 }),
  );
  zone.position.set(c.x, 0.78, c.z + 0.216 * 0);
  plateGroup.add(zone);
}

function setTab(t) {
  tab = t;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  bodyActor.group.visible = t === 'body';
  batActor.group.visible = t === 'bat';
  $('#timeline').classList.toggle('show', t === 'bat');
  buildCams();
  if (t === 'body') {
    refreshBody(0, true);
    setCam('斜前');
  } else {
    rulerGroup.clear();
    if (!swing) swing = analyzeSwing(batActor);
    toStance();
    batActor.update(0); // 先套用击球时「面向本垒」的转向，本垒板与镜头方向才算得对
    renderBatPanel();
    drawPhases();
    drawPlate();
    setCam('斜后方（视频角度）');
  }
  resize();
}

// ── 启动 ──
(async () => {
  await loadPlayerModel();
  const kit = GAME.home.kit;
  bodyActor = makeActor({ ...kit, skin: '#e9b48e', hair: '#1d1a18', no: 7, name: '', look: {}, glove: 1 });
  batActor = makeActor({ ...kit, skin: '#e9b48e', hair: '#1d1a18', no: 7, name: '', look: { band: 'white' }, helmet: 1, bat: true });
  scene.add(bodyActor.group, batActor.group);
  // 动画每一帧都会把骨头位置重设，所以比例要在「动画之后、手臂 IK 握棒之前」套用
  for (const [a, pp] of [[bodyActor, prop], [batActor, batProp]]) {
    const orig = a._tweak.bind(a);
    a._tweak = () => {
      applyProportions(a, pp);
      a.group.updateMatrixWorld(true);
      orig();
    };
  }
  bodyActor.set('idle');
  Object.assign(BATPOSE, BATPOSE_DEFAULT, { freeze: false }); // 只改这一页的内存
  $('#speeds').innerHTML = [0.1, 0.25, 0.5, 1].map((s) => `<button class="chip ${s === speed ? 'on' : ''}" data-speed="${s}">${s === 1 ? '原速' : `${s}×`}</button>`).join('');
  $('#speeds').querySelectorAll('[data-speed]').forEach((b) =>
    b.addEventListener('click', () => {
      speed = +b.dataset.speed;
      $('#speeds').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
    }),
  );
  $('#play').addEventListener('click', () => {
    playing = !playing;
    if (playing && (inStance || scrubU >= 0.999)) scrubU = 0;
    inStance = false;
    $('#play').textContent = playing ? '❚❚ 暂停' : '▶ 播放';
  });
  $('#scrub').addEventListener('input', (e) => {
    playing = false;
    inStance = false;
    $('#play').textContent = '▶ 播放';
    scrubU = +e.target.value;
  });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  setTab(new URLSearchParams(location.search).get('tab') === 'bat' ? 'bat' : 'body');
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    if (tab === 'body') bodyActor.update(dt);
    else if (inStance) batActor.update(dt);
    else {
      if (playing) {
        scrubU += (dt * speed) / CLIP_END;
        if (scrubU >= 1) {
          scrubU = 1;
          playing = false;
          $('#play').textContent = '▶ 播放';
        }
        $('#scrub').value = scrubU;
      }
      swingPose(batActor, scrubU);
      updateLive();
    }
    controls.update();
    renderer.render(scene, camera);
  });
})();

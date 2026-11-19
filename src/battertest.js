// 击球员模型测试页：新的 Meshy 击球员（Blender 减面＋自己绑骨架）和防守队员原始模型并排，同步播放同一组动作，
// 检查皮肤变形、比例与动作。独立页面，不改动游戏。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (s) => document.querySelector(s);

// ── 场景 ──
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9aa3ad');
scene.add(new THREE.HemisphereLight('#ffffff', '#7d6c5a', 1.6));
const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
sun.position.set(3, 6, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2 });
sun.shadow.bias = -0.0004;
// 面数少的模型（脸、手套）每个面比较大，自己投在自己身上的阴影会沿着面的边缘变成一块一块的。
// 沿法线方向多推一点再比对阴影，加上柔边，帽檐投在脸上的影子才是平滑的一片
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 5;
scene.add(sun);
const rim = new THREE.DirectionalLight('#dfe8ff', 1.2);
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
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Meshy 动作名称是生成时的编号，依时间排序对回名字（和 tools/blender/rig_v7.py 相同）
const ORDER = ['pitch', 'idle', 'ready', 'crouch', 'catchUp', 'throw', 'swing'];
const LABEL = { stance: '击球预备', swing: '挥棒', idle: '待机', ready: '防守预备', crouch: '蹲低', catchUp: '接高飞', pitch: '投球', throw: '传球', run: '跑步', walk: '走路' };
function nameClips(clips) {
  const out = {};
  const ids = clips.filter((c) => c.name.startsWith('_')).sort((a, b) => (a.name < b.name ? -1 : 1));
  ids.forEach((c, i) => (out[ORDER[i]] = c));
  for (const c of clips) {
    if (c.name.startsWith('Running')) out.run = c;
    else if (c.name.startsWith('Walking')) out.walk = c;
    else if (!c.name.startsWith('_')) out[c.name] = c; // 游戏流程处理过的模型：动作已经是游戏用的名字
  }
  return out;
}

// ── 加载 ──
const MODELS = [
  { key: 'batter', label: '击球员', url: '/lab/tripo_batter.glb', x: 2.7 },
  { key: 'fielder', label: '防守队员', url: '/lab/tripo_fielder.glb', x: 0.9 },
  { key: 'catcher', label: '接手', url: '/lab/tripo_catcher.glb', x: -0.9 },
  { key: 'umpire', label: '裁判', url: '/lab/tripo_umpire.glb', x: -2.7 },
];
const loader = new GLTFLoader();
const actors = [];
let clip = 'swing';
let playing = true;
let speed = 1;
let t = 0;
let showBones = false;
let wire = false;

function stats(root) {
  let tris = 0;
  let verts = 0;
  root.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry;
      verts += g.attributes.position.count;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  return { tris: Math.round(tris), verts, h: box.max.y - box.min.y };
}

function label(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.font = '600 52px "PingFang SC", sans-serif';
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.fillText(text, 256, 66);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(0.8, 0.15, 1);
  return s;
}

async function load(m) {
  const gltf = await loader.loadAsync(m.url);
  const root = gltf.scene;
  root.position.x = m.x;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      // 游戏流程的模型用顶点色标记布料／皮肤区域（给换队色的着色器读），这一页不换色，关掉才看得到原本的贴图
      if (o.material.vertexColors) {
        o.material.vertexColors = false;
        o.material.needsUpdate = true;
      }
    }
    if (o.isMesh && o.name === 'Icosphere') o.visible = false;
  });
  scene.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const clips = nameClips(gltf.animations);
  const skel = new THREE.SkeletonHelper(root);
  skel.visible = false;
  scene.add(skel);
  const st = stats(root);
  const tag = label(m.label);
  tag.position.set(m.x, st.h + 0.12, 0);
  scene.add(tag);
  return { ...m, root, mixer, clips, skel, st, tag, action: null };
}

function setClip(name) {
  clip = name;
  t = 0;
  for (const a of actors) {
    a.mixer.stopAllAction();
    const c = a.clips[name];
    if (!c) continue;
    a.action = a.mixer.clipAction(c);
    a.action.play();
  }
  // 球棒只在击球时出现（和游戏相同：防守、投球、跑垒的人手上没有球棒）
  const batting = name === 'stance' || name === 'swing';
  for (const a of actors) a.root.traverse((o) => o.name === 'bat_mesh' && (o.visible = batting));
  document.querySelectorAll('#acts .chip').forEach((b) => b.classList.toggle('on', b.dataset.clip === name));
}
const duration = () => actors[0].clips[clip]?.duration || 1;

function applyTime() {
  for (const a of actors) {
    if (!a.action) continue;
    a.action.time = Math.min(t, a.action.getClip().duration);
    a.mixer.update(0);
  }
  const d = duration();
  $('#scrub').value = t / d;
  $('#frame').textContent = `第 ${Math.round(t * 30)} / ${Math.round(d * 30)} 格`;
}

const CAMS = {
  正面: [[0, 1.1, 11.5], [0, 0.95, 0]],
  斜前: [[5.5, 1.8, 9.5], [0, 0.95, 0]],
  侧面: [[11.5, 1.1, 0], [0, 0.95, 0]],
  背面: [[0, 1.3, -11.5], [0, 0.95, 0]],
  近看中间两个: [[0, 1.4, 5.2], [0, 1.0, 0]],
  近看击球员: [[3.5, 1.5, 2.6], [2.7, 1.2, 0]],
};
function setCam(n) {
  camera.position.fromArray(CAMS[n][0]);
  controls.target.fromArray(CAMS[n][1]);
  controls.update();
  document.querySelectorAll('#cams .chip').forEach((b) => b.classList.toggle('on', b.textContent === n));
}

function buildUI() {
  const names = Object.keys(LABEL).filter((n) => actors[0].clips[n]);
  $('#acts').innerHTML = names.map((n) => `<button class="chip" data-clip="${n}">${LABEL[n]}</button>`).join(' ');
  $('#acts').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => setClip(b.dataset.clip)));

  $('#shows').innerHTML = [
    ...actors.map((a) => `<button class="chip on" data-show="${a.key}">${a.label}</button>`),
    '<button class="chip" id="bones">骨架</button>',
    '<button class="chip" id="wire">线框</button>',
  ].join(' ');
  $('#shows').querySelectorAll('[data-show]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = actors.find((x) => x.key === b.dataset.show);
      a.root.visible = !a.root.visible;
      a.tag.visible = a.root.visible;
      a.skel.visible = showBones && a.root.visible;
      b.classList.toggle('on', a.root.visible);
    }),
  );
  $('#bones').addEventListener('click', (e) => {
    showBones = !showBones;
    e.target.classList.toggle('on', showBones);
    for (const a of actors) a.skel.visible = showBones && a.root.visible;
  });
  $('#wire').addEventListener('click', (e) => {
    wire = !wire;
    e.target.classList.toggle('on', wire);
    for (const a of actors) a.root.traverse((o) => o.isMesh && (o.material.wireframe = wire));
  });

  $('#cams').innerHTML = Object.keys(CAMS).map((n) => `<button class="chip">${n}</button>`).join(' ');
  $('#cams').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => setCam(b.textContent)));

  $('#speeds').innerHTML = [0.1, 0.25, 0.5, 1].map((s) => `<button class="chip ${s === speed ? 'on' : ''}" data-speed="${s}">${s === 1 ? '原速' : `${s}×`}</button>`).join(' ');
  $('#speeds').querySelectorAll('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      speed = +b.dataset.speed;
      $('#speeds').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
    }),
  );
  $('#play').addEventListener('click', () => {
    playing = !playing;
    $('#play').textContent = playing ? '❚❚ 暂停' : '▶ 播放';
  });
  $('#scrub').addEventListener('input', (e) => {
    playing = false;
    $('#play').textContent = '▶ 播放';
    t = +e.target.value * duration();
    applyTime();
  });
  // 键盘：空白键播放／暂停，左右键逐格
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      $('#play').click();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      playing = false;
      $('#play').textContent = '▶ 播放';
      t = Math.min(duration(), Math.max(0, t + (e.code === 'ArrowRight' ? 1 : -1) / 30));
      applyTime();
    }
  });

  $('#info').innerHTML = actors
    .map((a) => `<div><b>${a.label}</b><br>三角形 ${a.st.tris.toLocaleString()}、顶点 ${a.st.verts.toLocaleString()}<br>身高 ${a.st.h.toFixed(2)} 公尺</div>`)
    .join('<br>') + '<br><div style="color:var(--dim)">拖曳旋转、滚轮缩放、右键平移<br>空白键播放／暂停，左右键逐格</div>';
}

(async () => {
  for (const m of MODELS) actors.push(await load(m));
  $('#loading').remove();
  buildUI();
  setClip(new URLSearchParams(location.search).get('clip') || 'swing');
  setCam('斜前');
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    if (playing) {
      t += dt * speed;
      if (t > duration()) t = 0;
      applyTime();
    }
    controls.update();
    renderer.render(scene, camera);
  });
})();

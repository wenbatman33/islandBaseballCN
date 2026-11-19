// 球员一览：把两队所有球员、接手、主裁排成一列，检查每个人的长相、背号与装备
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '@fontsource/barlow-condensed/700.css';
import { GAME } from './data.js';
import { loadPlayerModel, makeActor } from './player3d.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#aeb4bd');
scene.add(new THREE.HemisphereLight('#ffffff', '#8a7a6a', 1.6));
const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
sun.position.set(3, 6, 5);
sun.castShadow = true;
sun.shadow.camera.left = -9; sun.shadow.camera.right = 9; sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
scene.add(sun);
const back = new THREE.DirectionalLight('#dfe8ff', 1.4);
back.position.set(-3, 4, -5);
scene.add(back);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: '#8f9a8a' }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
const controls = new OrbitControls(camera, canvas);
const stage = new THREE.Group();
scene.add(stage);
let actors = [];
let pose = 'idle';
let teamKey = 'home';
const who = document.getElementById('who');

function build() {
  stage.clear();
  actors = [];
  const team = GAME[teamKey];
  const list = [...team.lineup.map((p) => ({ p, gear: p.pos === 'C' ? 'catcher' : null, helmet: p.pos === 'DH' ? 1 : 0 })), { p: team.sp }];
  list.push({ p: { name: '', pos: '主裁', look: {} }, ump: true });
  const Q = new URLSearchParams(location.search);
  list.forEach((it, i) => {
    const a = it.ump
      ? makeActor({ jersey: '#2a2f36', accent: '#15181c', pants: '#4a4f57', skin: '#c98f66', gear: 'ump' })
      : makeActor({ ...team.kit, skin: it.p.skin, hair: it.p.hair, no: it.p.no, name: it.p.name, look: it.p.look, glove: it.helmet ? 0 : 1, gear: it.gear, helmet: it.helmet, bat: !!it.helmet });
    if (it.p.bats === '左' && it.helmet) a.side = -1;
    if (it.p.hand === '左投') a.hand = -1;
    a.group.position.x = (i - (list.length - 1) / 2) * 1.05;
    a.info = it.p;
    if (Q.has('bare')) a.group.traverse((o) => { if (o.name === 'cap') o.visible = false; });
    stage.add(a.group);
    actors.push(a);
  });
  setPose(pose);
}
function setPose(name) {
  pose = name;
  actors.forEach((a) => a.set(name));
  document.querySelectorAll('#poses button').forEach((b) => b.classList.toggle('on', b.dataset.k === name));
}
function focus(i, kind = 'front') {
  const a = actors[i];
  const x = a.group.position.x;
  const V = { front: [[x, 1.4, 4.6], [x, 1.0, 0]], back: [[x, 1.4, -4.6], [x, 1.0, 0]], face: [[x + 0.35, 1.75, 1.2], [x, 1.68, 0]], side: [[x + 4.2, 1.1, 0], [x, 0.85, 0]] }[kind];
  camera.position.set(...V[0]);
  controls.target.set(...V[1]);
  who.textContent = `${a.info.pos || ''} ${a.info.no ?? ''} ${a.info.name || ''}　${JSON.stringify(a.info.look || {})}`;
}
function overview(dir = 1) {
  camera.position.set(0, 1.6, 15.5 * dir);
  controls.target.set(0, 0.85, 0);
  who.textContent = '';
}
const mk = (host, label, k, fn) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.k = k;
  b.onclick = fn;
  document.getElementById(host).append(b);
};
for (const [k, label] of [['home', GAME.home.name], ['away', GAME.away.name]]) mk('teams', label, k, () => { teamKey = k; build(); });
for (const k of ['idle', 'ready', 'crouch', 'run', 'stance', 'catchUp']) mk('poses', k, k, () => setPose(k));
mk('views', '全队正面', 'f', () => overview(1));
mk('views', '全队背面', 'b', () => overview(-1));

canvas.addEventListener('dblclick', (e) => {
  const r = new THREE.Raycaster();
  r.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  let best = -1; let d = 1e9;
  actors.forEach((a, i) => { const q = r.ray.distanceToPoint(new THREE.Vector3(a.group.position.x, 0.9, 0)); if (q < d) { d = q; best = i; } });
  if (best >= 0) focus(best);
});
window.__lineup = { focus, overview, setPose, cam: (p, t) => { camera.position.set(...p); controls.target.set(...t); }, solo: (i) => actors.forEach((a, k) => (a.group.visible = i < 0 || k === i)), team: (k) => { teamKey = k; build(); }, get actors() { return actors; } };

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
const clock = new THREE.Clock();
(async () => {
  await document.fonts.load('700 100px "Barlow Condensed"').catch(() => {});
  await loadPlayerModel();
  build();
  overview(1);
  resize();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    actors.forEach((a) => a.update(dt));
    controls.update();
    renderer.render(scene, camera);
  });
})();

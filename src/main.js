import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/600-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow-condensed/900-italic.css';
import './ui.css';

import { LOOK, loadLook } from './look.js';
import { loadTuning, applyLayout, TUNE } from './tuning.js';
import { GAME, setMatchup } from './data.js';
import { chooseTeams } from './teamselect.js';
import { D2R } from './util.js';
import { buildField } from './field.js';
import { buildStadium } from './stadium.js';
import { buildEnvironment, buildSky } from './environment.js';
import { renderPortraits } from './portraits.js';
import { loadPlayerModel, loadPlayerSet } from './player3d.js';

// ── 不让浏览器的手势介入游戏（手机）──
// iOS Safari 会忽略 viewport 的 user-scalable=no，所以缩放要另外用事件挡掉；长按的放大镜与菜单来自文本选取，
// CSS 已经关掉选取，这里再挡掉长按菜单与触摸的缺省行为（DEV 面板与输入框除外，才能卷动和打字）
{
  const editable = (t) => t instanceof Element && !!t.closest('.lil-gui, #dev-export, input, textarea, select');
  const stop = (e) => {
    if (!editable(e.target)) e.preventDefault();
  };
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false }); // iOS 双指缩放
  document.addEventListener('contextmenu', stop); // 长按菜单
  document.addEventListener('selectstart', stop);
  document.addEventListener('dblclick', stop);
  document.addEventListener('touchmove', stop, { passive: false }); // 拉动整页、双指缩放
  // 长按出现放大镜：iOS 在 touchstart 没被取消时才会启动。按钮与链接要保留点击，其余（画面、摇杆、文本）都取消
  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length > 1) return stop(e);
      const t = e.target;
      if (editable(t) || (t instanceof Element && t.closest('button, a, [data-i]'))) return;
      e.preventDefault();
    },
    { passive: false },
  );
  let lastTap = 0; // 连点两下放大
  document.addEventListener(
    'touchend',
    (e) => {
      const now = performance.now();
      if (now - lastTap < 320 && !editable(e.target)) e.preventDefault();
      lastTap = now;
    },
    { passive: false },
  );
  window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false }); // 触摸板捏合、Ctrl＋滚轮
  window.addEventListener('keydown', (e) => (e.ctrlKey || e.metaKey) && ['=', '+', '-', '0'].includes(e.key) && e.preventDefault());
}
import { buildIntroDOM, createDirector, SEGS } from './intro.js';
import { buildHud } from './hud.js';
import { buildGameUI } from './gameui.js';
import { createGame } from './game.js';
import { initAudio, sayParts, voiceStatus, setMuted, isMuted, onMute } from './audio.js';
import { introLines } from './commentary.js';
import { initDevTools } from './devtools.js';

// 自由镜头用的快速镜位（DEV 面板）
export const VIEWS = {
  鸟瞰: { pos: [-225, 84, 165], target: [0, 8, -55] },
  转播席: { pos: [0, 10.4, 27.4], target: [0, 1, -30] },
  击球员: { pos: [3.4, 2.0, 8.2], target: [-0.6, 1.3, -18] },
  外场: { pos: [70, 34, -165], target: [0, 2, -20] },
  湖畔远景: { pos: [330, 60, -430], target: [0, 20, -50] },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.3 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSaturation, uContrast;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      float v = smoothstep(0.9, 0.3, length(vUv - 0.5));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = c;
    }`,
};

async function start() {
  loadLook();
  loadTuning();
  // 贴图上的文本要用到字体，先等加载
  try {
    await Promise.all([
      document.fonts.load('italic 700 40px "Barlow Condensed"'),
      document.fonts.load('600 40px "Barlow Condensed"'),
      document.fonts.load('700 40px "Barlow Condensed"'),
      document.fonts.load('700 40px "Noto Sans SC"', '岛屿职棒'),
    ]);
  } catch (e) {
    /* 字体加载失败就用后备字体 */
  }

  const q = new URLSearchParams(location.search);
  // 检查用参数：?seg=0~4 或 ?seg=live 直接停在该段，&t=0~1 指定进度
  const segParam = q.get('seg');
  const still = q.has('still') || segParam != null;
  if (still) document.body.classList.add('instant');

  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 上限 1.5 倍，减轻显卡负担
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(LOOK.camera.fov, 1, 0.3, 9000);

  const sky = buildSky();
  scene.add(sky);
  scene.add(buildEnvironment());
  scene.add(buildField());
  const stadium = buildStadium();
  scene.add(stadium);

  const hemi = new THREE.HemisphereLight();
  scene.add(hemi);
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); // 4096 太吃显卡；2048 在比赛镜头距离下看不出差别
  const sc = sun.shadow.camera;
  sc.left = -185;
  sc.right = 185;
  sc.top = 185;
  sc.bottom = -185;
  sc.near = 10;
  sc.far = 800;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.12;
  sun.target.position.set(0, 0, -50);
  scene.add(sun, sun.target);
  scene.fog = new THREE.FogExp2(0xffffff, 0.001);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 1;
  controls.maxDistance = 1400;
  controls.enabled = false;

  // 后制
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.6, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  // 球员模型要先加载，头像和场上球员才能创建
  // 球员模型：缺省是卡通比例的四个角色（防守队员是 Tripo 生成并绑好骨架的，手套做在模型上；击球员、接手、裁判是 Meshy 的）。
  // 网址加 ?model=classic 用原本的漫画风球员、?model=meshy 四个角色换回 Meshy 版（比较用）、?model=real 是写实球员
  const modelKind = new URLSearchParams(location.search).get('model');
  // 四个角色都是 Tripo 生成的版本；?model=meshy 换回 Meshy 生成的旧版对照
  const SET = { batter: '/lab/tripo_batter.glb', fielder: '/lab/tripo_fielder.glb', catcher: '/lab/tripo_catcher.glb', umpire: '/lab/tripo_umpire.glb' };
  const MESHY = { batter: '/lab/chibi_batter.glb', fielder: '/lab/chibi_fielder.glb', catcher: '/lab/chibi_catcher.glb', umpire: '/lab/chibi_umpire.glb' };
  if (modelKind === 'classic') await loadPlayerModel();
  else if (modelKind === 'real') await loadPlayerModel('/lab/batter_pro_game.glb');
  else if (modelKind === 'meshy') await loadPlayerSet(MESHY);
  else await loadPlayerSet(SET, { gloveBaked: true, belt: { batter: 1.03, fielder: 0.97, catcher: 0.92, umpire: 0.93 } });

  // 选队：选好之后才创建头像、开场画面与比赛（这些都是照对战组合做的）
  const matchup = await chooseTeams();
  setMatchup(matchup.away, matchup.home);

  // UI
  renderPortraits(GAME);
  document.getElementById('game-tag').innerHTML = `<b>${GAME.title}</b>GAME ${GAME.no}`;
  buildIntroDOM(document.getElementById('intro'), document.getElementById('tags'), GAME);
  const liveEl = document.getElementById('live');
  const hud = buildHud(liveEl);
  const ui = buildGameUI(liveEl);
  applyLayout();

  const director = createDirector({ camera, controls, renderer });
  // ?auto 让 AI 代打整场（测试用），可加倍率例如 ?auto=6
  if (q.has('auto')) {
    TUNE.auto = true;
    TUNE.timeScale = parseFloat(q.get('auto')) || 1;
  }
  const game = createGame({
    scene, camera, canvas, data: GAME, hud, ui, scoreboard: stadium.userData.scoreboard, director,
  });
  window.__game = game;
  // 预览赛后画面（不用真的打完一场）：网址加 ?end=win、?end=lose 或 ?end=tie
  const endPreview = q.get('end');
  if (['win', 'lose', 'tie'].includes(endPreview)) {
    const sc = { win: [2, 5], lose: [6, 3], tie: [4, 4] }[endPreview];
    const lines = { win: [[0, 2, 0], [1, 0, 4]], lose: [[3, 0, 3], [0, 2, 1]], tie: [[1, 3, 0], [2, 0, 2]] }[endPreview];
    liveEl.style.display = 'block';
    ui.final({ S: { score: sc, lines, hits: endPreview === 'lose' ? [10, 6] : [6, 9], inning: 3, regulation: 3 }, away: GAME.away, home: GAME.home, user: 1 });
  }
  window.__dbg = { camera, controls, director, renderer, scene }; // 检查用
  director.setAnchors(game.anchors);
  director.setLiveCam(game.liveCam);
  director.onChange((st) => {
    if (st.mode === 'live') game.start();
    else game.setPaused(true);
  });
  // 开场转播：每换一段介绍就播报一句（球场与赛事、对战组合、打序、防守、首发投手）
  const A = GAME.away;
  const H = GAME.home;
  const INTRO_LINES = introLines(GAME);
  window.__voice = voiceStatus; // 检查用
  // 右上角的静音按键（和 M 键同一个开关）
  const muteBtn = document.getElementById('mute-toggle');
  onMute((off) => {
    muteBtn.classList.toggle('off', off);
    muteBtn.querySelector('span').textContent = off ? '已静音' : '声音开';
  });
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMuted(!isMuted());
    muteBtn.blur(); // 不然之后按空白键会变成又按一次这颗按钮
  });
  // 暂停：右上角按钮或 Esc 键；暂停时整个画面盖上暂停面板，比赛时间、动作、助威全部停住
  const pauseBtn = document.getElementById('pause-toggle');
  const pauseEl = document.getElementById('pause-screen');
  const setPause = (v) => {
    const on = game.hold(v);
    pauseEl.hidden = !on;
    document.body.classList.toggle('paused', on);
    if (on) {
      const S = game.S;
      pauseEl.querySelector('.ps-score').innerHTML =
        `<span>${GAME.away.short}</span><b>${S.score[0]}</b><i>${S.inning} 局${S.half ? '下' : '上'}</i><b>${S.score[1]}</b><span>${GAME.home.short}</span>`;
    }
  };
  pauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setPause(!game.held);
    pauseBtn.blur();
  });
  pauseEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  pauseEl.querySelector('#ps-resume').addEventListener('click', () => setPause(false));
  pauseEl.querySelector('#ps-reselect').addEventListener('click', () => {
    const q = new URLSearchParams(location.search);
    for (const k of ['end', 'home', 'away']) q.delete(k);
    location.search = q.toString();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || director.state.mode !== 'live') return;
    e.preventDefault();
    setPause(!game.held);
  });
  // 切到别的分页或把窗口缩起来：自动暂停，回来不会发现比赛自己跑掉了
  document.addEventListener('visibilitychange', () => document.hidden && director.state.mode === 'live' && setPause(true));
  let lastIntroKey = null;
  let soundOn = false; // 用户点过一次之后才能出声
  director.onChange((st) => {
    const key = st.mode === 'intro' ? SEGS[st.index].key : null;
    if (key && key !== lastIntroKey && !director.state.paused && soundOn) sayParts([INTRO_LINES[key]], true, 'calm');
    lastIntroKey = director.state.paused ? null : key;
  });
  initAudio();

  function setView(name) {
    const v = VIEWS[name];
    if (!v) return;
    director.setFree(true);
    camera.position.set(...v.pos);
    controls.target.set(...v.target);
    camera.fov = LOOK.camera.fov;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function applyLook() {
    const L = LOOK;
    const az = L.sun.azimuth * D2R;
    const el = L.sun.elevation * D2R;
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    sun.position.copy(sun.target.position).addScaledVector(dir, 400);
    sun.color.set(L.sun.color);
    sun.intensity = L.sun.intensity;
    hemi.color.set(L.hemi.sky);
    hemi.groundColor.set(L.hemi.ground);
    hemi.intensity = L.hemi.intensity;
    sky.material.uniforms.uTop.value.set(L.sky.top);
    sky.material.uniforms.uHorizon.value.set(L.sky.horizon);
    sky.material.uniforms.uMid.value.set(L.sky.mid);
    sky.material.uniforms.uSunColor.value.set(L.sky.sunGlow);
    sky.material.uniforms.uSunDir.value.copy(dir);
    scene.fog.color.set(L.fog.color);
    scene.fog.density = L.fog.density;
    renderer.toneMappingExposure = L.post.exposure;
    bloom.strength = L.post.bloomStrength;
    bloom.radius = L.post.bloomRadius;
    bloom.threshold = L.post.bloomThreshold;
    grade.uniforms.uVignette.value = L.post.vignette;
    grade.uniforms.uSaturation.value = L.post.saturation;
    grade.uniforms.uContrast.value = L.post.contrast;
    if (director.state.free) {
      camera.fov = L.camera.fov;
      camera.updateProjectionMatrix();
    }
    controls.autoRotateSpeed = L.camera.orbitSpeed;
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyLayout();
  }
  window.addEventListener('resize', resize);

  applyLook();
  resize();

  initDevTools({ applyLook, setView, views: Object.keys(VIEWS), camera, controls, director, game });

  if (segParam != null) {
    if (segParam === 'live') director.goLive(false);
    else director.goto(Math.min(SEGS.length - 1, Math.max(0, parseInt(segParam, 10) || 0)));
    director.state.paused = true;
    director.state.t = parseFloat(q.get('t') ?? '0.6') * 8;
  } else if (q.has('still')) {
    director.state.paused = true;
    director.state.t = 99;
  } else if (!q.has('auto')) {
    // 开场一打开就自动播放。浏览器规定用户点一下之后才能出声，所以只放一个不挡画面的小提示；
    // 第一次点击或按键后，从当下这一段开始播报
    const hint = document.createElement('div');
    hint.id = 'sound-hint';
    hint.textContent = '点一下画面打开转播声音';
    document.body.appendChild(hint);
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      hint.remove();
      soundOn = true;
      const st = director.state;
      if (st.mode === 'intro') setTimeout(() => sayParts([INTRO_LINES[SEGS[director.state.index].key]], true, 'calm'), 120); // 等音频恢复运作
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }


  // 减轻负担：上限 60 fps、阴影每 3 格更新、分页不可见时不渲染
  renderer.shadowMap.autoUpdate = false;
  const clock = new THREE.Clock();
  let acc = 0;
  let frame = 0;
  renderer.setAnimationLoop(() => {
    acc += clock.getDelta();
    if (document.hidden) {
      acc = 0;
      return;
    }
    if (acc < 1 / 62) return;
    const dt = Math.min(0.1, acc);
    acc = 0;
    if (frame++ % 3 === 0) renderer.shadowMap.needsUpdate = true; // 阴影每 3 格更新一次
    if (director.state.free) {
      controls.autoRotate = LOOK.camera.autoOrbit;
      controls.update();
    }
    game.update(dt);
    director.update(dt);
    composer.render();
  });

  document.body.classList.add('ready');
}

start();

// 游戏用的球员：加载带骨架与动作的模型（public/models/player/player_v7.glb：Meshy 生成、Meshy 自动绑骨架、Meshy 文本转动画，
// 再用 tools/blender/rig_v7.py 整理），
// 头、头发、帽子都用模型本身的造型，不用程序另外捏。帽子是独立的网格（cap），戴头盔时藏起来。
// 下面所有座标都是这个模型静止姿势的座标（公尺，Y 朝上、+Z 是脸的方向），量测值见 art/concept_v2/build/rig_v6.json
import * as THREE from 'three';
import { BATPOSE, applyBatPose, applySwingAim } from './batpose.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// 防守位置（本垒在原点，+X 一垒侧，-Z 外场方向）
export const FIELD_POS = {
  P: [0, -18.44],
  C: [0, 1.7],
  '1B': [17.5, -24],
  '2B': [9, -34],
  SS: [-9, -34],
  '3B': [-17.5, -24],
  LF: [-36, -76],
  CF: [0, -93],
  RF: [36, -76],
};

const FPS = 30;
let SRC = null; // { scene, clips: {名称: AnimationClip} }

// 游戏开始前先加载一次；之后 makePlayer 才能同步创建球员
export function loadPlayerModel(url = '/models/player/player_v7.glb') {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        const clips = {};
        // 动作档里的缩放轨道全是 1，拿掉后才能用骨头缩放做出每个人不同的头型
        gltf.animations.forEach((c) => {
          c.tracks = c.tracks.filter((t) => !t.name.endsWith('.scale'));
          clips[c.name] = c;
        });
        // 区域标记（Blender 导出成顶点颜色）改名成 region：不让 Three.js 当成要乘在颜色上的顶点颜色
        gltf.scene.traverse((o) => {
          const g = o.geometry;
          if (g && g.getAttribute('color')) {
            g.setAttribute('region', g.getAttribute('color'));
            g.deleteAttribute('color');
          }
          if (o.material) o.material.vertexColors = false;
        });
        SRC = { scene: gltf.scene, clips };
        resolve(SRC);
      },
      undefined,
      reject,
    );
  });
}

// ── 角色各用各的模型（卡通比例的新球员）：击球员、防守队员、接手、裁判四个模型，头盔、帽子、护具都直接做在身上 ──
// 加载后 makePlayer 会依角色挑模型，不再用程序另外加头盔、护具、面罩
let ROLES = null;
let ROLE_OPT = {};
function loadOne(url) {
  const keep = SRC;
  return loadPlayerModel(url).then((src) => {
    SRC = keep;
    return src;
  });
}
export async function loadPlayerSet(urls, opt = {}) {
  const [batter, fielder, catcher, umpire] = await Promise.all([urls.batter, urls.fielder, urls.catcher, urls.umpire].map(loadOne));
  ROLES = { batter, fielder, catcher, umpire };
  ROLE_OPT = opt; // gloveBaked：防守队员的手套已经做在模型上；belt：各角色的腰带高度
  SRC = fielder;
  // 这组模型的身体尺寸（静止姿势，公尺）：腰带、领口的高度和背号的位置都和原本的模型不同
  BODY.belt = 0.94;
  BODY.collar = 1.47;
  BACK_RECT.set(-0.15, 1.0, 0.3, 0.3);
  // 这组模型的投球是真人动作（1.9 秒）：擡腿到出手 1.07 秒、之后是收尾。游戏里播 1.6 秒，出手大约在 0.54 的进度
  ONE_SHOT.pitch = [[0, 0], [0.54, 1.07], [1, 1.9]];
  PITCH.dur = 1.6;
  PITCH.releaseU = 0.54;
  return ROLES;
}
const ROLE_BELT = { batter: 0.98, fielder: 0.95, catcher: 0.9, umpire: 0.9 };
function roleOf(opts) {
  if (opts.gear === 'catcher') return 'catcher';
  if (opts.gear === 'ump') return 'umpire';
  return opts.helmet ? 'batter' : 'fielder';
}

// ── 换色：模型只有一张贴图（米白球衣、深绿配色）。在着色器里依颜色判断是哪一种布料，换成球队的颜色 ──
// 深绿（帽子、内搭、袜子、滚边、背号）→ accent；米白（球衣）→ jersey；腰带以下的米白（裤子）→ pants；肤色乘上肤色系数
const REF_SKIN = new THREE.Color('#f2c29e');
const GLOVE_COLOR = '#22252b'; // 击球手套：深灰黑，各队通用
// 静止姿势的手肘、手腕位置（Blender 量的，player_v7.glb）：着色器用来画护腕
const BAND = {
  R: [[-0.2537, 1.1893, -0.1046], [-0.3416, 0.9748, -0.0441]],
  L: [[0.2669, 1.1928, -0.1058], [0.3514, 0.973, -0.0494]],
};
// 背号与姓名印在背上的范围、脸部特征贴在脸上的范围（模型静止姿势的座标：x0, y0, 宽, 高）
const BACK_RECT = new THREE.Vector4(-0.15, 1.1, 0.3, 0.29);
const FACE_RECT = new THREE.Vector4(-0.13, 1.56, 0.26, 0.26);
// 身体各部位的高度：领口（以上不算球衣、深色算头发）、腰带（以下是裤子）、躯干的半宽（以内没有露出皮肤）
const BODY = { collar: 1.52, belt: 1.065, torsoX: 0.22, clothTop: 1.46 };
let BLANK = null;
const blankTex = () => BLANK || (BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1));

const texCache = new Map();
function canvasTex(key, size, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

// 背上的姓名与背号（只用透明度当遮罩，颜色由着色器用球队配色上色）
function backTexture(no, name) {
  if (no == null && !name) return blankTex();
  return canvasTex(`back|${no}|${name}`, 512, (ctx, S) => {
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (name) {
      ctx.font = `700 ${name.length > 2 ? 84 : 92}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
      const gap = name.length > 2 ? 14 : 44;
      const widths = [...name].map((ch) => ctx.measureText(ch).width);
      let x = S / 2 - (widths.reduce((p, c) => p + c, 0) + gap * (name.length - 1)) / 2;
      [...name].forEach((ch, i) => {
        ctx.fillText(ch, x + widths[i] / 2, 74);
        x += widths[i] + gap;
      });
    }
    if (no != null) {
      ctx.font = '700 380px "Barlow Condensed", "Arial Narrow", Impact, sans-serif';
      const text = String(no);
      const w = ctx.measureText(text).width;
      ctx.save();
      ctx.translate(S / 2, 318);
      ctx.scale(Math.min(1.25, 380 / w), 1); // 一位数加宽一点，两位数不超出背部
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  });
}

// 脸部特征：画在一张透明的图上，再从正面贴到脸上。座标换算：模型的 (x, y) → 画布
function faceTexture(kind, hair) {
  if (!kind || kind === 'none') return blankTex();
  return canvasTex(`face|${kind}|${hair}`, 512, (ctx, S) => {
    const X = (x) => ((x - FACE_RECT.x) / FACE_RECT.z) * S;
    const Y = (y) => (1 - (y - FACE_RECT.y) / FACE_RECT.w) * S;
    const L = (v) => (v / FACE_RECT.z) * S;
    const ell = (x, y, rx, ry, rot = 0) => {
      ctx.beginPath();
      ctx.ellipse(X(x), Y(y), L(rx), L(ry), rot, 0, Math.PI * 2);
      ctx.fill();
    };
    const soft = (x, y, rx, ry, color, a) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, color.replace('A', a));
      g.addColorStop(0.55, color.replace('A', a * 0.8));
      g.addColorStop(1, color.replace('A', 0));
      ctx.save();
      ctx.translate(X(x), Y(y));
      ctx.scale(L(rx), L(ry));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    const hc = new THREE.Color(hair || '#1d1a18');
    const dark = `rgba(${Math.round(hc.r * 200)},${Math.round(hc.g * 200)},${Math.round(hc.b * 200)},A)`;
    const k = FS;
    if (kind === 'eyeblack') {
      // 眼睛下方的防眩光黑条
      ctx.fillStyle = 'rgba(22,22,26,0.9)';
      for (const sx of [-1, 1]) ell(sx * F.eyeX, F.eyeY - 0.028, 0.036 * k, 0.0105 * k, sx * -0.1);
    } else if (kind === 'stubble') {
      soft(0, F.mouthY - 0.004, 0.15 * k, 0.062 * k, 'rgba(70,74,82,A)', 0.3);
    } else if (kind === 'goatee') {
      ctx.fillStyle = dark.replace('A', 0.9);
      ell(0, F.mouthY - 0.034, 0.03 * k, 0.018 * k); // 下巴（嘴唇下方留一点距离，不然像张着嘴）
    } else if (kind === 'mustache') {
      ctx.fillStyle = dark.replace('A', 0.9);
      for (const sx of [-1, 1]) ell(sx * 0.03 * k, F.mouthY + 0.012, 0.036 * k, 0.011 * k, sx * 0.22);
    } else if (kind === 'brows') {
      // 粗眉：盖在原本的眉毛上，眉尾上扬
      ctx.fillStyle = dark.replace('A', 1);
      for (const sx of [-1, 1]) ell(sx * F.eyeX, F.browY + 0.002, 0.068 * k, 0.019 * k, sx * -0.2);
    } else if (kind === 'freckle') {
      ctx.fillStyle = 'rgba(150,84,52,0.55)';
      for (const sx of [-1, 1]) for (const [dx, dy] of [[0, 0], [0.03, 0.012], [-0.028, 0.01], [0.012, -0.018], [-0.014, -0.02]]) ell(sx * (F.eyeX + 0.02 * k) + dx * k, F.eyeY - 0.04 + dy * k, 0.006 * k, 0.006 * k);
    }
  });
}
// 脸上的定位点（模型静止姿势的座标）
const F = { eyeX: 0.046, eyeY: 1.692, browY: 1.72, mouthY: 1.613 };
const FS = 0.42; // 脸部配件的尺寸系数（数字是照旧模型的大脸写的）

function tintedMaterial(base, { jersey, accent, pants, skin, hair, no, name, look }, creamTop, decal) {
  const m = base.clone();
  m.vertexColors = false; // 顶点颜色是区域标记（着色器自己读），不是拿来乘在颜色上的
  const u = {
    uAccent: { value: new THREE.Color(accent).convertLinearToSRGB() },
    uJersey: { value: new THREE.Color(jersey).convertLinearToSRGB() },
    uPants: { value: new THREE.Color(pants || jersey).convertLinearToSRGB() },
    uSkin: { value: new THREE.Vector3(1, 1, 1) },
    uCreamTop: { value: creamTop }, // 高于这个高度的米白色不换色（眼白也是浅暖白，不可以被当成球衣）
    uDecal: { value: decal ? 1 : 0 }, // 身体才有背号、发色、脸部特征；帽子没有
    uHair: { value: new THREE.Color(hair || '#1d1a18').convertLinearToSRGB() },
    uBackTex: { value: decal ? backTexture(no, name) : blankTex() },
    uFaceTex: { value: decal && !ROLES ? faceTexture(look && look.face, hair) : blankTex() }, // 角色模型的脸已经画好，不另外贴五官
    uBackRect: { value: BACK_RECT },
    uFaceRect: { value: FACE_RECT },
    uBelt: { value: BODY.belt }, // 腰带高度：以上是球衣、以下是裤子
    uCollar: { value: BODY.collar },
    uFlat: { value: ROLES ? 1 : 0 },
    uFlip: { value: 1 }, // 左打／左投的模型左右镜射时设为 -1，背上的字才不会跟着反过来
    uGlove: { value: new THREE.Color(GLOVE_COLOR).convertLinearToSRGB() }, // 击球手套颜色
    uGloveOn: { value: 0 }, // 击球员才戴击球手套（模型顶点颜色 B＝手）
    uBand: { value: new THREE.Color('#f2efe6').convertLinearToSRGB() }, // 护腕颜色
    uBandOn: { value: 0 },
  };
  if (skin) {
    const c = new THREE.Color(skin).convertLinearToSRGB();
    const r = REF_SKIN.clone().convertLinearToSRGB();
    u.uSkin.value.set(Math.min(1.08, c.r / r.r), Math.min(1.08, c.g / r.g), Math.min(1.08, c.b / r.b));
  }
  m.userData.u = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;\nvarying float vRestNz;\nattribute vec3 region;\nvarying vec3 vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;\nvRestNz = normal.z;\nvRegion = region;'); // 静止姿势的位置与朝向：分球衣和裤子、定位背号与脸
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uAccent; uniform vec3 uJersey; uniform vec3 uPants; uniform vec3 uSkin; uniform vec3 uHair;
        uniform float uCreamTop; uniform float uDecal; uniform float uFlip; uniform float uBelt; uniform float uCollar; uniform float uFlat;
        uniform vec3 uGlove; uniform float uGloveOn; uniform vec3 uBand; uniform float uBandOn;
        uniform sampler2D uBackTex; uniform sampler2D uFaceTex; uniform vec4 uBackRect; uniform vec4 uFaceRect;
        varying vec3 vRest; varying float vRestNz; varying vec3 vRegion;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 s = pow(max(diffuseColor.rgb, 0.0), vec3(1.0 / 2.2));
          float mx = max(s.r, max(s.g, s.b));
          float mn = min(s.r, min(s.g, s.b));
          float ratio = mn / max(mx, 1e-3);
          float lum = dot(s, vec3(0.299, 0.587, 0.114));
          // 区域（模型的顶点颜色，Blender 里用每个三角形的多数颜色标好）：R＝球衣布料、G＝皮肤。
          // 布料整块换成队色，只有细节（绿色滚边、深色钮扣）逐点判断；皮肤整块乘上肤色
          float green = smoothstep(0.02, 0.07, s.g - max(s.r, s.b)) * (1.0 - vRegion.g);
          float darkPix = 1.0 - smoothstep(0.16, 0.28, lum);
          float cream = uDecal * vRegion.r * (1.0 - green) * (1.0 - darkPix);
          float skin = vRegion.g * (1.0 - smoothstep(0.82, 0.95, ratio) * smoothstep(0.55, 0.75, lum)); // 眼白不跟着肤色变暗
          if (uFlat > 0.5) {
            // 角色模型（卡通比例）：贴图是干净的纯色，直接依每个像素的颜色判断，不看三角形的区域标记（网格疏，边缘会成锯齿）
            float warm = s.r - s.b; // 纯白（护腕、眼白）接近 0，米白 0.1 以上
            // 米白和肤色用「红减绿」分：米白 0.04～0.12、肤色 0.2 以上。
            // （不能用红减蓝：有的模型米白偏黄到 0.36，和另一个模型的肤色 0.36 重叠）
            float rg = s.r - s.g;
            green = smoothstep(0.02, 0.07, s.g - max(s.r, s.b));
            cream = uDecal * (1.0 - green) * smoothstep(0.62, 0.74, lum) * smoothstep(0.03, 0.07, warm) * (1.0 - smoothstep(0.14, 0.18, rg)) * (1.0 - step(uCreamTop, vRest.y));
            skin = (1.0 - green) * smoothstep(0.15, 0.19, rg) * smoothstep(0.5, 0.62, lum);
          }
          vec3 cloth = mix(uJersey, uPants, 1.0 - smoothstep(uBelt - 0.01, uBelt + 0.01, vRest.y));
          // 背上原本印死的 17：整块改回球衣布料，再印上这位球员自己的姓名与背号
          vec2 bu = (vRest.xy - uBackRect.xy) / uBackRect.zw;
          float back = uDecal * step(vRestNz, -0.1) * step(0.0, bu.x) * step(bu.x, 1.0) * step(0.0, bu.y) * step(bu.y, 1.0);
          green *= 1.0 - back;
          cream = mix(cream, 1.0, back);
          // 背号范围内布料的明暗改成均匀的（边缘渐进），原本的 17 才不会留下亮暗不同的残影
          float soft = smoothstep(0.0, 0.12, bu.x) * smoothstep(0.0, 0.12, 1.0 - bu.x) * smoothstep(0.0, 0.1, bu.y) * smoothstep(0.0, 0.1, 1.0 - bu.y);
          float shade = mix(clamp(lum / 0.86, 0.0, 1.12), 0.95, back * max(soft, 1.0 - smoothstep(0.5, 0.64, lum)));
          vec3 o = s;
          o = mix(o, uAccent * clamp(lum / 0.2, 0.0, 2.0), green);
          o = mix(o, cloth * shade, cream);
          o = mix(o, s * uSkin, skin * (1.0 - back));
          float ink = texture2D(uBackTex, vec2(uFlip > 0.0 ? 1.0 - bu.x : bu.x, bu.y)).a * back;
          o = mix(o, uAccent * 0.92, ink);
          // 发色：脖子以上的深色（头发、眉毛）
          float hairM = uDecal * step(uCollar, vRest.y) * (1.0 - smoothstep(0.17, 0.27, lum)) * (1.0 - smoothstep(0.1, 0.2, mx - mn));
          hairM *= 1.0 - uFlat * smoothstep(0.02, 0.07, s.g - max(s.r, s.b)); // 角色模型：深绿色的帽子、头盔不是头发
          o = mix(o, uHair * clamp(0.45 + lum * 5.0, 0.45, 1.7), hairM * 0.85);
          // 脸部特征：从正面粘贴
          vec2 fu = (vRest.xy - uFaceRect.xy) / uFaceRect.zw;
          float face = uDecal * smoothstep(0.05, 0.25, vRestNz) * step(0.0, fu.x) * step(fu.x, 1.0) * step(0.0, fu.y) * step(fu.y, 1.0);
          vec4 fc = texture2D(uFaceTex, fu);
          o = mix(o, fc.rgb, fc.a * face);
          // 击球手套与护腕：都用静止姿势的位置逐像素算（沿前臂方向离手腕多远），边缘是干净的一圈，手怎么转都贴着皮肤。
          // 手套：手腕往指尖整只手；护腕：手腕往前臂 1.2～6.8 公分那一圈，刚好接在手套后面
          float gl = 0.0;
          float bd = 0.0;
          for (int k = 0; k < 2; k++) {
            vec3 hw = k == 0 ? vec3(${BAND.R[1].join(', ')}) : vec3(${BAND.L[1].join(', ')});
            vec3 el = k == 0 ? vec3(${BAND.R[0].join(', ')}) : vec3(${BAND.L[0].join(', ')});
            vec3 ax = normalize(hw - el);
            vec3 d = vRest - hw;
            float t = dot(d, ax);
            float r = length(d - ax * t);
            gl = max(gl, smoothstep(-0.016, -0.011, t) * (1.0 - smoothstep(0.24, 0.27, length(d))));
            bd = max(bd, smoothstep(-0.072, -0.066, t) * (1.0 - smoothstep(-0.016, -0.011, t)) * (1.0 - smoothstep(0.07, 0.08, r)));
          }
          float notCloth = 1.0 - vRegion.r; // 袖子、裤子不上色
          gl *= uGloveOn * notCloth;
          bd *= uBandOn * notCloth;
          o = mix(o, uBand * clamp(lum / 0.62, 0.7, 1.15), bd);
          o = mix(o, uGlove * clamp(lum / 0.62, 0.55, 1.25), gl);
          diffuseColor.rgb = pow(clamp(o, 0.0, 1.0), vec3(2.2));
        }`,
      );
  };
  m.customProgramCacheKey = () => 'player-tint-v12-roles';
  return m;
}

/**
 * 创建一位球员（沿用旧接口的参数）。
 * opts: jersey / accent / pants 球队配色；skin 肤色；bat 是否拿球棒。
 * glove：非 0 时戴手套（防守队员）；helmet：非 0 时戴击球头盔、不戴帽子（击球员）。
 * no / name：印在背上的背号与姓名；hair 发色；look：体型、头型、脸部特征、配件（见 data.js 的 lookOf）。
 * gear：'catcher' 接手护具、'ump' 主裁装备。flat：true 时不套用身高体型（头像用）。
 */
export function makePlayer(opts) {
  if (!SRC) throw new Error('球员模型尚未加载，请先 await loadPlayerModel()');
  const role = ROLES ? roleOf(opts) : null;
  const src = role ? ROLES[role] : SRC;
  const inner = cloneSkinned(src.scene);
  const tints = new Map();
  let bat = null;
  inner.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false; // 有骨架的模型动起来会超出原本的范围
    if (o.name === 'bat_mesh') {
      bat = o;
      o.visible = !!opts.bat;
    } else if (o.name === 'ball_mesh') {
      o.visible = false; // 游戏有自己的球
    } else if (o.material.map) {
      // 身体：只有脖子以下的米白色算球衣（头上的浅色是眼白）；帽子：帽徽可以换色
      const key = o.name === 'cap' ? 'cap' : 'body';
      if (!tints.has(key)) tints.set(key, tintedMaterial(o.material, opts, key === 'cap' ? 99 : BODY.collar, key === 'body'));
      o.material = tints.get(key);
    }
  });
  const group = new THREE.Group();
  group.add(inner);
  // 角色模型：装备都做在身上，只有防守队员的手套还是用程序加（生成的模型手上没有手套）
  if (role) addGear(inner, { ...opts, gear: null, helmet: 0, look: {}, glove: role === 'fielder' && !ROLE_OPT.gloveBaked ? opts.glove : 0 });
  else addGear(inner, opts);
  // 体型与头型：整个人的高矮胖瘦用最外层缩放，头的长宽用头骨缩放（头盔、面罩挂在头骨上会一起变）
  const look = opts.look || {};
  const build = { h: opts.flat ? 1 : look.h || 1, w: opts.flat ? 1 : look.w || 1 };
  inner.scale.set(build.w, build.h, build.w);
  const headBone = inner.getObjectByName(BONE.head);
  if (headBone) {
    const k = look.head || 1;
    headBone.scale.set((k * (look.hx || 1)) / build.w, (k * (look.hy || 1)) / build.h, k / build.w);
  }
  group.userData.build = build;
  group.userData.tintU = tints.has('body') ? tints.get('body').userData.u : null;
  if (group.userData.tintU) {
    const u = group.userData.tintU;
    if (role) u.uBelt.value = (ROLE_OPT.belt && ROLE_OPT.belt[role]) || ROLE_BELT[role] || BODY.belt; // 每个角色模型的腰带高度不同（Blender 量的）
    u.uGloveOn.value = opts.helmet && !role ? 1 : 0; // 击球员戴击球手套（角色模型的手套已经做在手上）
    u.uBandOn.value = look.band && !role ? 1 : 0; // 护腕：白色或队色
    if (look.band && look.band !== 'white') u.uBand.value.set(opts.accent || '#1f5a4c').convertLinearToSRGB();
  }
  const mixer = new THREE.AnimationMixer(inner);
  const actions = {};
  for (const [name, clip] of Object.entries(src.clips)) actions[name] = mixer.clipAction(clip);
  actions.idle.play();
  mixer.update(0);
  group.userData.rig = { bat: bat || new THREE.Object3D() };
  group.userData.inner = inner;
  group.userData.mixer = mixer;
  group.userData.actions = actions;
  return group;
}

// ── 装备：手套、头盔、接手护具、主裁装备、眼镜、护腕。先在模型的静止姿势摆好位置，再挂到骨头上跟着动 ──
// 模型座标：X 左、Y 上、Z 前。帽子中心约 (0, 1.74, -0.055)、眼睛高 1.69、肩关节 1.40、腰带 1.02、胯下 0.85、膝 0.50、脚踝 0.13
// 各组装备的零件是照旧的 Q 版模型写的（数字不动），用 fit() 整组从旧位置搬到新模型对应的位置并缩放
function fit(meshes, from, to, s) {
  const g = new THREE.Group();
  g.add(...meshes);
  const k = Array.isArray(s) ? s : [s, s, s];
  g.scale.set(...k);
  g.position.set(to[0] - from[0] * k[0], to[1] - from[1] * k[1], to[2] - from[2] * k[2]);
  return g;
}
const gearGeo = {};
const gearMat = {};
const geo = (key, make) => gearGeo[key] || (gearGeo[key] = make());
const gmat = (key, color, rough = 0.6, metal = 0) => gearMat[key] || (gearMat[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
function part(g, material, pos, scale, rot) {
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.frustumCulled = false;
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  return m;
}
const sphere = () => geo('sphere', () => new THREE.SphereGeometry(1, 20, 14));
const box = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const shellGeo = () => geo('shell', () => new THREE.SphereGeometry(0.345, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.6));

const HELMET_TILT = -0.36; // 负值：顶部往后、前缘擡高（正值会让前缘压到眼睛）
// 装备程序里的骨头名称 → 模型的骨头（Mixamo 命名；three.js 加载时会拿掉名称里的冒号）
const BONE = {
  head: 'mixamorigHead', chest: 'mixamorigSpine2', spine: 'mixamorigSpine', hips: 'mixamorigHips',
  handL: 'mixamorigLeftHand', handR: 'mixamorigRightHand', forearmL: 'mixamorigLeftForeArm', forearmR: 'mixamorigRightForeArm',
  thighL: 'mixamorigLeftUpLeg', thighR: 'mixamorigRightUpLeg', shinL: 'mixamorigLeftLeg', shinR: 'mixamorigRightLeg',
  footL: 'mixamorigLeftFoot', footR: 'mixamorigRightFoot',
};

function addGear(inner, opts) {
  inner.updateMatrixWorld(true);
  const bone = (name) => inner.getObjectByName(BONE[name] || name);
  // 把一组零件挂到骨头上（保持现在摆好的位置）
  const hang = (boneName, ...meshes) => {
    const b = bone(boneName);
    if (!b) return;
    const g = new THREE.Group();
    g.add(...meshes);
    inner.add(g);
    g.updateMatrixWorld(true);
    b.attach(g);
  };
  const look = opts.look || {};
  const catcher = opts.gear === 'catcher';
  const ump = opts.gear === 'ump';
  const accent = opts.accent || '#1f5a4c';

  if (opts.glove && !ump) {
    // 手套戴在模型的左手（左投的球员整个模型会镜射，手套就到右手）。接手用比较大、比较圆的接手手套
    const leather = catcher ? gmat('mitt', '#6b3d1c', 0.7) : gmat('leather', '#8a5527', 0.75);
    const k = (catcher ? 1.32 : 1) * 1.25;
    const glove = new THREE.Group();
    glove.add(part(sphere(), leather, null, [0.095 * k, 0.12 * k, 0.062 * k]));
    glove.add(part(sphere(), leather, [-0.01, 0.03, 0.09 * k], [0.04 * k, 0.068 * k, 0.04 * k]));
    // 手套位置：手腕和中指根的中间（掌心），用骨头的实际位置算，不同身材的模型都对得上
    const wrist = bone('handL');
    const knuckle = inner.getObjectByName('mixamorigLeftHandMiddle1');
    if (wrist && knuckle) {
      const a = inner.worldToLocal(wrist.getWorldPosition(new THREE.Vector3()));
      const b = inner.worldToLocal(knuckle.getWorldPosition(new THREE.Vector3()));
      glove.position.copy(a.lerp(b, 0.5));
    } else glove.position.set(0.37, 0.9, -0.03);
    glove.rotation.z = 0.38; // 顺着手臂的斜度
    hang('handL', glove);
  }

  // 模型本身已经做了头盔（没有独立的帽子网格）时，击球员不要再叠一顶程序做的头盔
  const bakedHelmet = !inner.getObjectByName('cap');
  if ((opts.helmet && !(bakedHelmet && !catcher && !ump)) || catcher || ump) {
    const cap = inner.getObjectByName('cap');
    if (cap) cap.visible = false; // 戴头盔的人不戴帽子
    const shellMat = ump
      ? gmat('umpShell', '#16181c', 0.55)
      : new THREE.MeshStandardMaterial({ color: accent, roughness: 0.32, metalness: 0.05 });
    const helmet = new THREE.Group();
    helmet.add(part(shellGeo(), shellMat));
    if (opts.helmet && !catcher && !ump) {
      const brimGeo = geo('brim', () => new THREE.CylinderGeometry(0.27, 0.27, 0.03, 28, 1, false, -Math.PI / 2, Math.PI));
      helmet.add(part(brimGeo, shellMat, [0, -0.045, 0.2], null, [0.16 - HELMET_TILT, 0, 0])); // 抵掉整顶往后倾的角度，帽檐才是平的
      // 护耳在面向投手的那一侧。右击球员的左耳朝投手；左击球员整个模型镜射，护耳也跟着换边
      helmet.add(part(sphere(), shellMat, [0.3, -0.13, 0.0], [0.063, 0.15, 0.142]));
    }
    // 刚好比帽子大一圈，并往后倾：前缘停在眉毛上方，后缘往下盖住后脑（帽子切掉后头顶没有头发，要盖住）
    helmet.position.set(0, 1.76, -0.06);
    helmet.scale.set(0.43, 0.45, 0.48);
    helmet.rotation.x = HELMET_TILT;
    hang('head', helmet);
  }

  if (catcher || ump) {
    // 面罩：椭圆外框＋横向与直向的护条（往前鼓出），上下有软垫
    const steel = gmat('steel', '#23272d', 0.4, 0.5);
    const pad = ump ? gmat('umpPad', '#1b1d21', 0.85) : new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8 });
    const ring = geo('maskRing', () => new THREE.TorusGeometry(0.2, 0.017, 8, 36));
    const arc = geo('maskArc', () => new THREE.TorusGeometry(0.2, 0.012, 6, 20, Math.PI));
    const CY = 1.25;
    const CZ = 0.265;
    const mask = [part(ring, steel, [0, CY, CZ], [1.02, 1.12, 1])];
    for (const dy of [-0.1, -0.03, 0.04, 0.11]) {
      const w = Math.sqrt(1 - (dy / 0.224) ** 2) * 1.02; // 横条两端刚好接在椭圆外框上
      mask.push(part(arc, steel, [0, CY + dy, CZ], [w, 0.42, 1], [Math.PI / 2, 0, 0]));
    }
    for (const dx of [-0.07, 0.07]) mask.push(part(arc, steel, [dx, CY, CZ], [1.07, 0.4, 1], [Math.PI / 2, Math.PI / 2, 0]));
    mask.push(part(sphere(), pad, [0, CY + 0.215, CZ - 0.012], [0.13, 0.036, 0.04])); // 额头软垫
    mask.push(part(sphere(), pad, [0, CY - 0.215, CZ - 0.012], [0.11, 0.036, 0.04])); // 下巴软垫
    mask.push(part(sphere(), pad, [0, CY - 0.285, CZ - 0.03], [0.05, 0.05, 0.022])); // 护喉
    for (const sx of [-1, 1]) mask.push(part(box(), steel, [sx * 0.245, CY + 0.03, CZ - 0.11], [0.02, 0.035, 0.24], [0, sx * -0.38, 0])); // 两侧固定带
    hang('head', fit(mask, [0, CY, CZ], [0, 1.69, 0.1], 0.48)); // 搬到新模型的脸前

    // 护胸：一节一节的横向护垫，越往下越窄；背后有交叉的固定带
    const chestMat = ump ? gmat('umpPad', '#1b1d21', 0.85) : new THREE.MeshStandardMaterial({ color: accent, roughness: 0.85 });
    const strap = gmat('strap', '#191b1f', 0.9);
    const chest = [];
    const rows = ump ? [[0.955, 0.165], [0.895, 0.172], [0.835, 0.165], [0.775, 0.15]] : [[0.955, 0.168], [0.895, 0.178], [0.835, 0.172], [0.775, 0.158], [0.715, 0.136]];
    const top = rows[0][0];
    const low = rows[rows.length - 1][0];
    chest.push(part(sphere(), chestMat, [0, (top + low) / 2, 0.05], [0.172, (top - low) / 2 + 0.045, 0.085])); // 底板
    for (const [y, w] of rows) chest.push(part(sphere(), chestMat, [0, y, 0.066], [w, 0.031, 0.09])); // 一节节的护垫
    for (const sx of [-1, 1]) chest.push(part(sphere(), chestMat, [sx * 0.155, 0.985, 0.012], [0.062, 0.036, 0.085])); // 肩垫
    if (!ump) {
      for (const sx of [-1, 1]) chest.push(part(box(), strap, [0, 0.855, -0.112], [0.03, 0.4, 0.014], [0, 0, sx * 0.72])); // 背后交叉带
      chest.push(part(box(), strap, [0, 0.735, -0.108], [0.3, 0.028, 0.014])); // 腰带
    }
    const TORSO = [[0, 0.835, 0], [0, 1.24, -0.06], [1.15, 1.55, 1.4]]; // 旧躯干中心 → 新躯干中心、缩放
    hang('chest', fit(chest, ...TORSO));
    if (!ump) hang('spine', fit([part(sphere(), chestMat, [0, 0.645, 0.075], [0.085, 0.05, 0.05])], ...TORSO)); // 护裆片
  }

  if (catcher) {
    // 护胫：膝盖护片＋小腿护壳＋脚背护片
    const guard = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 });
    const strap = gmat('strap', '#191b1f', 0.9);
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const x = sx * 0.111;
      const LEG = [[x, 0.2, 0], [sx * 0.172, 0.31, -0.1], [1.1, 1.9, 1.15]]; // 旧小腿 → 新小腿（腿长很多）
      hang(`shin${side}`, fit([
        part(sphere(), guard, [x, 0.2, 0.03], [0.068, 0.105, 0.062]),
        part(sphere(), strap, [x, 0.2, 0.068], [0.014, 0.1, 0.03]),
        part(sphere(), guard, [x, 0.315, 0.04], [0.066, 0.052, 0.058]),
        part(box(), strap, [x, 0.24, -0.02], [0.13, 0.016, 0.1]),
        part(box(), strap, [x, 0.15, -0.02], [0.13, 0.016, 0.1])], ...LEG));
      hang(`thigh${side}`, fit([part(sphere(), guard, [x, 0.375, 0.045], [0.06, 0.04, 0.05])], ...LEG));
      hang(`foot${side}`, fit([part(sphere(), guard, [x, 0.075, 0.085], [0.055, 0.03, 0.06])], [x, 0.075, 0.085], [sx * 0.19, 0.1, 0.03], 1.2));
    }
  }

  if (ump) {
    // 腰侧的球袋
    hang('hips', part(sphere(), gmat('umpBag', '#2c3036', 0.9), [0.225, 0.93, -0.03], [0.06, 0.08, 0.07]));
  }

  if (look.glasses && !catcher && !ump) {
    // 眼镜：细框（'sun' 为运动太阳眼镜，镜片是深色的）
    const sun = look.glasses === 'sun';
    const frame = gmat(sun ? 'sunFrame' : 'frame', sun ? '#14161a' : '#2a2320', 0.4, 0.3);
    const rim = geo('rim', () => new THREE.TorusGeometry(0.082, 0.008, 6, 24));
    const g = [];
    for (const sx of [-1, 1]) {
      g.push(part(rim, frame, [sx * 0.118, 1.236, 0.268], [1, 0.9, 1], [0, sx * 0.3, 0]));
      if (sun) g.push(part(geo('lens', () => new THREE.CircleGeometry(0.082, 20)), gmat('lens', '#1d2a33', 0.15, 0.6), [sx * 0.118, 1.236, 0.268], [1, 0.9, 1], [0, sx * 0.3, 0]));
      g.push(part(box(), frame, [sx * 0.245, 1.25, 0.14], [0.008, 0.012, 0.26], [0, sx * -0.3, 0])); // 镜脚
    }
    g.push(part(box(), frame, [0, 1.25, 0.29], [0.075, 0.01, 0.008])); // 鼻梁
    hang('head', fit(g, [0, 1.236, 0.268], [0, 1.692, 0.082], [0.42, 0.42, 0.75])); // 搬到新模型的眼睛前面
  }

  // 护腕改由着色器画在手腕皮肤上（模型顶点颜色 B＝0.5 那一圈），手转动时永远贴合，不再是会翘起来的圆筒
}

// 单次动作：把「游戏里的进度 0–1」对应到动作档的时间（秒）。
// 投球：游戏在进度 0.69 让球离手，对到动作的出手那一格（第 41 格）。
// 挥棒：从跨步前开始，进度 0.42 对到击球那一格（第 25 格）。
// 第 7 版：投球（Meshy 动作）在 1.25 秒出手；挥棒（CMU 真人动作捕捉）0.67 秒击球；传球在 0.5 秒出手
// 投球动作在游戏里播多久（秒），以及播到多少进度时球离手（对到 ONE_SHOT.pitch 中间那个转折点）。
// 不同模型的投球动作不同，加载角色模型时会改
export const PITCH = { dur: 1.25, releaseU: 0.69 };
const ONE_SHOT = {
  pitch: [[0, 0], [0.69, 1.25], [1, 1.72]],
  swing: [[0, 0.45], [0.42, 0.67], [1, 1.13]], // CMU 真人挥棒：0.67 秒击球
  throw: [[0, 0], [0.5, 0.5], [1, 0.85]],
};
const BATTING = new Set(['stance', 'swing']);
const FADE = 0.12;

function mapTime(segs, u) {
  for (let i = 1; i < segs.length; i++) {
    if (u <= segs[i][0]) {
      const k = (u - segs[i - 1][0]) / (segs[i][0] - segs[i - 1][0]);
      return segs[i - 1][1] + (segs[i][1] - segs[i - 1][1]) * k;
    }
  }
  return segs[segs.length - 1][1];
}

function findBatBone(inner) {
  if (inner.userData.batBone === undefined) inner.userData.batBone = inner.getObjectByName('bat') || null;
  return inner.userData.batBone;
}

// 把模型包成可播放姿势的角色
export function makeActor(opts) {
  const group = makePlayer(opts);
  const { inner, mixer, actions } = group.userData;
  let current = actions.idle;
  const a = {
    group,
    rig: group.userData.rig,
    pose: 'idle',
    t: 0,
    u: 0,
    dur: 0,
    after: null,
    side: 1, // 击球站位：-1 为左打
    hand: 1, // 惯用手：-1 为左投
    seed: Math.random() * 6,
    _switch(name, oneShot) {
      const next = actions[name] || actions.idle;
      if (next !== current) {
        next.reset();
        next.enabled = true;
        next.setEffectiveWeight(1);
        next.paused = oneShot;
        next.play();
        current.crossFadeTo(next, FADE, false);
        current = next;
      } else {
        next.paused = oneShot;
        if (oneShot) next.time = 0;
      }
      if (!oneShot && next.getClip().duration > 0) next.time = (a.seed / 6) * next.getClip().duration; // 每个人起始时间错开，不会全队同步晃动
    },
    // 循环姿势
    set(name) {
      if (a.pose === name && !a.dur) return;
      a.pose = name;
      a.dur = 0;
      a.u = 0;
      a._switch(name, false);
    },
    // 单次动作，播完切到 after
    play(name, dur, after = 'idle') {
      a.pose = name;
      a.dur = dur;
      a.u = 0;
      a.after = after;
      a._switch(name, true);
      current.time = mapTime(ONE_SHOT[name] || [[0, 0], [1, current.getClip().duration]], 0);
    },
    update(dt) {
      if (!group.visible) return; // 没显示的球员（另一队的防守）不用算动作
      a.t += dt;
      if (dt === 0) {
        // 只摆一次姿势、时间没有前进（开场介绍时）：动作切换的淡入不会发生，要直接切到位，
        // 否则会停在上一个姿势（例如击球员手垂着、球棒浮在半空）
        for (const act of Object.values(actions)) {
          if (act !== current) act.stop();
        }
        current.enabled = true;
        current.setEffectiveWeight(1);
      }
      // 左打／左投：整个模型左右镜射
      const mirror = a.side < 0 || a.hand < 0 ? -1 : 1;
      inner.scale.x = mirror * group.userData.build.w;
      if (group.userData.tintU) group.userData.tintU.uFlip.value = mirror;
      // 游戏把击球员转成面向本垒板；动作档里的击球员是以「投手方向」为正前方，所以多转 90 度
      inner.rotation.y = BATTING.has(a.pose) ? (a.side < 0 ? -1 : 1) * (Math.PI / 2) : 0;
      if (a.dur) {
        a.u = Math.min(1, a.u + dt / a.dur);
        current.time = mapTime(ONE_SHOT[a.pose] || [[0, 0], [1, current.getClip().duration]], a.u);
        mixer.update(dt);
        a._tweak();
        if (a.u >= 1) {
          const after = a.after;
          a.dur = 0;
          a.pose = '';
          a.set(after);
        }
        return;
      }
      mixer.update(dt); // 时间照常走：动作之间的淡入淡出才会完成
      if (BATPOSE.freeze && a.pose === 'stance') {
        current.time = 0.7; // DEV：定格预备姿势，方便和参考图对照
        mixer.update(0);
      }
      a._tweak();
    },
    // 击球姿势微调层（DEV 面板可即时调整）：预备时整段套用，挥棒刚开始时平顺退掉
    _tweak() {
      if (!BATTING.has(a.pose)) return;
      let w = 1;
      const bat = findBatBone(inner);
      if (a.pose === 'swing') {
        const k = Math.max(0, 1 - a.u / 0.25);
        w = k * k * (3 - 2 * k);
        // 击球（u≈0.42）前后让球棒经过瞄准点的高度：0.18 起渐入、0.5 后渐出
        const sm = (e0, e1, x) => {
          const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
          return t * t * (3 - 2 * t);
        };
        const wa = sm(0.18, 0.36, a.u) * (1 - sm(0.5, 0.75, a.u));
        applyBatPose(inner, bat, w);
        applySwingAim(inner, bat, wa, a.aimY ?? 0.78);
        return;
      }
      applyBatPose(inner, bat, w);
    },
    face(x, z) {
      group.rotation.y = Math.atan2(x - group.position.x, z - group.position.z);
    },
  };
  return a;
}

// 可在 DEV 面板调整的版面与镜头（导出后的数值会写回这里）
const L0 = () => ({ x: 0, y: 0, s: 1 });
const LAY_KEYS = [
  'venue', 'matchup', 'lineup', 'defenseHead', 'pitcher', 'introBar',
  'scorebug', 'batterCard', 'pitcherChip', 'pitchMenu', 'hint', 'banner', 'pitchInfo',
  'stick', 'mainBtn', 'penBtn',
];
const layoutTable = () => Object.fromEntries(LAY_KEYS.map((k) => [k, L0()]));

export const LAYOUT = { pc: layoutTable(), mobile: layoutTable() };

// 开场各段镜头：from → to 在 dur 秒内移动；shift 为主体水平偏移（占画面宽度比例）
export const SHOTS = {
  venue: {
    dur: 7, shift: 0,
    from: { pos: [-440, 180, 345], target: [0, 24, -55], fov: 34 },
    to: { pos: [-225, 84, 165], target: [0, 8, -55], fov: 32 },
  },
  matchup: {
    dur: 6, shift: 0,
    from: { pos: [21, 2.2, -3], target: [-6, 4.5, -30], fov: 40 },
    to: { pos: [16.5, 2.7, 3.5], target: [-8, 4.5, -30], fov: 40 },
  },
  lineup: {
    dur: 8, shift: 0.2, liftMobile: 0.27,
    from: { pos: [-4.2, 1.45, -5.2], target: [0.8, 1.1, 0.4], fov: 28 },
    to: { pos: [-1.8, 1.6, -6.6], target: [0.8, 1.1, 0.4], fov: 28 },
  },
  defense: {
    dur: 8, shift: 0,
    from: { pos: [0, 86, 70], target: [0, 0, -50], fov: 40 },
    to: { pos: [0, 76, 58], target: [0, 0, -47], fov: 40 },
  },
  pitcher: {
    dur: 8, shift: 0.17, liftMobile: 0.14,
    from: { pos: [4.4, 1.9, -12.4], target: [0, 1.3, -18.44], fov: 28 },
    to: { pos: [-2.6, 1.7, -12.0], target: [0, 1.25, -18.44], fov: 28 },
  },
  live: {
    dur: 0, shift: 0,
    // 镜头在接手后上方：拉高拉远一点，大头的击球员才不会压到画面上缘、挡住投手
    from: { pos: [0, 2.45, 9.6], target: [0, 1.0, -8], fov: 19 },
    to: { pos: [0, 2.45, 9.6], target: [0, 1.0, -8], fov: 19 },
  },
};

// 玩法参数
export const TUNE = {
  innings: 3, // 局数
  extra: 3, // 平局时最多延长几局（0＝不打延长赛）
  speedScale: 0.5, // 球速倍率（越小球越慢、越好打）
  pci: 0.2, // 击球光标半径（公尺）
  timing: 0.17, // 挥棒时机宽容度（秒）
  assist: true, // 显示进垒点预测圈
  aimAssist: 0.5, // 瞄准辅助（0＝完全自己瞄，1＝只看挥棒时机）
  pickWindow: 1.6, // 防守选垒：可以选的时间（真实秒数），时间到自动传
  slowMo: 0.3, // 防守选垒时的慢动作倍率（1＝不放慢）
  throwSpeed: 32, // 传球速度（公尺／秒）
  pickSize: 1, // 浮动垒包按钮大小
  auto: false, // AI 代为操作（测试用）
  timeScale: 1, // 时间倍率（测试用）
};

const KEY = 'starridge.tuning.v1';
const DEFAULTS = JSON.parse(JSON.stringify({ LAYOUT, SHOTS, TUNE }));
const TUNE_SAVED = ['innings', 'extra', 'speedScale', 'pci', 'timing', 'assist', 'aimAssist', 'pickWindow', 'slowMo', 'throwSpeed', 'pickSize'];
const pickTune = () => Object.fromEntries(TUNE_SAVED.map((k) => [k, TUNE[k]]));

function merge(target, src) {
  for (const k of Object.keys(target)) {
    if (src == null || !(k in src)) continue;
    if (Array.isArray(target[k])) target[k] = src[k];
    else if (typeof target[k] === 'object' && target[k] !== null) merge(target[k], src[k]);
    else target[k] = src[k];
  }
}

export function loadTuning() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      merge(LAYOUT, d.LAYOUT);
      merge(SHOTS, d.SHOTS);
      if (d.TUNE) for (const k of TUNE_SAVED) if (k in d.TUNE) TUNE[k] = d.TUNE[k];
      if (d.TUNE && d.TUNE.timing === 0.13) TUNE.timing = DEFAULTS.TUNE.timing; // 旧的默认值太严，没自己调过的人换成新缺省
    }
  } catch (e) {
    /* 读不到就用默认值 */
  }
}
export function saveTuning() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ LAYOUT, SHOTS, TUNE: pickTune() }));
  } catch (e) {
    /* 忽略 */
  }
}
export function resetTuning() {
  merge(LAYOUT, JSON.parse(JSON.stringify(DEFAULTS.LAYOUT)));
  merge(SHOTS, JSON.parse(JSON.stringify(DEFAULTS.SHOTS)));
  Object.assign(TUNE, DEFAULTS.TUNE);
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* 忽略 */
  }
}

// 版面模式：自动依宽度判断，DEV 可强制指定
let forced = 'auto';
export const setForcedMode = (m) => {
  forced = m;
};
export const layoutMode = () => (forced !== 'auto' ? forced : window.innerWidth < 700 ? 'mobile' : 'pc');

export function applyLayout() {
  const table = LAYOUT[layoutMode()];
  document.querySelectorAll('[data-lay]').forEach((el) => {
    const v = table[el.dataset.lay];
    if (!v) return;
    el.style.translate = `${v.x}px ${v.y}px`;
    el.style.scale = String(v.s);
  });
}

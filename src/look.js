// 画面风格参数（DEV 面板调整后导出的数值会写回这里）
export const LOOK = {
  sun: { azimuth: 272, elevation: 31, intensity: 3.6, color: '#ffdcae' },
  hemi: { sky: '#b4d0ff', ground: '#7a6650', intensity: 1.15 },
  sky: { top: '#2a66cc', mid: '#a6d0f7', horizon: '#ffcf96', sunGlow: '#ffb469' },
  fog: { color: '#f0d2ad', density: 0.00042 },
  post: {
    exposure: 1.08,
    bloomStrength: 0.32,
    bloomRadius: 0.7,
    bloomThreshold: 0.9,
    vignette: 0.32,
    saturation: 1.12,
    contrast: 1.06,
  },
  camera: { fov: 32, autoOrbit: false, orbitSpeed: 0.25 },
};

const STORAGE_KEY = 'starridge.look.v1';

// 深层合并：只覆盖默认值里已存在的字段
function merge(target, src) {
  for (const k of Object.keys(target)) {
    if (!(k in src)) continue;
    if (typeof target[k] === 'object' && target[k] !== null) merge(target[k], src[k]);
    else target[k] = src[k];
  }
}

export const LOOK_DEFAULT = JSON.parse(JSON.stringify(LOOK));

export function loadLook() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) merge(LOOK, JSON.parse(raw));
  } catch (e) {
    /* 读不到就用默认值 */
  }
}

export function saveLook() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(LOOK));
  } catch (e) {
    /* 忽略 */
  }
}

export function resetLook() {
  merge(LOOK, LOOK_DEFAULT);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    /* 忽略 */
  }
}

import * as THREE from 'three';
import { BASES } from './ballsim.js';
import { FIELD_Y } from './util.js';
import { TUNE } from './tuning.js';

// ── 防守传垒：跟着镜头的浮动垒包图层 ──
// 四个垒包按钮每一帧投影到画面上真正的垒包位置（镜头怎么动都贴着垒包）。
// 手机直接点；电脑按 1–4（一垒、二垒、三垒、本垒），也可以用鼠标点。
// 能让跑垒员出局的垒包亮绿色；上方有倒数条，时间到自动传。
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const LABEL = { 1: '一垒', 2: '二垒', 3: '三垒', 4: '本垒' };

export function createBasePicker({ camera, canvas, onPick }) {
  const root = document.createElement('div');
  root.id = 'base-picker';
  const btns = {};
  for (const n of [1, 2, 3, 4]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bp-base';
    b.innerHTML = `<i>${n}</i><span>${LABEL[n]}</span>`;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (open) onPick(n);
    });
    root.appendChild(b);
    btns[n] = b;
  }
  const bar = document.createElement('div');
  bar.className = 'bp-bar';
  bar.innerHTML = '<b>传哪一垒？</b><span class="bp-keys">手机点垒包・电脑按 1–4</span><em><u></u></em>';
  root.appendChild(bar);
  document.body.appendChild(root);
  const fill = bar.querySelector('u');

  let open = false;
  window.addEventListener('keydown', (e) => {
    if (!open || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      onPick(+e.key);
    }
  });

  const v = new THREE.Vector3();
  return {
    get open() {
      return open;
    },
    // hints[n]＝true：传到 n 垒有机会让跑垒员出局（亮绿色）
    show(hints) {
      open = true;
      root.classList.add('show');
      this.hints(hints);
      this.update(0);
    },
    hide() {
      open = false;
      root.classList.remove('show');
    },
    hints(h) {
      for (const n of [1, 2, 3, 4]) btns[n].classList.toggle('good', !!(h && h[n]));
    },
    // k：剩余时间比例 1→0
    update(k) {
      if (!open) return;
      fill.style.transform = `scaleX(${clamp(k, 0, 1)})`;
      const r = canvas.getBoundingClientRect();
      const s = TUNE.pickSize;
      for (const n of [1, 2, 3, 4]) {
        const [x, z] = BASES[n % 4];
        v.set(x, FIELD_Y + 0.3, z).project(camera);
        const behind = v.z > 1;
        // 垒包跑出画面时贴在画面边缘，仍然点得到
        const sx = clamp(r.left + (v.x * 0.5 + 0.5) * r.width, r.left + 44 * s, r.right - 44 * s);
        const sy = clamp(r.top + (-v.y * 0.5 + 0.5) * r.height, r.top + 90 * s, r.bottom - 54 * s);
        btns[n].style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${s})`;
        btns[n].classList.toggle('edge', behind);
      }
    },
  };
}

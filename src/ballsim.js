import { fenceR, D2R } from './util.js';

// 垒包位置：本垒、一垒、二垒、三垒（场地座标 x, z）
export const BASES = [
  [0, 0],
  [19.4, -19.4],
  [0, -38.8],
  [-19.4, -19.4],
];

const G = 9.8;
const DRAG = 0.0046;
export const SIM_DT = 1 / 90;
const WALL_H = 3.4;

// 击出球的飞行轨迹（含空气阻力、弹跳、滚动、撞墙）
export function flight(ev, laDeg, sprayDeg) {
  const la = laDeg * D2R;
  const sp = sprayDeg * D2R;
  let x = 0;
  let y = 0.85;
  let z = -0.3;
  const vh = ev * Math.cos(la);
  let vx = vh * Math.sin(sp);
  let vz = -vh * Math.cos(sp);
  let vy = ev * Math.sin(la);
  const path = [];
  let t = 0;
  let bounced = false;
  let hr = false;
  let grd = false;
  let land = null;

  while (t < 14) {
    path.push({ t, x, y, z, air: !bounced });
    const v = Math.hypot(vx, vy, vz);
    if (y > 0.001 || vy > 0) {
      vx -= DRAG * v * vx * SIM_DT;
      vy -= (G + DRAG * v * vy) * SIM_DT;
      vz -= DRAG * v * vz * SIM_DT;
    } else {
      const h = Math.hypot(vx, vz);
      if (h < 0.4) break;
      const dec = Math.min(h, 5.2 * SIM_DT);
      vx -= (vx / h) * dec;
      vz -= (vz / h) * dec;
      vy = 0;
    }
    x += vx * SIM_DT;
    y += vy * SIM_DT;
    z += vz * SIM_DT;
    if (y < 0) {
      y = 0;
      if (!land) land = { t, x, z };
      bounced = true;
      vy = Math.abs(vy) < 1.3 ? 0 : -vy * 0.42;
      vx *= 0.8;
      vz *= 0.8;
    }
    const r = Math.hypot(x, z);
    const deg = Math.atan2(x, -z) / D2R;
    const R = fenceR(deg);
    if (hr) {
      // 飞进看台后落到座位高度就停
      if (y <= WALL_H + (r - R) * 0.55 || y <= 0.5) break;
    } else if (r >= R - 0.15) {
      if (Math.abs(deg) <= 45 && y >= WALL_H) {
        if (!bounced) hr = true;
        else {
          grd = true; // 弹跳后越过本垒打墙
          break;
        }
      } else {
        const nx = x / r;
        const nz = z / r;
        const vr = vx * nx + vz * nz;
        if (vr > 0) {
          vx -= 1.35 * vr * nx;
          vz -= 1.35 * vr * nz;
          vx *= 0.75;
          vz *= 0.75;
        }
        const k = (R - 0.2) / r;
        x *= k;
        z *= k;
      }
    }
    t += SIM_DT;
  }
  const last = path[path.length - 1];
  if (!land) land = { t: last.t, x: last.x, z: last.z };
  return { path, hr, grd, land, dist: Math.hypot(land.x, land.z) };
}

const INFIELD = ['P', 'C', '1B', '2B', 'SS', '3B'];
const SPEC = {
  P: { speed: 5.6, react: 0.5 },
  C: { speed: 5.2, react: 0.55 },
  '1B': { speed: 6.3, react: 0.24 },
  '2B': { speed: 6.7, react: 0.22 },
  SS: { speed: 6.8, react: 0.22 },
  '3B': { speed: 6.4, react: 0.22 },
  LF: { speed: 7.5, react: 0.36 },
  CF: { speed: 7.9, react: 0.34 },
  RF: { speed: 7.5, react: 0.36 },
};

// 找出最早能接到球的防守队员与接球点
export function fieldPlay(fl, fielders) {
  const need = (f, p) => SPEC[f.pos].react + Math.hypot(f.x - p.x, f.z - p.z) / SPEC[f.pos].speed;
  for (let i = 0; i < fl.path.length; i++) {
    const p = fl.path[i];
    if (p.y > 2.5) continue;
    let best = null;
    for (const f of fielders) {
      const n = need(f, p);
      if (n <= p.t && (!best || n < best.n)) best = { f, n };
    }
    if (best) {
      return {
        who: best.f.pos, t: p.t, idx: i, point: p,
        caught: p.air && p.y > 0.12, react: SPEC[best.f.pos].react,
      };
    }
  }
  // 球停下来都没人到：最近的人跑过去捡
  const p = fl.path[fl.path.length - 1];
  let best = null;
  for (const f of fielders) {
    const n = need(f, p);
    if (!best || n < best.n) best = { f, n };
  }
  return { who: best.f.pos, t: best.n, idx: fl.path.length - 1, point: p, caught: false, react: SPEC[best.f.pos].react };
}

const dist = (p, b) => Math.hypot(p.x - b[0], p.z - b[1]);

// 依接球结果决定这一球的结局
// st: { outs, on: [一垒有人, 二垒有人, 三垒有人] }
export function resolveOutcome(fl, fp, st, laDeg) {
  if (fl.hr) return { kind: 'HR', bases: 4, text: '本垒打' };
  if (fl.grd) return { kind: 'HIT', bases: 2, text: '场地规则二垒安打', outfield: true };
  const infielder = INFIELD.includes(fp.who);
  if (fp.caught) {
    const text = laDeg < 12 ? '平直球接杀' : infielder ? '内场飞球接杀' : '飞球接杀';
    const deep = !infielder && Math.hypot(fp.point.x, fp.point.z) > 66;
    return { kind: 'FLY', bases: 0, text, sac: deep && st.on[2] && st.outs < 2 };
  }
  // 击球员跑到第 k 个垒包所需时间
  const tb = (k) => 4.3 + (k - 1) * 3.9;
  if (infielder) {
    const own = fp.who === '1B';
    const tFirst = own
      ? fp.t + 0.3 + dist(fp.point, BASES[1]) / 6.3
      : fp.t + 0.55 + dist(fp.point, BASES[1]) / 38;
    if (tFirst < tb(1)) {
      const dp = st.on[0] && st.outs < 2 && !own && fp.who !== 'C' && tFirst + 0.9 < tb(1) && fp.t < 2.2;
      if (dp) {
        const tSecond = fp.t + 0.5 + dist(fp.point, BASES[2]) / 36;
        return { kind: 'DP', bases: 0, text: '双杀打', tFirst: tSecond + 0.45 + 27.4 / 38, tSecond, own: false };
      }
      return { kind: 'GROUND', bases: 0, text: '地滚球出局', tFirst, own };
    }
    return { kind: 'HIT', bases: 1, text: '内场安打', outfield: false };
  }
  // 外场安打：能在球传到之前多跑几个垒
  let n = 1;
  const ballTo = (k) => fp.t + 0.75 + dist(fp.point, BASES[k % 4]) / 35;
  while (n < 3 && tb(n + 1) + 0.25 < ballTo(n + 1)) n++;
  return { kind: 'HIT', bases: n, text: ['', '一垒安打', '二垒安打', '三垒安打'][n], outfield: true };
}

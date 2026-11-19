// 把每队的助威曲（src/data.js 的 cheer.tune）编成乐谱，用真实乐器采样音色算成音档。
// 需要：brew install fluidsynth、ffmpeg，以及 tools/soundfont/GeneralUser-GS.sf2（免费音色库，不进版控）
// 运行：node scripts/gen_cheer.mjs [队伍 id…]　　产出：public/audio/cheer/<id>.m4a
//
// 一轮 18 小节：主旋律 8 小节 → 再一遍（加拍手、更热闹）8 小节 → 鼓加拍手 2 小节（游戏在这里叠上「安打、安打、本垒打」的喊声）
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAMS } from '../src/data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SF = join(ROOT, 'tools', 'soundfont', 'GeneralUser-GS.sf2');
const OUT = join(ROOT, 'public', 'audio', 'cheer');
if (!existsSync(SF)) {
  console.error('找不到音色库：' + SF);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const BARS = 18;
const PPQ = 480;
const H = PPQ / 2; // 半拍
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// 固定乱数：同一首歌每次算出来都一样
function rng(seed) {
  let h = seed >>> 0;
  return () => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// 编曲（实况野球式的热血助威曲）：
//   小喇叭两支齐奏主旋律、长号低八度；铜管合奏照「三、三、二」的切分节奏垫和弦，低音号跟着同样的节奏走根音；
//   鼓是有推进感的打法（大鼓切分、小鼓二四拍、小钹八分音符），乐句尾用小鼓和筒鼓过门。
//   第二遍加上拍手、开钹和铜管合奏叠主旋律，越来越热闹；最后两小节只剩鼓和拍手，留给全场喊声。
function buildSong(team, idx) {
  const { root, minor, tune, chords } = team.cheer;
  const rnd = rng(idx * 7919 + 13);
  const base = Math.round(69 + 12 * Math.log2(root / 440)); // 主音的 MIDI 音高
  const scale = minor ? MINOR : MAJOR;
  const deg = (d) => base + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7); // 第 d 个音（0＝主音，可以是负的）
  // 旋律：[开始的半拍, 长度（半拍）, 音高]
  const toks = tune.replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
  const mel = [];
  for (let k = 0; k < 64; k++) {
    const m = /^(#?)([1-7])([',]*)$/.exec(toks[k]);
    if (!m) continue;
    let len = 1;
    while (k + len < 64 && toks[k + len] === '-') len++;
    const oct = [...m[3]].reduce((a, c) => a + (c === "'" ? 1 : -1), 0);
    mel.push([k, len, deg(+m[2] - 1 + 7 * oct) + (m[1] ? 1 : 0)]);
  }
  const ev = []; // [tick, 字节…]
  const note = (ch, tick, dur, pitch, vel) => {
    const t = Math.max(0, Math.round(tick));
    ev.push([t, 0x90 | ch, pitch, Math.max(1, Math.min(127, Math.round(vel)))]);
    ev.push([t + Math.max(20, Math.round(dur)), 0x80 | ch, pitch, 0]);
  };
  const prog = (ch, p, vol, pan, rev = 40) => ev.push([0, 0xc0 | ch, p], [0, 0xb0 | ch, 7, vol], [0, 0xb0 | ch, 10, pan], [0, 0xb0 | ch, 91, rev]);
  prog(0, 56, 122, 54); // 小喇叭一
  prog(1, 56, 112, 76); // 小喇叭二（略晚、略走音，像两个人吹）
  prog(2, 57, 104, 42); // 长号（低八度）
  prog(3, 61, 92, 64); // 铜管合奏：和弦
  prog(6, 58, 116, 60, 20); // 低音号：根音
  prog(7, 61, 100, 70); // 铜管合奏：第二遍叠主旋律
  ev.push([0, 0xe1, 0x10, 0x41]); // 小喇叭二音高往上偏一点
  const D = 9; // 击球乐声道
  ev.push([0, 0xb0 | D, 7, 120], [0, 0xb0 | D, 91, 26]);
  const hit = (tick, key, vel) => note(D, tick + (rnd() - 0.5) * 8, 60, key, vel * (0.93 + rnd() * 0.1));

  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * 8 * H;
    const inBar = bar % 8;
    const second = bar >= 8 && bar < 16;
    if (bar >= 16) {
      // 助威段：「咚、咚、咚咚咚」加拍手
      for (const [x, v] of [[0, 124], [2, 116], [4, 120], [5, 108], [6, 122]]) {
        hit(t0 + x * H, 36, v);
        hit(t0 + x * H, 41, v - 10);
        hit(t0 + x * H, 39, v - 14);
      }
      if (bar === 17) [6.5, 7, 7.25, 7.5, 7.75].forEach((x, i) => hit(t0 + x * H, 38, 86 + i * 8)); // 回到开头前的过门
      if (bar === 16) hit(t0, 49, 108);
      continue;
    }
    const gap = inBar === 3 || inBar === 7; // 乐句句尾：后半小节旋律休止
    // 鼓
    for (let e = 0; e < 8; e++) {
      if (gap && e >= 4) break;
      const t = t0 + e * H;
      if (e === 0 || e === 3 || e === 5) hit(t, 36, e === 0 ? 124 : 108);
      if (e === 2 || e === 6) hit(t, 38, 112);
      hit(t, second && e % 2 === 1 ? 46 : 42, e % 2 === 0 ? 70 : 54);
      if (second && (e === 2 || e === 6)) hit(t, 39, 102);
    }
    if (gap) {
      const t = t0 + 4 * H;
      [0, 0.5, 1, 1.5].forEach((x, i) => hit(t + x * H, 38, 88 + i * 8)); // 小鼓连打
      hit(t + 2 * H, 48, 112);
      hit(t + 2.5 * H, 45, 112);
      hit(t + 3 * H, 41, 118);
      hit(t + 3.5 * H, 36, 118);
      hit(t, 39, 110); // 两下拍手：全场「嘿！嘿！」的位置
      hit(t + 2 * H, 39, 114);
      if (inBar === 7) note(D, t + 3 * H, 180, 72, 90); // 哨音带进下一段
    }
    if (inBar === 0 || inBar === 4) hit(t0, 49, inBar === 0 ? 110 : 92); // 钹
    // 和弦与低音：三、三、二的切分（半拍 0、3、6）
    for (let half = 0; half < 2; half++) {
      const r = chords[inBar * 2 + half];
      for (const e of half === 0 ? [0, 3] : [6]) {
        if (gap && e >= 4) continue;
        const t = t0 + e * H;
        const long = e === 0 ? 2.4 : 1.6;
        for (const d of [r, r + 2, r + 4]) {
          let p = deg(d);
          while (p > 67) p -= 12; // 和弦压在中音域，不跟主旋律抢
          while (p < 55) p += 12;
          note(3, t + rnd() * 6, long * H * 0.7, p, e === 0 ? 86 : 76);
        }
        let bass = deg(r) - 24;
        while (bass < 34) bass += 12;
        while (bass > 46) bass -= 12;
        note(6, t, long * H * 0.8, bass, e === 0 ? 112 : 100);
      }
      if (gap && half === 1) note(6, t0 + 4 * H, 3.6 * H, Math.max(34, deg(chords[inBar * 2]) - 24), 96); // 句尾低音拉长
    }
  }
  // 旋律两遍
  for (let pass = 0; pass < 2; pass++) {
    for (const [k, len, p] of mel) {
      const a = (pass * 64 + k) * H;
      const off = k % 2 === 1; // 落在反拍上的音（切分）加重一点
      const acc = (k % 8 === 0 ? 8 : 0) + (off && len > 1 ? 8 : 0);
      const dur = len * H * (len > 1 ? 0.9 : 0.62);
      note(0, a + (rnd() - 0.5) * 8, dur, p, 110 + acc);
      note(1, a + 5 + rnd() * 12, dur, p, 102 + acc);
      note(2, a + (rnd() - 0.5) * 10, dur, p - 12, 98 + acc);
      if (pass === 1) note(7, a + rnd() * 8, dur, p, 92 + acc);
    }
  }
  return ev;
}

// 写成单轨 MIDI 档
function midiBytes(ev, bpm) {
  ev.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0)); // 同一时间先放音符结束
  const vlq = (n) => {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  };
  const us = Math.round(60000000 / bpm);
  const trk = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
  let last = 0;
  for (const [t, ...bytes] of ev) {
    trk.push(...vlq(t - last), ...bytes);
    last = t;
  }
  trk.push(0, 0xff, 0x2f, 0);
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return Buffer.from([...Buffer.from('MThd'), ...u32(6), 0, 0, 0, 1, PPQ >> 8, PPQ & 255, ...Buffer.from('MTrk'), ...u32(trk.length), ...trk]);
}

function render(team, idx, dst) {
  const bpm = team.cheer.bpm;
  writeFileSync(`${tmp}.mid`, midiBytes(buildSong(team, idx), bpm));
  execFileSync('fluidsynth', ['-ni', '-g', '0.8', '-r', '44100', '-F', `${tmp}.wav`, SF, `${tmp}.mid`], { stdio: 'ignore' });
  // 后制：压缩让音量稳定、稍微提亮，尾音保留 1.2 秒（游戏接下一轮时会叠在一起，所以不会断）
  const len = (BARS * 4 * 60) / bpm + 1.2;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${tmp}.wav`, '-t', String(len),
    '-af', 'highpass=f=50,acompressor=threshold=-18dB:ratio=3:attack=8:release=120:makeup=4,equalizer=f=3500:t=q:w=1.2:g=2,alimiter=limit=0.92',
    '-ar', '44100', '-ac', '2', '-c:a', 'aac', '-b:a', '112k', dst]);
}

const args = process.argv.slice(2);
const tmp = join(tmpdir(), `cheer-${process.pid}`);
try {
  TEAMS.forEach((team, i) => {
    if (args.length && !args.includes(team.id)) return;
    render(team, i, join(OUT, `${team.id}.m4a`));
    console.log(team.id, '完成');
  });
} finally {
  for (const ext of ['.mid', '.wav']) if (existsSync(tmp + ext)) rmSync(tmp + ext);
}

// 合成音效（不需要音档）。第一次点击或按键后才会启动。
// 按键：M 全部静音、B 助威团开关、V 转播语音开关
let ctx = null;
let master = null;
let noiseBuf = null;
let crowdBus = null; // 观众声（底噪、欢呼、助威）都走这里，播报时整个压低
let voiceBus = null; // 转播语音
const MUTE_KEY = 'island.muted';
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1'; // 记住上次的静音选择
} catch (e) {
  /* 读不到就当作没静音 */
}

function init() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
  crowdBus = ctx.createGain();
  crowdBus.connect(master);
  // 语音再过一道压缩，音量才会稳稳盖在现场声上面
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.12;
  voiceBus = ctx.createGain();
  voiceBus.gain.value = 1.5;
  voiceBus.connect(comp).connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // 场内人声底噪
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 650;
  f.Q.value = 0.5;
  const g = ctx.createGain();
  g.gain.value = 0.035;
  src.connect(f).connect(g).connect(crowdBus);
  src.start();
}

function noise({ dur, type = 'bandpass', freq, freqEnd, q = 1, gain, attack = 0.004, dest = null }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest || master);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

function tone({ dur, freq, freqEnd, gain, type = 'triangle' }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  // 击球声（原创合成）：q 越高越扎实。三层叠起来：
  //   1. 极短的高频爆音＝球棒碰到球的那一下
  //   2. 几个不成整数倍的高音＝金属般清脆的「锵」，打得越扎实越亮、余音越长
  //   3. 低频的一下「咚」＝力道感
  // 擦棒或打不扎实（q 低）时，高音少、声音短而闷
  hit(q = 0.7) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    noise({ dur: 0.035 + q * 0.02, type: 'highpass', freq: 2600 + q * 2600, gain: 0.55 + q * 0.6, attack: 0.001 });
    noise({ dur: 0.09, type: 'bandpass', freq: 1500 + q * 900, q: 1.2, gain: 0.25 + q * 0.2, attack: 0.002 });
    const ring = 0.1 + q * q * 0.42; // 余音长度
    const base = 1650 + q * 520;
    [[1, 0.5], [1.52, 0.34], [2.31, 0.24], [3.42, 0.14], [4.63, 0.08]].forEach(([mul, amp], i) => {
      if (i > 1 + q * 4) return; // 打不扎实就没有上面那几个泛音
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * mul * (1 + (Math.random() - 0.5) * 0.012), t);
      o.frequency.exponentialRampToValueAtTime(base * mul * 0.985, t + ring);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp * (0.25 + q * 0.5), t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ring / (1 + i * 0.35));
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + ring + 0.05);
    });
    tone({ dur: 0.07, freq: 240 + q * 60, freqEnd: 110, gain: 0.3 + q * 0.35, type: 'sine' });
  },
  pop() {
    noise({ dur: 0.08, type: 'lowpass', freq: 900, gain: 0.5 });
  },
  swing() {
    noise({ dur: 0.16, freq: 380, freqEnd: 1300, q: 1.6, gain: 0.22, attack: 0.03 });
  },
  call(strike) {
    tone({ dur: 0.13, freq: strike ? 560 : 380, freqEnd: strike ? 700 : 330, gain: 0.1, type: 'square' });
  },
  cheer(level = 0.6) {
    noise({ dur: 1.4 + level * 1.8, freq: 900, freqEnd: 1300, q: 0.5, gain: 0.1 + level * 0.3, attack: 0.25, dest: crowdBus });
  },
};

// ── 助威：助威曲是预先算好的音档；鼓、拍手、哨音、群众喊声是即时合成（安打时的连打、助威段的喊声用） ──
let bandOn = true;
let bandGain = null;
let bandTimer = null;

function drum(t, strong) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(strong ? 120 : 150, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(strong ? 0.9 : 0.55, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(bandGain);
  o.start(t);
  o.stop(t + 0.25);
}

// 群众的一声呼喊：只用噪音塑形、不带音高（带音高的振荡器听起来像机器）。
// 两个共振峰让它有一点「喔」「嘿」的感觉，每次的频率和长度都略有不同
function shout(t, dur, level = 1) {
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  n.loop = true;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.55 * level, t + 0.05);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const [f, q, amp] of [[620 + Math.random() * 120, 2.2, 1], [1250 + Math.random() * 250, 2.6, 0.5]]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f, t);
    bp.frequency.linearRampToValueAtTime(f * 0.86, t + dur);
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = amp;
    n.connect(bp).connect(g).connect(out);
  }
  out.connect(bandGain);
  n.start(t, Math.random() * 1.5);
  n.stop(t + dur + 0.05);
}

// 拍手：很短的高频噪音，三下叠在一起、时间略为错开，听起来像一群人
function clap(t, level = 1) {
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.011 + Math.random() * 0.006;
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500 + Math.random() * 900;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, tt);
    g.gain.exponentialRampToValueAtTime(0.5 * level, tt + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.07);
    n.connect(bp).connect(g).connect(bandGain);
    n.start(tt, Math.random() * 1.5);
    n.stop(tt + 0.1);
  }
}

// 哨音：高音正弦波加一点颤音
function whistle(t, dur = 0.22) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(2350, t);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 34;
  const lg = ctx.createGain();
  lg.gain.value = 90;
  lfo.connect(lg).connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bandGain);
  o.start(t);
  lfo.start(t);
  o.stop(t + dur + 0.03);
  lfo.stop(t + dur + 0.03);
}

// ── 助威曲：每队一首，用真实乐器采样音色预先算好的音档（scripts/gen_cheer.mjs）──
// 一轮 18 小节（72 拍）：主旋律 8 小节 → 再一遍 8 小节 → 鼓加拍手 2 小节，这 2 小节由这里叠上「安打、安打、本垒打」的喊声。
// 音档带一点尾音，下一轮照拍子准时接上（两轮的头尾会叠在一起），所以循环不会断
let songBeat = 60 / 164; // 一拍的长度，换歌时依那首歌的速度更新
const songs = new Map(); // 文件名 → { buf, lead }；lead＝音档开头到第一个声音的空白（编码器加的）
let songFile = null;
let songNext = 0; // 下一轮开始的时间
let songSources = [];

async function loadSong(file) {
  if (songs.has(file)) return songs.get(file);
  const entry = { buf: null, lead: 0 };
  songs.set(file, entry);
  try {
    const buf = await ctx.decodeAudioData(await (await fetch(file)).arrayBuffer());
    const d = buf.getChannelData(0);
    let k = 0;
    while (k < d.length && Math.abs(d[k]) < 0.02) k++;
    entry.lead = Math.min(0.2, k / buf.sampleRate);
    entry.buf = buf;
  } catch (e) {
    /* 载不到就没有助威曲，其余音效照常 */
  }
  return entry;
}

function stopSong() {
  const t = ctx.currentTime;
  songSources.forEach(({ src, g }) => {
    g.gain.setTargetAtTime(0, t, 0.12);
    try {
      src.stop(t + 0.6);
    } catch (e) {
      /* 已经播完 */
    }
  });
  songSources = [];
}

// 热度（0～1）：得点圈有人、两好球、比赛后段、比数接近时由游戏调高，助威越大声、喊声越多
let bandHeat = 0;
let burstUntil = 0;
const bandLevel = () => 0.3 + bandHeat * 0.16;

function bandTick() {
  if (!ctx || !bandGain || !songFile) return;
  const song = songs.get(songFile);
  if (!song || !song.buf) return;
  const now = ctx.currentTime;
  if (songNext < now - 0.05) songNext = now + 0.15; // 刚换歌或分页被暂停过：从头开始
  while (songNext < now + 0.4) {
    const t = songNext;
    const src = ctx.createBufferSource();
    src.buffer = song.buf;
    const g = ctx.createGain();
    src.connect(g).connect(bandGain);
    src.start(t, song.lead);
    songSources.push({ src, g });
    if (songSources.length > 3) songSources.shift();
    // 最后两小节的喊声
    if (bandOn && !muted) {
      for (let b = 0; b < 8; b++) {
        const bt = t + (64 + b) * songBeat;
        const h = songBeat / 2;
        const k = b % 4;
        if (k < 3) {
          shout(bt, h * 0.9, 1.1);
          shout(bt + h, h * 0.9, 1.1);
        } else {
          shout(bt, songBeat, 1.35);
          if (bandHeat > 0.55) whistle(bt + h);
        }
      }
    }
    songNext += 72 * songBeat;
  }
}

function bandApply() {
  if (!ctx || !bandGain) return;
  const boost = ctx.currentTime < burstUntil ? 1.5 : 1;
  bandGain.gain.setTargetAtTime(band.want && bandOn ? bandLevel() * boost : 0, ctx.currentTime, 0.4);
}

// 游戏进入比赛时调用 band(true)；回到开场或暂停时 band(false)
export function band(on) {
  if (!ctx) {
    band.pending = on;
    return;
  }
  if (!bandGain) {
    bandGain = ctx.createGain();
    bandGain.gain.value = 0;
    bandGain.connect(crowdBus);
    if (songFile) loadSong(songFile);
    bandTimer = setInterval(bandTick, 80);
  }
  band.want = on;
  bandApply();
}
// 换成这支球队的助威曲（从头开始）
band.song = (c) => {
  if (!c || !c.file || c.file === songFile) return;
  songFile = c.file;
  songBeat = 60 / (c.bpm || 164);
  if (!ctx) return;
  stopSong();
  songNext = 0;
  loadSong(c.file);
};
band.heat = (v) => {
  bandHeat = Math.min(1, Math.max(0, v));
  bandApply();
};
// 安打、本垒打的那一刻：一串连打的鼓、哨音，接着几秒内助威更大声
band.burst = (big) => {
  if (!ctx || !bandGain || !bandOn || muted || !band.want) return;
  const t = ctx.currentTime + 0.05;
  const n = big ? 12 : 6;
  for (let i = 0; i < n; i++) drum(t + i * 0.085, i % 3 === 0);
  whistle(t + n * 0.085, 0.3);
  if (big) whistle(t + n * 0.085 + 0.4, 0.5);
  for (let i = 0; i < (big ? 4 : 2); i++) shout(t + n * 0.085 + i * 0.32, 0.3, 1.3);
  burstUntil = ctx.currentTime + (big ? 7 : 4);
  bandApply();
  setTimeout(bandApply, (big ? 7 : 4) * 1000 + 50);
};

// ── 转播语音：用浏览器内置的语音合成念中文（音质取决于电脑安装的语音） ──
let voiceOn = true;
let voice = null;
let voiceUntil = 0; // 重要播报念完之前，不让好球坏球这种短句插进来
function pickVoice() {
  const vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  // 优先用高品质语音（要在系统设置里另外下载），其次是一般的普通话语音；
  // 避开声音比较怪的趣味语音（Eddy、Flo、Grandma 这类）
  const tw = vs.filter((v) => /zh[-_](CN|Hans)/i.test(v.lang));
  const novelty = /Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley/i;
  voice =
    tw.find((v) => /premium|enhanced|高品质|优化|siri/i.test(v.name)) ||
    tw.find((v) => !novelty.test(v.name)) ||
    tw[0] ||
    vs.find((v) => /^zh/i.test(v.lang)) ||
    null;
}
if (window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

/** 从几种说法里随机挑一种，同样的事件不会每次都讲一模一样的话 */
export const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * 念一句播报。important：重要的句子会打断正在念的，并在念完前挡掉不重要的短句。
 * mood：'calm' 平稳的介绍、'excite' 安打或三振时拉高拉快、缺省是一般的播报语气
 */
export function say(text, important = false, mood = '') {
  if (!voiceOn || muted || !window.speechSynthesis || !text) return;
  const now = performance.now();
  if (!important && now < voiceUntil) return;
  if (important) window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice ? voice.lang : 'zh-CN';
  u.rate = mood === 'excite' ? 1.32 : mood === 'calm' ? 1.08 : important ? 1.18 : 1.3;
  u.pitch = mood === 'excite' ? 1.28 : mood === 'calm' ? 0.98 : 1.05;
  u.volume = 0.95;
  if (important) voiceUntil = now + 500 + text.length * 190;
  window.speechSynthesis.speak(u);
}

// ── 预录的转播语音（scripts/gen_voice.mjs 产生）。每句播报由几个片段的音档接起来 ──
const clips = new Map(); // 片段文本 → AudioBuffer
let voiceLoading = false;
let voiceReady = false; // 音档全部加载完（或确定加载失败）
let voiceEnd = 0; // 目前这句播到什么时候（AudioContext 的时间）
let voiceSources = [];
export const voiceStatus = { total: 0, loaded: 0, played: 0, fallback: 0 }; // 检查用

async function loadVoice() {
  if (voiceLoading || !ctx) return;
  voiceLoading = true;
  try {
    const manifest = await (await fetch('audio/voice/manifest.json')).json();
    const entries = Object.entries(manifest);
    voiceStatus.total = entries.length;
    let i = 0;
    // 人声不需要很高的采样率：用 24kHz 解码，整句式的音档比较长，这样内存用量少一半
    const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    let dec = ctx;
    try {
      if (Off) dec = new Off(1, 1, 24000);
    } catch (e) {
      dec = ctx;
    }
    const worker = async () => {
      while (i < entries.length) {
        const [text, file] = entries[i++];
        try {
          const buf = await (await fetch(`audio/voice/${file}`)).arrayBuffer();
          clips.set(text, await dec.decodeAudioData(buf));
          voiceStatus.loaded++;
        } catch (e) {
          /* 单一音档加载失败：那一句会退回用系统语音念 */
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } catch (e) {
    /* 没有预录音档时全部退回系统语音 */
  }
  voiceReady = true;
}

/**
 * 播一句转播。parts：片段数组（见 src/commentary.js）。
 * important：重要的句子会打断正在播的；不重要的短句（好球、坏球）遇到正在播报就略过。
 * 片段都有预录音档时播音档，并在播报期间把观众声压低；缺任何一个就退回系统语音。
 */
export function sayParts(parts, important = false, mood = '', tries = 0) {
  parts = parts.filter(Boolean);
  if (!voiceOn || muted || !parts.length) return;
  // 音档还在加载：重要的句子等一下再播（最多等 4 秒），不要急着退回系统语音；不重要的短句直接略过
  if (ctx && voiceLoading && !voiceReady) {
    if (important && tries < 16) setTimeout(() => sayParts(parts, important, mood, tries + 1), 250);
    return;
  }
  if (!ctx || !parts.every((p) => clips.has(p))) {
    voiceStatus.fallback++; // 缺音档就不出声（不再退回系统语音：机器声比没有还糟）
    return;
  }
  const now = ctx.currentTime;
  if (!important && now < voiceEnd) return;
  voiceSources.forEach((src) => {
    try {
      src.stop();
    } catch (e) {
      /* 已经播完 */
    }
  });
  voiceSources = [];
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  let t = now + 0.03;
  const t0 = t;
  for (const p of parts) {
    const buf = clips.get(p);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(voiceBus);
    src.start(t);
    voiceSources.push(src);
    t += buf.duration + (/[！。？，]$/.test(p) ? 0.11 : 0.035); // 句尾有标点就多停一下
  }
  voiceEnd = t;
  voiceStatus.played++;
  // 播报时把观众声压低，讲完再慢慢放回来
  crowdBus.gain.cancelScheduledValues(now);
  crowdBus.gain.setTargetAtTime(0.3, t0, 0.06);
  crowdBus.gain.setTargetAtTime(1, t + 0.1, 0.4);
}

// 静音：关掉所有声音（音效、观众、助威、转播），并记住选择
const muteListeners = [];
export const isMuted = () => muted;
export function onMute(fn) {
  muteListeners.push(fn);
  fn(muted);
}
export function setMuted(on) {
  muted = !!on;
  if (master) master.gain.value = muted ? 0 : 0.5;
  if (muted) {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    voiceSources.forEach((src) => {
      try {
        src.stop();
      } catch (e) {
        /* 已经播完 */
      }
    });
    voiceSources = [];
  }
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch (e) {
    /* 存不了就算了 */
  }
  muteListeners.forEach((fn) => fn(muted));
}

export function initAudio() {
  // 页面一打开就先创建音频并加载、解码预录语音（浏览器要等用户点击才会真的出声，
  // 但加载和解码可以先做），这样第一句播报就是预录的
  init();
  loadVoice();
  const kick = () => {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    loadVoice();
    if (ctx && band.pending !== undefined) {
      const want = band.pending;
      band.pending = undefined;
      band(want);
    }
  };
  window.addEventListener('pointerdown', kick);
  window.addEventListener('keydown', (e) => {
    kick();
    if (e.key === 'm' || e.key === 'M') setMuted(!muted);
    if (e.key === 'b' || e.key === 'B') {
      bandOn = !bandOn;
      band(!!band.want);
    }
    if (e.key === 'v' || e.key === 'V') {
      voiceOn = !voiceOn;
      if (!voiceOn) {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        voiceSources.forEach((src) => {
          try {
            src.stop();
          } catch (err) {
            /* 已经播完 */
          }
        });
      }
    }
  });
}

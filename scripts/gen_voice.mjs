// 预录转播语音：把 src/commentary.js 列出的每个片段，用神经网络语音（大陆的体育播报男声）念成音档，再用 ffmpeg 做广播后制。
// 需要先装好 edge-tts：python3 -m venv .venv-tts && .venv-tts/bin/pip install edge-tts
// 运行：node scripts/gen_voice.mjs          （已存在的音档会跳过；加 --force 全部重做）
// 产出：public/audio/voice/<哈希>.m4a 与 manifest.json（片段文本 → 文件名）
// 一次只跑一个子进程，跑完就结束，不会留下背景进程。在线服务偶尔会回空档，会自动重试。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME } from '../src/data.js';
import { allFragments, moodOf } from '../src/commentary.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'audio', 'voice');
const VOICE = process.env.VOICE || 'zh-CN-YunjianNeural';
const TTS = process.env.EDGE_TTS || join(ROOT, '.venv-tts', 'bin', 'edge-tts');
if (!existsSync(TTS)) {
  console.error('找不到 .venv-tts/bin/edge-tts，请先依档头说明安装');
  process.exit(1);
}
const FORCE = process.argv.includes('--force');
mkdirSync(OUT, { recursive: true });

// 语气：[语速, 音高]。hr＝本垒打的呐喊，excite＝激动，calm＝开场的稳重口吻
const MOOD = { hr: ['+30%', '+24Hz'], excite: ['+24%', '+12Hz'], calm: ['+12%', '+2Hz'], '': ['+16%', '+3Hz'] };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// 念一句存成文件；服务回空档或出错就等一下重试
function speak(text, mood, file) {
  const [rate, pitch] = MOOD[mood];
  for (let i = 0; i < 12; i++) {
    try {
      execFileSync(TTS, ['--voice', VOICE, `--rate=${rate}`, `--pitch=${pitch}`, '--text', text, '--write-media', file], { stdio: 'ignore', timeout: 60000 });
      if (existsSync(file) && statSync(file).size > 2000) return true;
    } catch (e) {
      /* 重试 */
    }
    sleep(1500 + i * 500);
  }
  return false;
}

// 广播后制：切掉头尾空白 → 滤掉低频轰声与过高频 → 压低闷的中低频、提亮人声与齿音 → 压缩让音量稳定 → 限幅
const FILTER = [
  'silenceremove=start_periods=1:start_threshold=-48dB',
  'areverse', 'silenceremove=start_periods=1:start_threshold=-48dB', 'areverse',
  'highpass=f=110', 'lowpass=f=9500',
  'equalizer=f=240:t=q:w=1:g=-3', 'equalizer=f=3200:t=q:w=1.2:g=5', 'equalizer=f=6500:t=q:w=1.5:g=2',
  'acompressor=threshold=-22dB:ratio=5:attack=4:release=90:makeup=5',
  'alimiter=limit=0.9',
  'afade=t=in:d=0.006',
].join(',');

const { all, intro } = allFragments(GAME);
const manifest = {};
let made = 0;
const tmp = join(tmpdir(), `voice-${process.pid}.mp3`);
const failed = [];
try {
  for (const text of all) {
    const file = `${createHash('sha1').update(`${VOICE}|${text}`).digest('hex').slice(0, 12)}.m4a`;
    manifest[text] = file;
    const dst = join(OUT, file);
    if (existsSync(dst) && !FORCE) continue;
    if (!speak(text, moodOf(text, intro), tmp)) {
      failed.push(text);
      delete manifest[text]; // 没录到的句子不列入，游戏会退回系统语音，下次重跑再补
      continue;
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af', FILTER, '-ar', '44100', '-ac', '1', '-c:a', 'aac', '-b:a', '72k', dst]);
    made++;
    if (made % 20 === 0) console.log(`已完成 ${made} 个`);
  }
} finally {
  if (existsSync(tmp)) rmSync(tmp);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 0));
console.log(`片段 ${all.length} 个，新产生 ${made} 个，失败 ${failed.length} 个，语音 ${VOICE}`);
if (failed.length) console.log('失败的句子：\n' + failed.join('\n'));

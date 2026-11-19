// 用 codex exec 内置的 image_gen 画各队的故事主视觉（选队对决画面用）。一次一张，已存在的会跳过。
// Codex 的沙箱可能是唯读：只请它生图，图存在 ~/.codex/generated_images/，这里再取回来转成 JPEG。
// 运行：node scripts/gen_art.mjs [队伍 id…]　　产出：public/teams/art/<id>.jpg（1024×1024）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { style, items } = JSON.parse(readFileSync(join(ROOT, 'scripts', 'art_manifest.json'), 'utf8'));
const OUT = join(ROOT, 'public', 'teams', 'art');
mkdirSync(OUT, { recursive: true });
const GEN = join(homedir(), '.codex', 'generated_images');
function newestSince(since) {
  let best = null;
  if (!existsSync(GEN)) return null;
  for (const dir of readdirSync(GEN)) {
    const d = join(GEN, dir);
    if (!statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.png')) continue;
      const m = statSync(join(d, f)).mtimeMs;
      if (m >= since && (!best || m > best.m)) best = { m, path: join(d, f) };
    }
  }
  return best && best.path;
}
const only = process.argv.slice(2);
for (const it of items) {
  if (only.length && !only.includes(it.id)) continue;
  const out = join(OUT, `${it.id}.jpg`);
  if (existsSync(out)) continue;
  const since = Date.now() - 1000;
  const prompt = `请用内置 image_gen 工具产一张正方形（宽高比 1:1）的插画，只要生图、不需要处理文件。主题：${style}${it.prompt}生成后回报 OK 即可。`;
  try {
    execFileSync('codex', ['exec', '--skip-git-repo-check', prompt], { stdio: 'ignore', timeout: 300000 });
  } catch (e) {
    /* 逾时或失败：下面找不到新图就记成失败，重跑时再补 */
  }
  const src = newestSince(since);
  if (src) execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '86', '-Z', '1024', src, '--out', out], { stdio: 'ignore' });
  console.log(it.id, existsSync(out) ? '完成' : '失败');
}

// 用 codex exec 内置的 image_gen 产生各队队徽。一次只跑一张，已存在的会跳过（可中断续跑）。
// 运行：node scripts/gen_emblems.mjs　　产出：public/teams/<id>.png（512×512）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { style, items } = JSON.parse(readFileSync(join(ROOT, 'scripts', 'emblem_manifest.json'), 'utf8'));
// Codex 的沙箱可能是唯读，没办法自己把图放到项目里：只请它生图，图会存在 ~/.codex/generated_images/<工作阶段>/，
// 这里再把这次新产生的那张拷贝过来并缩成 512×512
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
for (const it of items) {
  const out = join(ROOT, 'public', 'teams', `${it.id}.png`);
  if (existsSync(out)) continue;
  const since = Date.now() - 1000;
  const prompt = `请用内置 image_gen 工具产一张 1024x1024 的正方形 PNG，只要生图、不需要拷贝或处理文件。主题：${style}${it.prompt}生成后回报 OK 即可。`;
  try {
    execFileSync('codex', ['exec', '--skip-git-repo-check', prompt], { stdio: 'ignore', timeout: 300000 });
  } catch (e) {
    /* 逾时或失败：下面找不到新图就会记成失败，重跑时再补 */
  }
  const src = newestSince(since);
  if (src) {
    copyFileSync(src, out);
    execFileSync('sips', ['-z', '512', '512', out], { stdio: 'ignore' });
  }
  console.log(it.id, existsSync(out) ? '完成' : '失败');
}

// 用 codex exec 内置的 image_gen 画赛后画面的插画（每队赢球、输球各一张，加一张平局）。一次一张，已存在的会跳过。
// 运行：node scripts/gen_result.mjs [id…]　　产出：public/teams/result/<id>.jpg（宽 1280）
// 图从这次 Codex 工作阶段自己的文件夹取回（~/.codex/generated_images/<session id>/），不会拿错别的图。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { style, items } = JSON.parse(readFileSync(join(ROOT, 'scripts', 'result_manifest.json'), 'utf8'));
const OUT = join(ROOT, 'public', 'teams', 'result');
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
for (const it of items) {
  if (only.length && !only.some((o) => it.id === o || it.id.startsWith(o))) continue;
  const out = join(OUT, `${it.id}.jpg`);
  if (existsSync(out)) continue;
  const prompt = `请用内置 image_gen 工具产一张横式（宽高比 16:9）的插画，只要生图、不需要处理文件。主题：${style}${it.prompt}生成后回报 OK 即可。`;
  const run = spawnSync('codex', ['exec', '--skip-git-repo-check', prompt], { encoding: 'utf8', timeout: 300000 });
  const id = (/session id:\s*([0-9a-f-]+)/.exec(`${run.stdout || ''}${run.stderr || ''}`) || [])[1];
  const dir = id && join(homedir(), '.codex', 'generated_images', id);
  const png = dir && existsSync(dir) && readdirSync(dir).find((f) => f.endsWith('.png'));
  if (png) execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '84', '-Z', '1280', join(dir, png), '--out', out], { stdio: 'ignore' });
  console.log(it.id, existsSync(out) ? '完成' : '失败');
}

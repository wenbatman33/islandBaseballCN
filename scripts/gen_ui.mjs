// 用 codex exec 内置的 image_gen 画接口素材，再把纯绿色背景去掉、裁掉四周空白，存成透明 PNG。
// 运行：node scripts/gen_ui.mjs [素材 id…]　　产出：public/ui/<id>.webp（缩到实际需要的大小；已存在的会跳过），原始大图留在 art/ui_master/<id>.png
// 图从这次 Codex 工作阶段自己的文件夹取回（~/.codex/generated_images/<session id>/），不会拿错别的图。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { style, items } = JSON.parse(readFileSync(join(ROOT, 'scripts', 'ui_manifest.json'), 'utf8'));
const OUT = join(ROOT, 'public', 'ui');
const MASTER = join(ROOT, 'art', 'ui_master');
mkdirSync(OUT, { recursive: true });
mkdirSync(MASTER, { recursive: true });
// 各素材在画面上实际需要的最大边长（像素）；没列的用 760
const SIZE = { panel: 400, panel_gold: 400, btn_main: 360, stick_base: 360, stick_knob: 240, card: 520, board: 820, ribbon: 820, vs: 720, playball: 720 };
// 去背：绿色比红蓝多出越多越透明；边缘的绿色溢色压回去
const KEY = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
out = []
for r, g, b in im.getdata():
    key = g - max(r, b)
    a = 255 if key <= 40 else 0 if key >= 110 else int(255 * (1 - (key - 40) / 70))
    if key > 0:
        g = max(r, b) + (0 if key > 40 else int(key * (1 - key / 40)))
    out.append((r, g, b, a))
img = Image.new('RGBA', im.size)
img.putdata(out)
img = img.crop(img.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox())
img.save(sys.argv[2])
m = int(sys.argv[4])
img.thumbnail((m, m), Image.LANCZOS)
img.save(sys.argv[3], 'WEBP', quality=88, method=6)
print(img.size)
`;
const FORCE = process.argv.includes('--force'); // 加 --force：指定的素材即使已存在也重画
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const it of items) {
  if (only.length && !only.includes(it.id)) continue;
  const out = join(OUT, `${it.id}.webp`);
  if (existsSync(out) && !FORCE) continue;
  const prompt = `请用内置 image_gen 工具产一张${it.shape}的图，只要生图、不需要处理文件。主题：${style}这张要画的是：${it.prompt}生成后回报 OK 即可。`;
  const run = spawnSync('codex', ['exec', '--skip-git-repo-check', prompt], { encoding: 'utf8', timeout: 300000 });
  const id = (/session id:\s*([0-9a-f-]+)/.exec(`${run.stdout || ''}${run.stderr || ''}`) || [])[1];
  const dir = id && join(homedir(), '.codex', 'generated_images', id);
  const png = dir && existsSync(dir) && readdirSync(dir).find((f) => f.endsWith('.png'));
  if (png) execFileSync('python3', ['-W', 'ignore', '-c', KEY, join(dir, png), join(MASTER, `${it.id}.png`), out, String(SIZE[it.id] || 760)], { stdio: 'inherit' });
  console.log(it.id, png ? '完成' : '失败');
}

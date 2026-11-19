// 用 codex exec 内置的 image_gen 画 App 图标（PWA、加到主画面用），再缩成各种尺寸。
// 运行：node scripts/gen_icon.mjs　　产出：public/icons/icon-512.png、icon-192.png、apple-touch-icon.png、favicon-32.png，原图留在 art/ui_master/icon.png
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const prompt = '请用内置 image_gen 工具产一张正方形（宽高比 1:1）的图，只要生图、不需要处理文件。主题：一款热血卡通棒球游戏的 App 图标，日本运动游戏等级的专业游戏美术，亮面立体、厚涂质感。画面：满版的深蓝色背景带金黄色的放射状光芒（背景要铺满整张正方形，四个角落也是深蓝色，不要留白、不要圆角、不要边框），正中央是一颗带红色缝线的白色棒球，拖着红橘色的火焰从左下冲向右上，棒球周围有金色星芒与火花，棒球下方有两支交叉的金色球棒。主体集中在画面中央的七成范围内（四周留空间，图标会被裁成圆形或圆角）。配色只用深蓝、金黄、红、橘、白。不要任何文本、字母或数字。生成后回报 OK 即可。';
const run = spawnSync('codex', ['exec', '--skip-git-repo-check', prompt], { encoding: 'utf8', timeout: 300000 });
const id = (/session id:\s*([0-9a-f-]+)/.exec(`${run.stdout || ''}${run.stderr || ''}`) || [])[1];
const dir = id && join(homedir(), '.codex', 'generated_images', id);
const png = dir && existsSync(dir) && readdirSync(dir).find((f) => f.endsWith('.png'));
if (!png) {
  console.log('失败：找不到生成的图');
  process.exit(1);
}
mkdirSync(join(ROOT, 'art', 'ui_master'), { recursive: true });
mkdirSync(join(ROOT, 'public', 'icons'), { recursive: true });
const master = join(ROOT, 'art', 'ui_master', 'icon.png');
copyFileSync(join(dir, png), master);
for (const [name, size] of [['icon-512', 512], ['icon-192', 192], ['apple-touch-icon', 180], ['favicon-32', 32]]) {
  execFileSync('sips', ['-z', String(size), String(size), master, '--out', join(ROOT, 'public', 'icons', `${name}.png`)], { stdio: 'ignore' });
}
console.log('完成', master);

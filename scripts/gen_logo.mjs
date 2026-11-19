// 用 codex exec 内置的 image_gen 画游戏标志，再把纯绿色背景去掉存成透明 PNG。
// 运行：node scripts/gen_logo.mjs [输出文件名=logo]　　产出：public/<文件名>.webp（原始大图留在 art/ui_master/）
// 图是从这次 Codex 工作阶段自己的文件夹取回（~/.codex/generated_images/<session id>/），不会拿错别的图。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || 'logo';
mkdirSync(join(ROOT, 'art', 'ui_master'), { recursive: true });
const prompt = `请用内置 image_gen 工具产一张横式（宽高比 3:2）的图，只要生图、不需要处理文件。主题：一款热血卡通棒球游戏的标题标志（game title logo），日本运动游戏标题等级的专业设计。标志的主体是四个简体中文大字（中国大陆规范汉字，不要写成繁体字）「岛屿职棒」，四个字必须完全正确、清楚、由左到右排成一行：第一个字「岛」、第二个字「屿」（山字旁加与）、第三个字「职」、第四个字「棒」。字体是粗壮有力、向右上倾斜的立体美术字，白色到金黄色的渐层字面，深蓝色的粗外框，再一层红色的立体厚度与阴影，字的边缘有速度感的切角。字的后方有一颗带红色缝线、拖着火焰与速度线的棒球从左下冲向右上，下方有一条红色缎带，缎带上是英文小字「ISLAND LEAGUE BASEBALL」。整体配色只用白、金黄、红、橘、深蓝，不要使用任何绿色。标志置中、四周留一点空间，背景是完全均匀的纯绿色 #00FF00（去背用），背景不要有任何渐层、阴影或其他图案。生成后回报 OK 即可。`;
// 工作阶段编号印在错误输出，所以两个输出都要收
const run = spawnSync('codex', ['exec', '--skip-git-repo-check', prompt], { encoding: 'utf8', timeout: 300000 });
const log = `${run.stdout || ''}${run.stderr || ''}`;
const id = (/session id:\s*([0-9a-f-]+)/.exec(log) || [])[1];
const dir = id && join(homedir(), '.codex', 'generated_images', id);
const png = dir && existsSync(dir) && readdirSync(dir).find((f) => f.endsWith('.png'));
if (!png) {
  console.log('失败：找不到生成的图');
  process.exit(1);
}
// 去掉绿色背景（含边缘的绿色溢色），裁掉四周空白
execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
out = []
for r, g, b in im.getdata():
    key = g - max(r, b)                       # 绿色比红蓝多出多少
    if key <= 40:
        a = 255
    elif key >= 110:
        a = 0
    else:
        a = int(255 * (1 - (key - 40) / 70))
    if key > 0:
        g = max(r, b) + (0 if key > 40 else int(key * (1 - key / 40)))  # 边缘的绿色溢色压回去
    out.append((r, g, b, a))
img = Image.new('RGBA', im.size)
img.putdata(out)
box = img.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
img = img.crop(box)
img.save(sys.argv[3])
img.thumbnail((1000, 1000), Image.LANCZOS)
img.save(sys.argv[2], 'WEBP', quality=88, method=6)
print(img.size)
`, join(dir, png), join(ROOT, 'public', `${name}.webp`), join(ROOT, 'art', 'ui_master', `${name}.png`)], { stdio: 'inherit' });
console.log('完成', join(dir, png));

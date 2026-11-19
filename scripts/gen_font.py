# 做出游戏自带的中文字体：从完整的 Noto Sans SC（可变字重）里只留下游戏实际用到的字，存成一个 woff2。
# 这样不需要连到 Google Fonts（中国大陆连不上），文件也很小；一个文件涵盖 100–900 所有粗细。
# 运行：python3 scripts/gen_font.py <NotoSansSC[wght].ttf 的路径>
#   需要先安装：pip install fonttools brotli
#   原始字体下载：https://github.com/google/fonts/tree/main/ofl/notosanssc （SIL Open Font License）
# 产出：src/fonts/noto-sans-sc-subset.woff2
# 注意：游戏里新增了中文字（改文案、加球员姓名等）之后要重跑一次，否则新字会退回系统字体。
import glob, os, sys
from fontTools import subset

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SOURCES = ['src/*.js', 'src/*.css', '*.html', 'public/manifest.webmanifest']

chars = set(chr(c) for c in range(0x20, 0x7F))  # 英数与基本符号
for pattern in SOURCES:
    for path in glob.glob(os.path.join(ROOT, pattern)):
        chars.update(ch for ch in open(path, encoding='utf8').read() if ord(ch) > 0x7F and ch.isprintable())

out = os.path.join(ROOT, 'src', 'fonts', 'noto-sans-sc-subset.woff2')
os.makedirs(os.path.dirname(out), exist_ok=True)
opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['*']
opts.notdef_outline = True
font = subset.load_font(sys.argv[1], opts)
sub = subset.Subsetter(opts)
sub.populate(text=''.join(sorted(chars)))
sub.subset(font)
cmap = font.getBestCmap()
missing = sorted(ch for ch in chars if ord(ch) not in cmap)
subset.save_font(font, out, opts)
print(f'用到 {len(chars)} 个字符，字体收录 {len(cmap)} 个，输出 {os.path.getsize(out) // 1024} KB')
if missing:
    print('字体里没有的字符（会退回系统字体）：', ''.join(missing))

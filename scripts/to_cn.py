# 把项目里的繁体中文（台湾用语）转成简体中文（中国大陆用语）：先换棒球术语，再用 OpenCC 转字与一般用语。
# 运行：python3 scripts/to_cn.py <文件…>（直接改写文件；已经是简体的文件再跑一次不会变）
import sys, re
import opencc

# 棒球术语：台湾说法 → 大陆说法（这张表必须保持繁体，所以不要拿这个脚本转它自己）。长的词排前面
TERMS = [
    ('全壘打', '本壘打'), ('指定打擊', '指定擊球員'), ('捕手', '接手'),
    ('外野', '外場'), ('內野', '內場'),
    ('滾地球', '地滾球'), ('滾地', '地滾'), ('平飛球', '平直球'), ('平飛', '平直'),
    ('好球帶', '好球區'), ('打者', '擊球員'), ('跑者', '跑壘員'),
    ('防禦率', '自責分率'), ('先發', '首發'),
    ('守備員', '防守隊員'), ('守備', '防守'),
    ('應援', '助威'), ('主審', '主裁'), ('平手', '平局'),
]
KEEP = ['打擊率', "bar('打擊'", '打擊人員']  # 这几处的「打擊」不改成「擊球」
cc = opencc.OpenCC('tw2sp')

def convert(text):
    for a, b in TERMS:
        text = text.replace(a, b)
    for i, k in enumerate(KEEP):
        text = text.replace(k, f'\x00{i}\x00')
    text = text.replace('打擊', '擊球')
    for i, k in enumerate(KEEP):
        text = text.replace(f'\x00{i}\x00', k)
    return cc.convert(text)

if __name__ == '__main__':
    for path in sys.argv[1:]:
        src = open(path, encoding='utf8').read()
        out = convert(src)
        if out != src:
            open(path, 'w', encoding='utf8').write(out)
            print('已转换', path)

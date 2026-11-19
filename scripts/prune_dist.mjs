// 建置后从 dist 拿掉不该部署的文件：候选素材预览图（含第三方商品截屏）与烘焙用的中间贴图。
// 只会动 dist 这个建置输出文件夹，不会碰源文件。
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST = resolve('dist');
let removed = 0;
function drop(path) {
  const full = resolve(path);
  if (!full.startsWith(DIST + '/') || !existsSync(full)) return; // 保险：只允许删 dist 底下的东西
  rmSync(full, { recursive: statSync(full).isDirectory() });
  removed++;
}
drop(join(DIST, 'models', '_候选预览'));
const players = join(DIST, 'models', 'player');
if (existsSync(players)) for (const f of readdirSync(players)) if (f.endsWith('_tex.png')) drop(join(players, f));
// 球员模型：只部署游戏正在用的那一个（旧版模型留在本机的 public 里，但不上线）
const PLAYER_MODEL = 'player_v7.glb';
if (existsSync(players)) for (const f of readdirSync(players)) if (f.endsWith('.glb') && f !== PLAYER_MODEL) drop(join(players, f));
// 转播语音：只部署目前句库用到的音档（换过语音或改过句子后留下的旧音档不带上线）
const voice = join(DIST, 'audio', 'voice');
if (existsSync(join(voice, 'manifest.json'))) {
  const used = new Set(Object.values(JSON.parse(readFileSync(join(voice, 'manifest.json'), 'utf8'))));
  for (const f of readdirSync(voice)) if (f.endsWith('.m4a') && !used.has(f)) drop(join(voice, f));
}
// 试用模型（public/lab）：只部署游戏会用到的（缺省的四个角色、?model=meshy 的防守队员、?model=real 的写实球员），其余是测试页的中间档
const lab = join(DIST, 'lab');
const LAB_KEEP = new Set(['tripo_batter.glb', 'tripo_fielder.glb', 'tripo_catcher.glb', 'tripo_umpire.glb', 'chibi_batter.glb', 'chibi_fielder.glb', 'chibi_catcher.glb', 'chibi_umpire.glb', 'batter_pro_game.glb']);
if (existsSync(lab)) for (const f of readdirSync(lab)) if (f.endsWith('.glb') && !LAB_KEEP.has(f)) drop(join(lab, f));
// 助威曲试听用的音档（cheer-test.html）不部署
drop(join(DIST, 'audio', 'cheer', 'samples'));
console.log(`已从 dist 移除 ${removed} 项不部署的文件`);

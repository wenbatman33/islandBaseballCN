// 只播大场面：三振、安打、本垒打、得分、比赛结束。
// 开场介绍、击球员上场介绍、换局、好球坏球界外、出局数、一般出局都不出声（画面字卡与音效照旧）。
// 转播句库：每一句播报由一到几个「片段」组成，每个片段对应一个预录音档。
// 片段尽量是完整的一句（击球员介绍、三振、换局都是一句到底），听起来才像主播在讲，不是一个词一个词拼的。
// 游戏（播放）和 scripts/gen_voice.mjs（预录）共用这一份，两边才会一致。
// 这个档不可以用到浏览器专属的东西，因为预录脚本是在 Node 里加载它。

import { TEAMS } from './data.js';

export const POS_NAME = {
  P: '投手', C: '接手', '1B': '一垒手', '2B': '二垒手', '3B': '三垒手', SS: '游击手',
  LF: '左外场手', CF: '中外场手', RF: '右外场手', DH: '指定击球员',
};
const NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const SWING = ['挥棒落空！', '出棒，没有碰到！', '挥空！被这颗球骗到了。'];
const STRIKE = ['好球！', '好球进垒。', '站着看，好球！', '漂亮的一球，好球。'];
const K_GENERIC = ['三振出局！', '投手拿下这次三振！'];
const HIT_PRE = ['打出去了！', '这球打得很扎实！', '咬中了！'];
const HR_CALL = ['这球很高、很远！', '出去啦！本垒打！'];
const GOOD_RESULTS = new Set(['场地规则二垒安打', '内场安打', '一垒安打', '二垒安打', '三垒安打', '高飞牺牲打']);
const RBI = (n) => `${NUM[Math.min(4, n)]}分打点！`;
const WALK_RUN = (n) => `挤回${NUM[Math.min(4, n)]}分！`;

const WIN = (team) => `比赛结束！${team}，拿下今天的胜利！`;
const TIE = '比赛结束，双方握手言和，以平局收场。';

// ── 每一种播报（回传片段数组；空数组＝不出声）──
export const line = {
  ball: () => [],
  swing: () => [],
  strike: () => [],
  foul: () => [],
  strikeout: () => [pick(K_GENERIC)],
  walk: (runs) => (runs ? [WALK_RUN(runs)] : []), // 保送本身不播，挤回分数才播
  change: () => [],
  result(name, text, good, runs) {
    const parts = [];
    // 不念球员姓名：八队八十位球员，句子越短越干净
    if (text === '本垒打') parts.push(HR_CALL[0], HR_CALL[1]);
    else if (good) parts.push(pick(HIT_PRE), `${text}${GOOD_RESULTS.has(text) ? '！' : '。'}`);
    if (runs) parts.push(RBI(runs));
    return parts;
  },
  batter: () => [],
  gameOver: (winner) => [winner ? WIN(winner) : TIE],
};

// ── 开场介绍（每段一整句）──
// 已停用：回传空对象，开场镜头照常跑，只是没有旁白
export function introLines() {
  return {};
}

// 语气：预录时用。hr＝本垒打的呐喊；excite＝激动（音调拉高、语速加快）；calm＝开场的稳重口吻
const HR_SET = new Set(HR_CALL);
const FLAT = new Set([...STRIKE, ...SWING]); // 好球、挥空虽然有惊叹号，但只是一般的判决，不用喊
export function moodOf(text, introSet) {
  if (HR_SET.has(text)) return 'hr';
  if (introSet && introSet.has(text)) return 'calm';
  if (text.startsWith('三出局，攻守交替')) return '';
  if (text.endsWith('！') && !FLAT.has(text)) return 'excite';
  return '';
}

/** 列出所有可能用到的片段（预录脚本用） */
export function allFragments() {
  const out = new Set();
  const add = (...xs) => xs.flat().forEach((x) => x && out.add(x));
  add(K_GENERIC, HIT_PRE, HR_CALL, TIE);
  add([...GOOD_RESULTS].map((r) => `${r}！`));
  for (let n = 1; n <= 4; n++) add(RBI(n), WALK_RUN(n));
  for (const t of TEAMS) add(WIN(t.name));
  return { all: [...out], intro: new Set() };
}

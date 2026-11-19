// 开场：标题画面（主视觉插画）→ 对决画面（选自己的球队与对手）→ 开赛。
// 对决画面左格是你的球队（主队、后攻）、右格是对手（客队），两格各放那一队的故事插画。
// 下方选队：先点「你的球队」或「对手」决定要换哪一边，再点球队。
// 网址带 ?home=<id>&away=<id> 会直接开赛、两个画面都不显示（测试或分享链接用）。
import { TEAMS, emblemHTML } from './data.js';

const KEY = 'island.matchup';

function titleScreen() {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'title-screen';
    el.innerHTML = `
      <img class="tt-art" src="title.webp" alt="">
      <i class="tt-flare"></i><i class="tt-dust"></i><i class="tt-shade"></i>
      <div class="tt-logo">
        <img class="tt-mark" src="logo.webp" alt="岛屿职棒 ISLAND LEAGUE BASEBALL">
        <span class="tt-year">2026　例行赛开打</span>
      </div>
      <button class="tt-start">点一下开始<small>PRESS START</small></button>`;
    document.body.appendChild(el);
    const go = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 450);
      resolve();
    };
    el.addEventListener('click', go, { once: true });
    window.addEventListener('keydown', function onKey(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      window.removeEventListener('keydown', onKey);
      if (el.isConnected && !el.classList.contains('out')) go();
    });
  });
}

function versusScreen() {
  const has = (id) => TEAMS.some((t) => t.id === id);
  let last = {};
  try {
    last = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch (e) {
    /* 没有上次的选择 */
  }
  return new Promise((resolve) => {
    const pick = { home: has(last.home) ? last.home : 'leopards', away: has(last.away) ? last.away : 'whales' };
    if (pick.home === pick.away) pick.away = TEAMS.find((t) => t.id !== pick.home).id;
    let side = 'home'; // 现在点球队会换掉哪一边
    const team = (id) => TEAMS.find((t) => t.id === id);
    const el = document.createElement('div');
    el.id = 'team-select';
    el.innerHTML = `
      <div class="vs-panel you" data-side="home"><div class="vs-art"><img alt=""></div></div>
      <div class="vs-panel foe" data-side="away"><div class="vs-art"><img alt=""></div></div>
      <header class="vs-top"><span class="vs-title">选择对战组合</span></header>
      <section class="vs-side you" data-side="home"></section>
      <section class="vs-side foe" data-side="away"></section>
      <div class="vs-mark"><img src="ui/vs.webp" alt="VS"></div>
      <div class="vs-dock">
        <div class="vs-cmp"><span class="vs-cmp-title">战力对决</span><div class="vs-rows"></div></div>
        <footer class="vs-foot">
          <div class="vs-tabs"><button data-side="home">你的球队</button><button data-side="away">对手</button></div>
          <div class="vs-chips"></div>
          <button class="vs-go"><img src="ui/playball.webp" alt="PLAY BALL"><small>开赛</small></button>
        </footer>
      </div>`;
    document.body.appendChild(el);

    // 每一队的信息收成一块名牌：队徽、身分、队名、战绩与整体评价；台词贴在名牌下面
    const sideHTML = (t, who) => `
      <div class="vs-plate">
        ${emblemHTML(t, 'big')}
        <div class="vs-plate-txt">
          <span class="vs-role">${who === 'home' ? '你的球队　HOME' : '对手　AWAY'}</span>
          <h2>${t.name}</h2>
          <div class="vs-meta"><span>${t.record}</span><i>OVR<b>${t.ovr}</b></i></div>
        </div>
      </div>
      <p class="vs-line">「${t.line}」</p>`;
    // 拉锯条：两队在同一条上互推，差距越大推得越过去；交界处有火花。scale＝差多少算压倒性
    const bar = (label, a, b, fa, fb, scale) => {
      const pct = Math.min(86, Math.max(14, 50 + ((a - b) / scale) * 36));
      return `<div class="vs-row"><em class="l ${a >= b ? 'win' : ''}">${fa}</em>
        <div class="vs-tug"><i class="l" style="width:${pct}%"></i><i class="r"></i><u style="left:${pct}%"></u><b>${label}</b></div>
        <em class="r ${b >= a ? 'win' : ''}">${fb}</em></div>`;
    };
    const render = (changed) => {
      const h = team(pick.home);
      const a = team(pick.away);
      el.style.setProperty('--you1', h.c1);
      el.style.setProperty('--you2', h.c2);
      el.style.setProperty('--foe1', a.c1);
      el.style.setProperty('--foe2', a.c2);
      for (const [who, t] of [['home', h], ['away', a]]) {
        const box = el.querySelector(`.vs-side[data-side="${who}"]`);
        if (changed && changed !== 'both' && changed !== who && box.innerHTML) continue; // 没换的那一边不重播进场动画
        box.innerHTML = sideHTML(t, who);
        const img = el.querySelector(`.vs-panel[data-side="${who}"] img`);
        img.src = t.art;
        img.classList.remove('in');
        void img.offsetWidth;
        img.classList.add('in');
      }
      el.querySelectorAll('.vs-side, .vs-panel').forEach((s) => s.classList.toggle('on', s.dataset.side === side));
      el.querySelector('.vs-rows').innerHTML =
        bar('整体', h.ovr, a.ovr, h.ovr, a.ovr, 10) +
        bar('打击', +h.teamAvg, +a.teamAvg, h.teamAvg, a.teamAvg, 0.02) +
        bar('王牌', h.sp.ovr, a.sp.ovr, h.sp.ovr, a.sp.ovr, 10);
      el.querySelectorAll('.vs-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.side === side));
      el.querySelector('.vs-chips').innerHTML = TEAMS.map((t) => {
        const cls = t.id === pick.home ? 'you' : t.id === pick.away ? 'foe' : '';
        return `<button class="vs-chip ${cls}" data-id="${t.id}" style="--c1:${t.c1};--c2:${t.c2}"><span class="vs-chip-win">${emblemHTML(t)}<em>${t.record.replace(' 胜 ', '-').replace(' 败', '')}</em></span><b>${t.short}</b></button>`;
      }).join('');
      if (changed) {
        // VS 再撞一次
        const m = el.querySelector('.vs-mark');
        m.classList.remove('hit');
        void m.offsetWidth;
        m.classList.add('hit');
      }
    };
    el.addEventListener('click', (e) => {
      const chip = e.target.closest('.vs-chip');
      if (chip) {
        const id = chip.dataset.id;
        const other = side === 'home' ? 'away' : 'home';
        if (pick[side] === id) return;
        let changed = side;
        if (pick[other] === id) {
          pick[other] = pick[side]; // 点到另一边的球队：两边对调
          changed = 'both';
        }
        pick[side] = id;
        render(changed);
        return;
      }
      if (e.target.closest('.vs-go')) {
        try {
          localStorage.setItem(KEY, JSON.stringify(pick));
        } catch (err) {
          /* 存不了就算了 */
        }
        el.classList.add('out');
        setTimeout(() => el.remove(), 380);
        resolve(pick);
        return;
      }
      const s = e.target.closest('[data-side]');
      if (s) {
        side = s.dataset.side;
        render();
      }
    });
    render();
    el.querySelector('.vs-mark').classList.add('hit');
  });
}

export async function chooseTeams() {
  const q = new URLSearchParams(location.search);
  const has = (id) => TEAMS.some((t) => t.id === id);
  if (has(q.get('home')) || has(q.get('away'))) return { home: q.get('home'), away: q.get('away') };
  await titleScreen();
  return versusScreen();
}

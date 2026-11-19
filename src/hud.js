import { emblemHTML } from './data.js';

// 比赛画面的 HUD：记分条、投手信息、击球员信息卡（由比赛状态即时更新）
export function buildHud(root) {
  root.insertAdjacentHTML(
    'beforeend',
    // 外面多包两层：电脑与手机横向时这两层不占版面（display: contents），三块各自定位；
    // 手机直式时变成顶端的一整块面板（上排记分、下排击球员对投手）
    `<div class="hud-top">
       <div class="scorebug" data-lay="scorebug"></div>
       <div class="hud-duel">
         <div class="batter-card" data-lay="batterCard"></div>
         <i class="hud-vs">VS</i>
         <div class="pitcher-chip" data-lay="pitcherChip"></div>
       </div>
     </div>`,
  );
  const elBug = root.querySelector('.scorebug');
  const elPit = root.querySelector('.pitcher-chip');
  const elBat = root.querySelector('.batter-card');
  const chip = (t) => emblemHTML(t, 'sm');
  const dots = (n, on) => Array.from({ length: n }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('');

  function render({ S, away, home, batter, batTeam, order, today, pitcher, fldTeam, pitchCount, lastPitch, energy = 100, rattle = 0 }) {
    elBug.innerHTML = `
      <div class="sb-teams">
        <div class="sb-team ${S.half === 0 ? 'bat' : ''}">${chip(away)}<b>${away.short}</b><em>${S.score[0]}</em></div>
        <div class="sb-team ${S.half === 1 ? 'bat' : ''}">${chip(home)}<b>${home.short}</b><em>${S.score[1]}</em></div>
      </div>
      <div class="sb-inn"><span>${S.half === 0 ? '▲' : '▼'}</span><b>${S.inning}</b><small>局</small></div>
      <div class="sb-bases"><i class="b2 ${S.bases[1] ? 'on' : ''}"></i><i class="b3 ${S.bases[2] ? 'on' : ''}"></i><i class="b1 ${S.bases[0] ? 'on' : ''}"></i></div>
      <div class="sb-count">
        <div><span>B</span>${dots(3, S.balls)}</div>
        <div><span>S</span>${dots(2, S.strikes)}</div>
        <div><span>O</span>${dots(2, S.outs)}</div>
      </div>`;

    // 投手信息：名字下面一条体力条（一半以下变橘、四分之一以下变红），混乱时整块摇晃发紫光。状态不写成文本，主要看投手本人的动作
    const en = Math.round(energy);
    elPit.classList.toggle('rattled', !!rattle);
    elPit.innerHTML = `
      <span class="face sm" style="--c1:${fldTeam.c1};--c2:${fldTeam.c2}"><img src="${pitcher.face}" alt=""></span>
      <div class="pc-main"><small>投手 · ${pitcher.hand}</small><b>${pitcher.name}</b>
        <span class="pc-en ${en < 25 ? 'low' : en < 50 ? 'mid' : ''}" title="体力 ${en}"><u><s style="width:${en}%"></s></u></span></div>
      <div class="pc-num"><b>${pitchCount}</b><small>球数</small></div>
      <div class="pc-last">${lastPitch || '—'}</div>`;

    elBat.style.visibility = batter ? 'visible' : 'hidden';
    if (batter) {
      elBat.innerHTML = `
        <span class="face lg" style="--c1:${batTeam.c1};--c2:${batTeam.c2}"><img src="${batter.face}" alt=""><i>${batter.no}</i></span>
        <div class="bc-name">
          <small>NOW BATTING · 第 ${order} 棒</small>
          <b>${batter.name}</b>
          <span>${batter.pos} · ${batter.bats}打 · ${batTeam.name}</span>
        </div>
        <div class="bc-stat"><small>打击率</small><b>${batter.avg}</b></div>
        <div class="bc-stat"><small>本垒打</small><b>${batter.hr}</b></div>
        <div class="bc-stat"><small>打点</small><b>${batter.rbi}</b></div>
        <div class="bc-stat today"><small>今日</small><b>${today.ab}-${today.h}</b></div>`;
    }
  }
  return { render };
}

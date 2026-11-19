import { emblemHTML } from './data.js';

import { PITCHES } from './data.js';

// 玩法相关的画面组件：球种菜单、操作提示、判决文本、结果横幅、终场画面
// 判决文本 → 美术字素材
const CALL_ART = { 好球: 'call_strike', 坏球: 'call_ball', 挥棒落空: 'call_swing', 界外球: 'call_foul', 三振: 'call_k', 保送: 'call_bb', 安全上垒: 'call_safe', 出局: 'call_out', 本垒打: 'call_hr', 投手乱了: 'call_rattled' };

export function buildGameUI(root) {
  root.insertAdjacentHTML(
    'beforeend',
    `<div class="tc-stick" data-lay="stick"><i></i></div>
     <button type="button" class="tc-main" data-lay="mainBtn"></button>
     <div class="pitch-menu" data-lay="pitchMenu"></div>
     <button type="button" class="pen-btn" data-lay="penBtn"></button>
     <div class="bullpen"></div>
     <div class="hint" data-lay="hint"></div>
     <div class="bat-help"></div>
     <div class="swing-fb"></div>
     <div class="swing-now">挥！</div>
     <div class="pitch-info" data-lay="pitchInfo"></div>
     <div class="call" id="call"></div>
     <div class="banner" data-lay="banner"><small></small><b></b><span></span></div>
     <div class="final" id="final"></div>`,
  );
  const elMenu = root.querySelector('.pitch-menu');
  const elHint = root.querySelector('.hint');
  const elHelp = root.querySelector('.bat-help');
  const elFb = root.querySelector('.swing-fb');
  const elNow = root.querySelector('.swing-now');
  const elInfo = root.querySelector('.pitch-info');
  const elCall = root.querySelector('.call');
  const elBanner = root.querySelector('.banner');
  const elFinal = root.querySelector('.final');
  const dip = document.getElementById('dip');
  let pick = () => {};
  const elPen = root.querySelector('.pen-btn');
  const elBullpen = root.querySelector('.bullpen');
  let penOpen = () => {};
  let penPick = () => {};
  elPen.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('dev-drag')) return;
    e.preventDefault();
    penOpen();
  });
  elBullpen.addEventListener('click', (e) => {
    const c = e.target.closest('[data-k]');
    if (c) penPick(c.dataset.k === 'x' ? null : +c.dataset.k);
  });
  // ── 触摸操作（手机）：左下摇杆瞄准、右下主按钮。网址加 ?touch=1 可在电脑上强制打开来测试 ──
  const touchParam = new URLSearchParams(location.search).get('touch');
  const touch = touchParam === '1' || (touchParam !== '0' && matchMedia('(pointer: coarse)').matches);
  document.body.classList.toggle('touch', touch);
  const elStick = root.querySelector('.tc-stick');
  const elKnob = elStick.querySelector('i');
  const elMain = root.querySelector('.tc-main');
  const stick = { x: 0, y: 0, id: null };
  let mainPress = () => {};
  const dragging = () => document.body.classList.contains('dev-drag'); // DEV 拖曳版面时不当成操作
  function stickMove(e) {
    const r = elStick.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R;
    let dy = (e.clientY - (r.top + R)) / R;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      dx /= d;
      dy /= d;
    }
    stick.x = dx;
    stick.y = -dy; // 往上推是正的
    elKnob.style.translate = `${dx * 30}% ${dy * 30}%`;
  }
  function stickEnd(e) {
    if (e.pointerId !== stick.id) return;
    stick.id = null;
    stick.x = stick.y = 0;
    elKnob.style.translate = '0 0';
  }
  elStick.addEventListener('pointerdown', (e) => {
    if (dragging()) return;
    e.preventDefault();
    stick.id = e.pointerId;
    elStick.setPointerCapture(e.pointerId);
    stickMove(e);
  });
  elStick.addEventListener('pointermove', (e) => e.pointerId === stick.id && stickMove(e));
  elStick.addEventListener('pointerup', stickEnd);
  elStick.addEventListener('pointercancel', stickEnd);
  elMain.addEventListener('pointerdown', (e) => {
    if (dragging()) return;
    e.preventDefault();
    mainPress();
  });
  let bannerTimer = 0;
  let callTimer = 0;
  let infoTimer = 0;

  const retrigger = (el, cls) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  elMenu.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('[data-i]');
    if (row) pick(+row.dataset.i);
  });

  return {
    onPitchPick(fn) {
      pick = fn;
    },
    onPenOpen(fn) {
      penOpen = fn;
    },
    // 「换投手」按钮：n＝牛棚还有几个人（0＝不显示）
    penButton(n) {
      const show = n > 0;
      if (elPen.classList.contains('show') !== show) elPen.classList.toggle('show', show);
      if (show && elPen.dataset.n !== String(n)) {
        elPen.dataset.n = n;
        elPen.innerHTML = `换投手<small>牛棚 ${n} 人${touch ? '' : '　按 P'}</small>`;
      }
    },
    // 牛棚菜单：list 为 null 时关闭。cur＝目前投手的状态（显示他还剩多少体力）
    bullpen(list, cur, cb) {
      elBullpen.classList.toggle('show', !!list);
      if (!list) return;
      penPick = cb;
      const pct = Math.round(cur.energy);
      elBullpen.innerHTML = `
        <div class="bp-box">
          <img class="seg-head" src="ui/head_bullpen.webp" alt="更换投手" onerror="this.remove()">
          <div class="bp-cur">目前投手　<b>${cur.p.name}</b><span class="bp-en ${pct < 25 ? 'low' : pct < 50 ? 'mid' : ''}"><u><s style="width:${pct}%"></s></u>体力 ${pct}</span>${cur.rattle ? '<i>混乱中</i>' : ''}</div>
          <div class="bp-list">${list.map((p, i) => `
            <button type="button" class="bp-card" data-k="${i}">
              <span class="face lg"><img src="${p.face}" alt=""><i>${p.no}</i></span>
              <b>${p.name}</b>
              <small>${p.hand}　OVR <em>${p.ovr}</em></small>
              <dl><div><dt>体力</dt><dd>${p.stamina}</dd></div><div><dt>控球</dt><dd>${p.control}</dd></div><div><dt>球威</dt><dd>${p.stuff}</dd></div><div><dt>最快</dt><dd>${p.maxKmh}</dd></div></dl>
              <span class="bp-pitches">${p.pitches.map(([n, g]) => `<span>${n}<b class="g g-${g}">${g}</b></span>`).join('')}</span>
            </button>`).join('')}</div>
          <button type="button" class="bp-cancel" data-k="x">先不换</button>
        </div>`;
    },
    touch,
    // 摇杆目前的方向（-1～1；没在推是 0）
    stick: () => stick,
    onMainPress(fn) {
      mainPress = fn;
    },
    // 触摸操作的显示与主按钮文本（label 为空字符串＝隐藏）
    touchControls(label) {
      const show = touch && !!label;
      elStick.classList.toggle('show', show);
      elMain.classList.toggle('show', show);
      if (show && elMain.textContent !== label) elMain.textContent = label;
    },
    // list 为 null 时隐藏；maxKmh 有给的话每个球种显示球速
    pitchMenu(list, sel, maxKmh) {
      elMenu.classList.toggle('show', !!list);
      if (!list) return;
      elMenu.innerHTML =
        '<div class="pm-head">球种<span>按 1–4 选择　字母＝拿手程度（A 最强）</span></div>' +
        list
          .map(([name, g], i) => {
            const d = PITCHES[name];
            const tag = d.speed >= 0.95 ? '速球' : Math.abs(d.by) > 0.3 ? '下坠' : '横移';
            const kmh = maxKmh ? `<small>${Math.round(maxKmh * d.speed)} km/h</small>` : '';
            return `<div class="pm-row ${i === sel ? 'on' : ''}" data-i="${i}"><kbd>${i + 1}</kbd><b>${name}</b><em>${tag}</em><i class="g g-${g}">${g}</i>${kmh}</div>`;
          })
          .join('');
    },
    hint(text) {
      elHint.textContent = text;
      elHint.classList.toggle('show', !!text);
    },
    // 击球的操作说明（两个步骤），击球时固定显示
    batHelp(show) {
      if (show && !elHelp.innerHTML) {
        elHelp.innerHTML = `
          <div class="bh-title">你的击球</div>
          <div class="bh-step"><i>1</i><span><b>${touch ? '推左下摇杆' : '移动鼠标'}</b>　把<em class="y">黄圈</em>对准<em class="o">橘色落点</em>，对到会变<em class="g">绿色</em></span></div>
          <div class="bh-step"><i>2</i><span>${touch ? '<b>按右下「挥棒」</b>' : '<b>点击</b> 或 <kbd>空白键</kbd>'}　橘圈缩到最小、变<em class="g">绿色</em>时挥棒</span></div>`;
      }
      elHelp.classList.toggle('show', !!show);
    },
    // 「现在挥！」的提示
    swingNow(on) {
      elNow.classList.toggle('show', !!on);
    },
    // 挥棒后的回馈：时机与位置
    feedback(text, tone) {
      elFb.textContent = text;
      elFb.dataset.tone = tone || '';
      retrigger(elFb, 'show');
    },
    pitchInfo(text) {
      elInfo.textContent = text;
      retrigger(elInfo, 'show');
      clearTimeout(infoTimer);
      infoTimer = setTimeout(() => elInfo.classList.remove('show'), 1800);
    },
    call(text, kind) {
      // 判决用画好的立体美术字（public/ui/call_*.webp）；「二垒出局」这种前面多一个垒名的，垒名用小字放在上面
      const art = CALL_ART[text] || (text.endsWith('出局') ? 'call_out' : null);
      if (art) {
        const pre = art === 'call_out' && text !== '出局' ? `<small>${text.replace('出局', '')}</small>` : '';
        elCall.innerHTML = `${pre}<img src="ui/${art}.webp" alt="${text}">`;
        elCall.querySelector('img').onerror = () => (elCall.textContent = text); // 图载不到就退回文本
      } else elCall.textContent = text;
      elCall.dataset.kind = kind;
      retrigger(elCall, 'show');
      clearTimeout(callTimer);
      callTimer = setTimeout(() => elCall.classList.remove('show'), 1000);
    },
    banner({ kicker, title, sub, good }, sec) {
      elBanner.querySelector('small').textContent = kicker || '';
      elBanner.querySelector('b').textContent = title;
      elBanner.querySelector('span').textContent = sub || '';
      elBanner.classList.toggle('good', !!good);
      elBanner.classList.toggle('hr', title === '本垒打');
      retrigger(elBanner, 'show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => elBanner.classList.remove('show'), sec * 1000);
    },
    dip() {
      retrigger(dip, 'go');
    },
    // 赛后画面：依玩家那一队（user：0 客队、1 主队）赢、输或平局，放那一队的赛后插画、结果的美术字与逐局比分
    final({ S, away, home, user = 1 }) {
      const teams = [away, home];
      const mine = teams[user];
      const d = S.score[user] - S.score[1 - user];
      const outcome = d > 0 ? 'win' : d < 0 ? 'lose' : 'tie';
      const art = outcome === 'tie' ? 'teams/result/tie.webp' : `teams/result/${outcome}_${mine.id}.webp`;
      const word = { win: '胜利！', lose: '惜败', tie: '平局' }[outcome];
      const say = {
        win: `${mine.name}拿下这场胜利！`,
        lose: `${teams[1 - user].name}带走胜利，下一场讨回来。`,
        tie: '双方握手言和，胜负留到下次再分。',
      }[outcome];
      const n = Math.max(S.regulation || 0, S.lines[0].length, S.lines[1].length);
      const cells = (i) => Array.from({ length: n }, (_, k) => `<td>${S.lines[i][k] ?? (k < S.inning ? 0 : '')}</td>`).join('');
      const row = (t, i) => `
        <tr class="${S.score[i] > S.score[1 - i] ? 'win' : ''} ${i === user ? 'me' : ''}">
          <th>${emblemHTML(t)}<b>${t.name}</b>${i === user ? '<i>你</i>' : ''}</th>${cells(i)}<td class="r">${S.score[i]}</td><td>${S.hits[i]}</td>
        </tr>`;
      elFinal.innerHTML = `
        <div class="result ${outcome}" style="--c1:${mine.c1};--c2:${mine.c2}">
          <img class="rs-art" src="${art}" alt="">
          <i class="rs-fx"></i>
          <img class="rs-word" src="ui/result_${outcome}.webp" alt="${word}">
          <div class="rs-board">
            <div class="rs-kicker">FINAL　比赛结束${S.inning > (S.regulation || n) ? `　延长至第 ${S.inning} 局` : ''}</div>
            <table>
              <thead><tr><th></th>${Array.from({ length: n }, (_, k) => `<td>${k + 1}</td>`).join('')}<td class="r">R</td><td>H</td></tr></thead>
              <tbody>${row(away, 0)}${row(home, 1)}</tbody>
            </table>
            <p>${say}</p>
          </div>
          <div class="rs-btns"><button type="button" id="again">再战一场</button><button type="button" id="reselect">重选球队</button></div>
        </div>`;
      // 这一队的赛后插画还没有的话，退回用对决画面那张故事插画
      const img = elFinal.querySelector('.rs-art');
      img.onerror = () => {
        img.onerror = null;
        img.src = mine.art;
      };
      const wordImg = elFinal.querySelector('.rs-word');
      wordImg.onerror = () => wordImg.replaceWith(Object.assign(document.createElement('h2'), { className: 'rs-word', textContent: word }));
      elFinal.classList.add('show');
      const go = (keepTeams) => {
        const q = new URLSearchParams(location.search);
        q.delete('end');
        q.delete('home');
        q.delete('away');
        if (keepTeams) {
          q.set('home', home.id);
          q.set('away', away.id);
        }
        location.search = q.toString();
      };
      elFinal.querySelector('#again').addEventListener('click', () => go(true));
      elFinal.querySelector('#reselect').addEventListener('click', () => go(false));
    },
  };
}

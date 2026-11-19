import * as THREE from 'three';
import { SHOTS } from './tuning.js';
import { grade, emblemHTML } from './data.js';

export const SEGS = [
  { key: 'venue', label: '球场' },
  { key: 'matchup', label: '对战组合' },
  { key: 'lineup', label: '客队打序' },
  { key: 'defense', label: '主队防守' },
  { key: 'pitcher', label: '首发投手' },
];

const emblem = emblemHTML;
// 段落标题的美术字（public/ui/head_*.webp）；图载不到就拿掉，留旁边的小字
const head = (id, alt) => `<img class="seg-head" src="ui/head_${id}.webp" alt="${alt}" onerror="this.remove()">`;
const face = (p, t) =>
  `<span class="face" style="--c1:${t.c1};--c2:${t.c2}"><img src="${p.face}" alt=""></span>`;

// 创建开场各段的 DOM
export function buildIntroDOM(root, tagsRoot, game) {
  const { away, home, venue } = game;

  const venueHtml = `
    <section class="seg seg-venue" data-seg="venue">
      <div class="venue" data-lay="venue">
        <div class="where anim" style="--i:0">${venue.where}</div>
        <h1 class="anim" style="--i:1">${venue.name}</h1>
        <div class="en anim" style="--i:2">${venue.en}</div>
        <dl class="anim" style="--i:3">
          ${venue.stats.map(([k, v, u]) => `<div><dt>${k}</dt><dd>${v}${u ? `<small>${u}</small>` : ''}</dd></div>`).join('')}
        </dl>
      </div>
    </section>`;

  const muTeam = (t) => `
    <div class="mu-team ${t.side.toLowerCase()}" style="--c1:${t.c1};--art:url('/${t.art}')">
      ${emblem(t, 'big')}
      <div class="mu-text">
        <small>${t.side} · ${t.sideTc}</small>
        <b>${t.name}</b>
        <span>${t.record}<em>OVR ${t.ovr}</em></span>
      </div>
    </div>`;
  const matchupHtml = `
    <section class="seg seg-matchup" data-seg="matchup">
      <div class="matchup" data-lay="matchup">
        <div class="mu-head anim" style="--i:0">${head('matchup', '今日对战')}<span>GAME ${game.no}<b>${game.title}</b>${game.time} 开打</span></div>
        <div class="mu-row anim" style="--i:1">
          ${muTeam(away)}
          <div class="mu-vs"><img src="ui/vs.webp" alt="VS"></div>
          ${muTeam(home)}
        </div>
      </div>
    </section>`;

  const lineupHtml = `
    <section class="seg seg-lineup" data-seg="lineup">
      <div class="panel lineup" data-lay="lineup">
        <div class="p-kicker anim" style="--i:0">${head('lineup', '首发打序')}<span>${away.side} · STARTING LINEUP</span></div>
        <div class="p-title anim" style="--i:1">${emblem(away)}<h2>${away.name}</h2></div>
        <div class="p-sub anim" style="--i:2">团队打击率 <b>${away.teamAvg}</b><i></i>OVR <b>${away.ovr}</b></div>
        <ol class="rows">
          <li class="head anim" style="--i:3"><span></span><span>守位</span><span></span><span>球员</span><span>打击率</span><span>本垒打</span><span>OVR</span></li>
          ${away.lineup
            .map(
              (p, i) => `
          <li class="anim" style="--i:${i + 4}">
            <i class="ord">${i + 1}</i>
            <span class="pos">${p.pos}</span>
            ${face(p, away)}
            <span class="nm"><b>${p.name}</b><em>#${p.no} · ${p.bats}打</em></span>
            <span class="st">${p.avg}</span>
            <span class="st">${p.hr}</span>
            <span class="ovr"><u><s style="width:${p.ovr}%"></s></u>${p.ovr}</span>
          </li>`,
            )
            .join('')}
        </ol>
      </div>
    </section>`;

  const dh = home.lineup.find((p) => p.pos === 'DH');
  const defenseHtml = `
    <section class="seg seg-defense" data-seg="defense">
      <div class="panel defense-head" data-lay="defenseHead">
        <div class="p-kicker anim" style="--i:0">${head('defense', '防守阵容')}<span>${home.side} · DEFENSE</span></div>
        <div class="p-title anim" style="--i:1">${emblem(home)}<h2>${home.name}</h2></div>
        <div class="p-sub anim" style="--i:2">指定击球员 <b>${dh.name}</b><i></i>OVR <b>${home.ovr}</b></div>
      </div>
    </section>`;

  const sp = home.sp;
  const bar = (label, v) => `
    <div class="bar"><span>${label}</span><b class="g g-${grade(v)}">${grade(v)}</b><u><s style="width:${v}%"></s></u><em>${v}</em></div>`;
  const pitcherHtml = `
    <section class="seg seg-pitcher" data-seg="pitcher">
      <div class="panel pitcher" data-lay="pitcher">
        <div class="p-kicker anim" style="--i:0">${head('pitcher', '首发投手')}<span>STARTING PITCHER</span></div>
        <div class="pt-top anim" style="--i:1">
          <span class="face xl" style="--c1:${home.c1};--c2:${home.c2}"><img src="${sp.face}" alt=""><i>${sp.no}</i></span>
          <div>
            <h2>${sp.name}</h2>
            <div class="pt-meta">${home.name} · ${sp.hand}</div>
            <div class="pt-ovr">OVR <b>${sp.ovr}</b></div>
          </div>
        </div>
        <div class="pt-stats anim" style="--i:2">
          <div><dt>胜败</dt><dd>${sp.wl}</dd></div>
          <div><dt>自责分率</dt><dd>${sp.era}</dd></div>
          <div><dt>三振</dt><dd>${sp.so}</dd></div>
          <div><dt>WHIP</dt><dd>${sp.whip}</dd></div>
        </div>
        <div class="pt-bars anim" style="--i:3">
          ${bar('体力', sp.stamina)}${bar('控球', sp.control)}${bar('球威', sp.stuff)}
        </div>
        <div class="pt-foot anim" style="--i:4">
          <div class="pt-speed">最快球速<b>${sp.maxKmh}</b><small>KM/H</small></div>
          <div class="pt-pitches">${sp.pitches.map(([n, g]) => `<span>${n}<b class="g g-${g}">${g}</b></span>`).join('')}</div>
        </div>
      </div>
    </section>`;

  const barHtml = `
    <div class="intro-bar" data-lay="introBar">
      <div class="ib-left"><b class="ib-count">1 / ${SEGS.length}</b><span class="ib-label"></span>
        <div class="ib-pips">${SEGS.map(() => '<i></i>').join('')}</div></div>
      <div class="ib-right">
        <button class="ib-next" type="button">下一段<b>5</b></button>
        <button class="ib-skip" type="button">略过</button>
      </div>
    </div>`;

  root.innerHTML = venueHtml + matchupHtml + lineupHtml + defenseHtml + pitcherHtml + barHtml;

  // 防守位置标签（每一格跟着场上球员移动）
  const order = ['CF', 'LF', 'RF', 'SS', '2B', '3B', '1B', 'P', 'C'];
  const byPos = Object.fromEntries(home.lineup.map((p) => [p.pos, p]));
  byPos.P = home.sp;
  tagsRoot.innerHTML = order
    .map((pos, i) => {
      const p = byPos[pos];
      return `<div class="ptag" data-pos="${pos}"><div class="anim" style="--i:${i + 2}"><span>${pos}</span><b>${p.name}</b><em>#${p.no}</em></div></div>`;
    })
    .join('');
}

const lerp = (a, b, t) => a + (b - a) * t;

// 开场导演：管理目前段落、时间与镜头
export function createDirector({ camera, controls, renderer }) {
  let anchors = {};
  const root = document.getElementById('intro');
  const tagsRoot = document.getElementById('tags');
  const flash = document.getElementById('flash');
  const dip = document.getElementById('dip');
  const segEls = [...root.querySelectorAll('.seg')];
  const pips = [...root.querySelectorAll('.ib-pips i')];
  const elCount = root.querySelector('.ib-count');
  const elLabel = root.querySelector('.ib-label');
  const btnNext = root.querySelector('.ib-next');
  const elCd = btnNext.querySelector('b');
  const tagEls = [...tagsRoot.querySelectorAll('.ptag')];

  const st = { mode: 'intro', index: 0, t: 0, paused: false, free: false };
  let liveCam = null; // 比赛进行中由比赛模块控制镜头
  const listeners = [];
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const target = new THREE.Vector3();

  const shotKey = () => (st.mode === 'live' ? 'live' : SEGS[st.index].key);

  function retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function syncUI() {
    document.body.dataset.mode = st.mode;
    document.body.dataset.seg = shotKey();
    segEls.forEach((el, i) => el.classList.toggle('active', st.mode === 'intro' && i === st.index));
    pips.forEach((el, i) => {
      el.classList.toggle('done', i < st.index);
      el.classList.toggle('on', i === st.index);
    });
    if (st.mode === 'intro') {
      elCount.textContent = `${st.index + 1} / ${SEGS.length}`;
      elLabel.textContent = SEGS[st.index].label;
      btnNext.firstChild.textContent = st.index === SEGS.length - 1 ? '开赛' : '下一段';
    }
    listeners.forEach((fn) => fn(st));
  }

  function goto(i) {
    st.mode = 'intro';
    st.index = Math.max(0, Math.min(SEGS.length - 1, i));
    st.t = 0;
    retrigger(dip, 'go');
    syncUI();
  }
  function goLive(withFlash = true) {
    st.mode = 'live';
    st.t = 0;
    if (withFlash) {
      retrigger(flash, 'show');
      setTimeout(() => flash.classList.remove('show'), 1700);
    }
    syncUI();
  }
  function next() {
    if (st.mode !== 'intro') return;
    if (st.index >= SEGS.length - 1) goLive();
    else goto(st.index + 1);
  }

  function applyCamera() {
    const s = SHOTS[shotKey()];
    const k = s.dur > 0 ? Math.min(1, st.t / s.dur) : 1;
    const e = 1 - Math.pow(1 - k, 1.8);
    vA.fromArray(s.from.pos);
    vB.fromArray(s.to.pos);
    camera.position.lerpVectors(vA, vB, e);
    vA.fromArray(s.from.target);
    vB.fromArray(s.to.target);
    target.lerpVectors(vA, vB, e);
    camera.lookAt(target);
    controls.target.copy(target);
    const portrait = camera.aspect < 1;
    camera.fov = Math.min(80, lerp(s.from.fov, s.to.fov, e) * (portrait ? 1.55 : 1));
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // 横式把主体往右推开面板；直式面板在下方，改把主体往上推
    const shift = portrait ? 0 : s.shift || 0;
    const lift = portrait ? s.liftMobile || 0 : 0;
    if (shift || lift) camera.setViewOffset(size.x, size.y, -shift * size.x, lift * size.y, size.x, size.y);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function updateTags() {
    const show = st.mode === 'intro' && SEGS[st.index].key === 'defense';
    tagsRoot.classList.toggle('show', show);
    if (!show) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const el of tagEls) {
      const a = anchors[el.dataset.pos];
      if (!a) continue;
      vA.copy(a.pos).project(camera);
      el.style.transform = `translate(${((vA.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-vA.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    }
  }

  function update(dt) {
    if (!st.free) {
      if (st.mode === 'intro' && !st.paused) {
        st.t += dt;
        const s = SHOTS[shotKey()];
        elCd.textContent = String(Math.max(1, Math.ceil(s.dur - st.t)));
        if (st.t >= s.dur) next();
      }
      if (st.mode === 'live' && liveCam) liveCam(dt);
      else applyCamera();
    }
    camera.updateMatrixWorld();
    updateTags();
  }

  function setFree(v) {
    st.free = v;
    controls.enabled = v;
    if (v) {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    document.body.classList.toggle('free-cam', v);
    syncUI();
  }

  btnNext.addEventListener('click', next);
  root.querySelector('.ib-skip').addEventListener('click', () => goLive());
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (st.mode !== 'intro') return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      next();
    } else if (e.key === 'Escape') goLive();
  });

  syncUI();
  return {
    state: st,
    goto,
    goLive,
    next,
    update,
    setFree,
    shotKey,
    setAnchors: (a) => {
      anchors = a;
    },
    setLiveCam: (fn) => {
      liveCam = fn;
    },
    onChange: (fn) => listeners.push(fn),
  };
}

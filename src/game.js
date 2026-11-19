import * as THREE from 'three';
import { FIELD_Y } from './util.js';
import { TUNE, SHOTS } from './tuning.js';
import { PITCHES, GRADE_MUL } from './data.js';
import { makeActor, FIELD_POS, PITCH } from './player3d.js';
import { createArmFx } from './armfx.js';
import { createHbpFx } from './hbpfx.js';
import { flight, fieldPlay, resolveOutcome, BASES, SIM_DT } from './ballsim.js';
import { sfx, sayParts, band } from './audio.js';
import { line } from './commentary.js';
import { createBasePicker } from './basepicker.js';

// 好球区（相对场地高度，单位公尺）
const ZONE = { x: 0.27, y0: 0.48, y1: 1.08 };
const USER = 1; // 玩家操控主队
const MOUND_Y = 0.26;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const gauss = () => {
  let u = 0;
  for (let i = 0; i < 6; i++) u += Math.random();
  return (u - 3) / Math.sqrt(0.5);
};
const power = (p) => clamp(0.88 + (p.ovr - 65) / 120 + p.hr / 100, 0.85, 1.12);
const outsideZone = (T) => {
  const dx = Math.max(0, Math.abs(T.x) - ZONE.x);
  const dy = Math.max(0, ZONE.y0 - T.y, T.y - ZONE.y1);
  return Math.hypot(dx, dy);
};

export function createGame({ scene, camera, canvas, data, hud, ui, scoreboard, director }) {
  const teams = [data.away, data.home];
  const root = new THREE.Group();
  root.position.y = FIELD_Y;
  scene.add(root);

  const hbpFx = createHbpFx(root); // 触身球：击球员被砸到的反应
  const armFx = createArmFx(root); // 投手累了、混乱时的肢体表现与汗滴、星星

  // ── 角色 ──
  const fielders = teams.map((team) => {
    const set = {};
    for (const [pos, [x, z]] of Object.entries(FIELD_POS)) {
      const info = pos === 'P' ? team.sp : team.lineup.find((p) => p.pos === pos);
      const hand = info.hand === '左投' ? -1 : 1;
      const a = makeActor({
        ...team.kit, skin: info.skin, hair: info.hair, no: info.no, name: info.name, look: info.look,
        glove: -hand, gear: pos === 'C' ? 'catcher' : null,
      });
      a.hand = hand;
      a.home = [x, z];
      a.posName = pos;
      a.info = info;
      root.add(a.group);
      set[pos] = a;
    }
    return set;
  });
  const ump = makeActor({ jersey: '#2a2f36', accent: '#15181c', pants: '#4a4f57', skin: '#c98f66', gear: 'ump' });
  ump.group.position.set(0, 0, 2.9);
  ump.group.rotation.y = Math.PI;
  ump.set('ready');
  root.add(ump.group);

  // 开场防守名牌用的位置（主队防守）
  const anchors = {};
  for (const [pos, a] of Object.entries(fielders[USER])) {
    anchors[pos] = { pos: new THREE.Vector3(a.home[0], FIELD_Y + 2.0 + (pos === 'P' ? MOUND_Y : 0), a.home[1]), info: a.info };
  }

  // ── 球与好球区标示 ──
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 12),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.25 }),
  );
  ball.castShadow = true;
  ball.visible = false;
  root.add(ball);

  const flat = (color, opacity) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, fog: false, toneMapped: false });
  const widgets = new THREE.Group();
  widgets.renderOrder = 10;
  root.add(widgets);
  const zc = (ZONE.y0 + ZONE.y1) / 2;
  {
    const pts = [];
    const seg = (x1, y1, x2, y2) => pts.push(x1, y1, 0, x2, y2, 0);
    seg(-ZONE.x, ZONE.y0, ZONE.x, ZONE.y0);
    seg(ZONE.x, ZONE.y0, ZONE.x, ZONE.y1);
    seg(ZONE.x, ZONE.y1, -ZONE.x, ZONE.y1);
    seg(-ZONE.x, ZONE.y1, -ZONE.x, ZONE.y0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const frame = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false, fog: false, toneMapped: false }),
    );
    frame.renderOrder = 10;
    widgets.add(frame);
    const gp = [];
    for (const k of [1 / 3, 2 / 3]) {
      const x = lerp(-ZONE.x, ZONE.x, k);
      const y = lerp(ZONE.y0, ZONE.y1, k);
      gp.push(x, ZONE.y0, 0, x, ZONE.y1, 0, -ZONE.x, y, 0, ZONE.x, y, 0);
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    const grid = new THREE.LineSegments(
      g2,
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthTest: false, fog: false, toneMapped: false }),
    );
    grid.renderOrder = 10;
    widgets.add(grid);
  }
  const mk = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 11;
    widgets.add(m);
    return m;
  };
  const aimMark = mk(new THREE.RingGeometry(0.05, 0.064, 40), flat('#d8ff3e', 1));
  const aimDot = mk(new THREE.CircleGeometry(0.012, 16), flat('#d8ff3e', 1));
  const meterRing = mk(new THREE.RingGeometry(0.057, 0.066, 48), flat('#ffffff', 0.95));
  const pci = mk(new THREE.RingGeometry(0.93, 1, 56), flat('#d8ff3e', 0.95));
  const pciCore = mk(new THREE.RingGeometry(0.024, 0.034, 24), flat('#ffffff', 0.9));
  const ballMark = mk(new THREE.RingGeometry(0.036, 0.058, 40), flat('#ff7a4d', 0.98)); // 落点圈（加粗，会缩小）

  // ── 状态 ──
  const S = {
    inning: 1, half: 0, outs: 0, balls: 0, strikes: 0,
    bases: [null, null, null],
    score: [0, 0], hits: [0, 0], lines: [[0], []],
    batIdx: [0, 0], pitchCount: [0, 0], over: false,
  };
  // ── 投手状态：体力、混乱、牛棚 ──
  // p 目前在投手丘上的人；energy 体力 0～100；rattle 混乱（还要拿几个出局数才会恢复，0＝正常）；
  // streak 连续让几位击球员上垒；pen 还没上场的后援投手
  const arm = teams.map((t) => ({ p: t.sp, energy: 100, rattle: 0, streak: 0, pen: [...(t.rp || [])] }));
  const mound = () => arm[fld()];
  const fatigue = (m) => (m.energy < 50 ? (50 - m.energy) / 50 : 0); // 体力掉到一半以下才开始影响，0～1
  // 扣体力：n＝相当于多投了几球。体力数值高的投手，同样的负担扣得比较少（数值 70 大约可以投 50 球，三局的比赛首发大概撑到第二局后半）
  function tire(t, n) {
    const m = arm[t];
    m.energy = Math.max(0, m.energy - (n * 100) / (m.p.stamina * 0.72));
  }
  // 会不会陷入混乱：控球差、体力低的投手比较容易；体力归零一定会乱
  function rattleCheck(t, chance) {
    const m = arm[t];
    if (m.rattle) return;
    const odds = chance * (1.35 - m.p.control / 100) * (1 + fatigue(m) * 0.8);
    if (m.energy > 0 && Math.random() > odds) return;
    m.rattle = 2;
    setTimeout(() => {
      if (S.over || !arm[t].rattle) return;
      ui.call('投手乱了', 'foul'); // 等前一个判决的字卡播完再跳
      sfx.call(false);
      refresh();
    }, 1250);
  }
  // 让击球员上垒：load＝相当于几球的负担，chance＝这一下让投手慌掉的基本几率（连续被上垒会再加）
  function armReach(t, load, chance) {
    const m = arm[t];
    tire(t, load);
    m.streak++;
    rattleCheck(t, chance + (m.streak >= 2 ? 0.3 : 0));
  }
  // 拿到出局数：连续上垒归零，混乱往恢复走一步（三振直接恢复）
  function armOut(t, strikeout) {
    const m = arm[t];
    m.streak = 0;
    if (m.rattle) m.rattle = strikeout ? 0 : m.rattle - 1;
  }
  // 换投手：t 队换上牛棚里第 k 位。原本的投手下场、新投手站上投手丘，体力全满；下场的人不能再回来
  function changePitcher(t, k) {
    const m = arm[t];
    const np = m.pen.splice(k, 1)[0];
    if (!np) return null;
    const old = fielders[t].P;
    const hand = np.hand === '左投' ? -1 : 1;
    const a = makeActor({ ...teams[t].kit, skin: np.skin, hair: np.hair, no: np.no, name: np.name, look: np.look, glove: -hand, gear: null });
    a.hand = hand;
    a.home = old.home;
    a.posName = 'P';
    a.info = np;
    a.group.position.copy(old.group.position);
    a.group.rotation.copy(old.group.rotation);
    a.group.visible = old.group.visible;
    a.set('idle');
    root.remove(old.group);
    root.add(a.group);
    fielders[t].P = a;
    Object.assign(m, { p: np, energy: 100, rattle: 0, streak: 0, seen: 0 });
    S.pitchCount[t] = 0;
    pitchBack = null;
    selPitch = 0;
    ui.dip();
    ui.banner({ kicker: `${teams[t].name}　更换投手`, title: np.name, sub: `${np.hand}　OVR ${np.ovr}　最快 ${np.maxKmh} km/h`, good: true }, 2.0);
    refresh();
    return np;
  }
  // 玩家叫出牛棚：只能在选球种的时候（还没开始投）
  function openBullpen() {
    if (phase !== 'select' || !userPitching() || !mound().pen.length || !active()) return;
    setPhase('pen');
    ui.pitchMenu(null);
    ui.hint('');
    ui.bullpen(mound().pen, mound(), (k) => {
      ui.bullpen(null);
      if (k == null || !changePitcher(fld(), k)) return beginPitch(); // 取消：回到选球种
      setPhase('pre');
      schedule(1.8, beginPitch);
    });
  }
  // 电脑的调度：投手快没力、或已经乱掉又累了，就换牛棚里最强的上来
  function aiBullpen() {
    const m = mound();
    if (userPitching() || !m.pen.length) return false;
    if (!(m.energy < 22 || (m.rattle && m.energy < 55))) return false;
    const k = m.pen.reduce((best, p, i) => (p.ovr > m.pen[best].ovr ? i : best), 0);
    return !!changePitcher(fld(), k);
  }

  // 混乱时准星会乱晃（玩家投球才看得到）；出手那一刻晃到哪，球就往哪去
  function wobble() {
    const m = mound();
    if (!m.rattle || !userPitching()) return [0, 0];
    const t = performance.now() / 1000;
    return [Math.sin(t * 7.3) * 0.1 + Math.sin(t * 13.1) * 0.05, Math.cos(t * 5.9) * 0.08 + Math.sin(t * 11.7) * 0.04];
  }

  const today = new Map();
  const stat = (p) => today.get(p) || today.set(p, { ab: 0, h: 0 }).get(p);
  let phase = 'idle';
  let pt = 0;
  let gt = 0;
  let started = false;
  let paused = false;
  let held = false; // 玩家按了暂停
  let timer = null;
  let camMode = 'plate';
  let batter = null;
  let batterInfo = null;
  let runners = []; // { actor, player, base }
  let plan = null;
  let pitch = null;
  let swing = null;
  let aiSwing = null;
  let play = null;
  let foul = null;
  let selPitch = 0;
  let released = false;
  let pitchBack = null; // 投手投完球后回投手板的状态
  const SETTLE_T = 0.12;
  let lastPitch = '';
  const lastType = [null, null];
  const aim = { x: 0, y: zc };
  const look = new THREE.Vector3(0, 1, -20);
  let followFov = 42;

  const bat = () => S.half;
  const fld = () => 1 - S.half;
  const userBatting = () => S.half === USER && !TUNE.auto;
  const userPitching = () => S.half !== USER && !TUNE.auto;
  // 防守传垒的浮动垒包（手机点、电脑按 1–4）
  const picker = createBasePicker({ camera, canvas, onPick: (n) => play && play.manual && play.pick && chooseBase(play, n) });
  const pitcher = () => fielders[fld()].P;
  const setPhase = (p) => {
    phase = p;
    pt = 0;
    if (p !== 'play' && typeof picker !== 'undefined') picker.hide(); // 换阶段时收起浮动垒包
  };
  const schedule = (sec, fn) => {
    timer = { t: sec, fn };
  };

  // 助威热度：得点圈有人、球数到关键、比赛后段、比数接近时，助威节奏加快、声音变大
  function bandHeat() {
    let h = 0;
    if (S.bases[1] || S.bases[2]) h += 0.4;
    else if (S.bases[0]) h += 0.15;
    if (S.strikes === 2 || S.balls === 3) h += 0.2;
    if (S.inning >= TUNE.innings - 1) h += 0.2;
    if (Math.abs(S.score[0] - S.score[1]) <= 1) h += 0.2;
    band.heat(h);
  }

  function refresh() {
    bandHeat();
    hud.render({
      S, away: teams[0], home: teams[1],
      batter: batterInfo, batTeam: teams[bat()], order: S.batIdx[bat()] + 1,
      today: batterInfo ? stat(batterInfo) : null,
      pitcher: mound().p, fldTeam: teams[fld()], pitchCount: S.pitchCount[fld()], lastPitch,
      energy: mound().energy, rattle: mound().rattle,
    });
    scoreboard.draw({ S, away: teams[0], home: teams[1], innings: TUNE.innings });
  }

  function resetField() {
    pitchBack = null;
    fielders.forEach((set, ti) => {
      for (const [pos, a] of Object.entries(set)) {
        a.group.visible = ti === fld();
        a.group.position.set(a.home[0], pos === 'P' ? MOUND_Y : 0, a.home[1]);
        if (pos === 'C') a.group.rotation.y = Math.PI;
        else a.face(0, 0);
        a.set(pos === 'P' ? 'idle' : pos === 'C' ? 'crouch' : 'ready');
      }
    });
    ball.visible = false;
    placeRunners();
  }

  function placeRunners() {
    for (const r of runners) {
      const [x, z] = BASES[r.base];
      r.actor.group.position.set(x, 0, z);
      r.actor.face(0, 0);
      r.actor.set('idle');
    }
  }

  function removeBatter() {
    if (batter) root.remove(batter.group);
    batter = null;
  }

  function spawnBatter() {
    removeBatter();
    const team = teams[bat()];
    const p = team.lineup[S.batIdx[bat()]];
    batterInfo = p;
    const side = p.bats === '左' ? -1 : 1;
    batter = makeActor({
      ...team.kit, skin: p.skin, hair: p.hair, no: p.no, name: p.name, look: p.look, bat: true, helmet: side,
    });
    batter.side = side;
    batter.group.position.set(-batter.side * 0.85, 0, 0.05); // 站近本垒板：球棒才扫得过整个本垒板
    batter.group.rotation.y = batter.side * (Math.PI / 2);
    batter.set('stance');
    root.add(batter.group);
  }

  // ── 打席流程 ──
  function beginPA() {
    S.balls = 0;
    S.strikes = 0;
    camMode = 'plate';
    spawnBatter();
    band.song(teams[bat()].cheer); // 进攻球队的助威曲
    sayParts(line.batter(S.batIdx[bat()] + 1, batterInfo.pos, batterInfo.name), true);
    resetField();
    lastPitch = '';
    refresh();
    setPhase('pre');
    schedule(aiBullpen() ? 2.2 : 0.7, beginPitch);
  }

  function beginPitch(fromCloseup) {
    // 投手的状态变差了（累了、快没力、乱掉）：镜头先给他两秒，让人看见他的样子，再开始这一球
    {
      const m = mound();
      const lvl = (m.rattle ? 10 : 0) + (m.energy < 25 ? 2 : m.energy < 50 ? 1 : 0);
      const worse = lvl > (m.seen || 0);
      m.seen = lvl;
      if (worse && fromCloseup !== true) {
        camMode = 'mound';
        setPhase('pre');
        ui.pitchMenu(null);
        ui.hint('');
        ui.batHelp(false);
        ball.visible = false;
        if (batter) batter.set('stance');
        pitcher().set('idle');
        return schedule(2.4, () => beginPitch(true));
      }
    }
    swing = null;
    aiSwing = null;
    pitch = null;
    foul = null;
    play = null;
    camMode = 'plate';
    ball.visible = false;
    if (batter) batter.set('stance');
    pitcher().set('idle');
    const sp = mound().p;
    if (userPitching()) {
      setPhase('select');
      ui.pitchMenu(sp.pitches, selPitch, sp.maxKmh);
      ui.hint(ui.touch ? '摇杆瞄准　点击球种　按「投球」，圈缩到刚好时再按一下' : '1–4 选球种　鼠标瞄准　点击投球，圈缩到刚好时再点一下');
      ui.batHelp(false);
    } else {
      plan = aiPlan(sp);
      ui.pitchMenu(null);
      ui.hint('');
      ui.batHelp(userBatting());
      setPhase('set');
      schedule(0.6 + Math.random() * 0.7, startWindup);
    }
  }

  function aiPlan(sp) {
    const w = sp.pitches.map((_, i) => (i === 0 ? 0.45 : 0.55 / (sp.pitches.length - 1)));
    let r = Math.random();
    let idx = 0;
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    const [name, g] = sp.pitches[idx];
    const def = PITCHES[name];
    let T;
    if (Math.random() < 0.62) {
      T = { x: (Math.random() * 2 - 1) * ZONE.x * 0.95, y: lerp(ZONE.y0, ZONE.y1, Math.random()) };
      if (def.by < -0.2) T.y = lerp(ZONE.y0, zc, Math.random());
    } else {
      const off = 0.06 + Math.random() * 0.18;
      const side = Math.floor(Math.random() * 4);
      T = { x: (Math.random() * 2 - 1) * ZONE.x, y: lerp(ZONE.y0, ZONE.y1, Math.random()) };
      if (side === 0) T.x = ZONE.x + off;
      else if (side === 1) T.x = -ZONE.x - off;
      else if (side === 2 || def.by < -0.2) T.y = ZONE.y0 - off;
      else T.y = ZONE.y1 + off;
    }
    const acc = 0.5 + Math.random() * 0.45;
    return finishPlan(sp, idx, T, acc);
  }

  function finishPlan(sp, idx, target, acc) {
    const [name, g] = sp.pitches[idx];
    const m = mound();
    const fat = fatigue(m); // 累了：控球变差、球速变慢
    const errMax = (0.34 - sp.control * 0.0022) * (1 + fat * 0.9);
    let err = (1 - acc) * errMax + 0.015;
    if (m.rattle) err += 0.16 + Math.random() * 0.34; // 混乱：球不受控制，会飘到哪里不一定
    const a = Math.random() * Math.PI * 2;
    return {
      idx, name, g, acc,
      T: { x: target.x + Math.cos(a) * err, y: target.y + Math.sin(a) * err },
      kmh: sp.maxKmh * PITCHES[name].speed * (0.95 + 0.03 * acc + Math.random() * 0.02) * (1 - fat * 0.08),
    };
  }

  function startWindup() {
    setPhase('windup');
    released = false;
    ui.pitchMenu(null);
    S.pitchCount[fld()]++;
    tire(fld(), 1);
    if (mound().energy <= 12) rattleCheck(fld(), 0.3); // 快没力了：随时可能乱掉
    // 上一球投完还没走回投手板就要投下一球：直接站回去
    if (pitchBack) {
      const p = pitcher();
      p.group.position.x = p.home[0];
      p.group.position.z = p.home[1];
      p.face(0, 0);
      pitchBack = null;
    }
    pitcher().play('pitch', PITCH.dur, 'idle');
  }

  // 投手手上的球：掌心＝手腕骨和中指根部的中点（用两根骨头的实际位置算，不同身材的模型都对得上）。
  // 出手前球跟着手走，出手时从这里飞出去
  const _wrist = new THREE.Vector3();
  const _knuckle = new THREE.Vector3();
  function pitcherBallPos() {
    const p = pitcher();
    if (!p) return null;
    const w = p.group.getObjectByName('mixamorigRightHand'); // 左投是整个模型镜射，丢球的仍是这只手
    const k = p.group.getObjectByName('mixamorigRightHandMiddle1');
    if (!w) return null;
    p.group.updateMatrixWorld(true);
    w.getWorldPosition(_wrist);
    if (k) _wrist.lerp(k.getWorldPosition(_knuckle), 0.6);
    // 球放在场地的群组里（群组本身有垫高），要把世界座标换成球所在群组的座标，不然球会比手高一截
    if (ball.parent) ball.parent.worldToLocal(_wrist);
    return _wrist;
  }

  function release(from) {
    released = true;
    const hand = pitcher().hand;
    const def = PITCHES[plan.name];
    const mul = GRADE_MUL[plan.g] || 1;
    // 出手点＝这一刻手的实际位置（原本是写死的固定点，球会凭空出现在手的旁边）
    const hp = from || pitcherBallPos();
    const R = hp ? { x: hp.x, y: hp.y, z: hp.z } : { x: -0.3 * hand, y: MOUND_Y + 1.6, z: -18.44 + 0.9 };
    const B = { x: def.bx * hand * mul, y: def.by * mul };
    const T = plan.T;
    const d = Math.hypot(T.x - R.x, T.y - R.y, R.z);
    pitch = {
      R, B, T, A: { x: T.x - B.x, y: T.y - B.y },
      Tf: d / (plan.kmh / 3.6) / TUNE.speedScale,
      arc: (1 - def.speed) * 1.1 + 0.05,
      t: 0, resolved: false, swung: false,
    };
    pitch.arrive = gt + pitch.Tf; // 球到本垒的时间点
    setPhase('flight');
    ball.visible = true;
    ball.position.set(R.x, R.y, R.z); // 出手这一格球就在出手点（不要留在已经往回收的手上）
    if (!userBatting()) aiSwing = aiBat();
  }

  function aiBat() {
    const T = pitch.T;
    const dz = outsideZone(T);
    const inZone = dz === 0;
    const breaking = Math.abs(PITCHES[plan.name].by) > 0.2 || Math.abs(PITCHES[plan.name].bx) > 0.2;
    let pSwing = inZone ? 0.7 : Math.max(0.04, 0.46 - dz * 2.6 + (breaking ? 0.07 : 0));
    if (S.strikes === 2) pSwing += inZone ? 0.22 : 0.12;
    if (S.balls === 3 && S.strikes < 2 && !inZone) pSwing *= 0.5;
    if (Math.random() >= pSwing) return { type: 'take' };
    const skill = clamp((batterInfo.ovr - 55) / 40, 0.1, 0.8);
    const c = inZone ? 1 - Math.max(Math.abs(T.x) / ZONE.x, Math.abs(T.y - zc) / ((ZONE.y1 - ZONE.y0) / 2)) : 0;
    const repeat = lastType[fld()] === plan.name;
    const pContact = clamp(0.57 + 0.26 * skill + 0.12 * c - dz * 1.6 - 0.1 * plan.acc + (repeat ? 0.08 : 0), 0.08, 0.92);
    if (Math.random() >= pContact) return { type: 'whiff' };
    if (Math.random() < 0.24) return { type: 'foul' };
    const q = clamp(0.12 + Math.random() * 0.8 + 0.3 * skill + 0.15 * c - 0.12 * plan.acc + (repeat ? 0.1 : 0), 0.05, 1);
    const spray = -6 * batter.side + gauss() * 23;
    if (Math.abs(spray) > 45) return { type: 'foul' };
    return { type: 'contact', ev: ((88 + 80 * q) * power(batterInfo)) / 3.6, la: clamp(11 + gauss() * 19, -28, 62), spray, q };
  }

  // 挥棒后告诉玩家偏在哪里：时机（太早／太晚）与位置（偏高／偏低／偏左／偏右）
  function swingFeedback(dt, dx, dy) {
    const tm = Math.abs(dt) <= TUNE.timing * 0.35 ? '时机刚好' : dt < 0 ? '挥得太早' : '挥得太晚';
    const far = Math.hypot(dx, dy);
    let where = '位置对准';
    if (far > TUNE.pci * 0.45) where = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? '瞄得太高' : '瞄得太低') : dx > 0 ? '瞄得偏右' : '瞄得偏左';
    const good = tm === '时机刚好' && where === '位置对准';
    ui.feedback(good ? '完美击球！' : `${tm}　${where}`, good ? 'good' : 'bad');
  }

  // 挥棒时机：球到本垒前 LEAD 秒按下最准；球到了才按也来得及（GRACE 秒内都算，只是偏晚）
  const LEAD = 0.07;
  const GRACE = 0.08;
  function userSwingResult() {
    if (!swing) return { type: 'take' };
    const T = pitch.T;
    const dt = swing.at + LEAD - pitch.arrive;
    swingFeedback(dt, swing.x - T.x, swing.y - T.y);
    if (Math.abs(dt) > TUNE.timing * 1.35) return { type: 'whiff' };
    // 瞄准辅助：球棒会自动往球的方向靠过去一部分（1＝完全自动对准，0＝完全靠自己瞄）
    const d = Math.hypot(swing.x - T.x, swing.y - T.y) * (1 - TUNE.aimAssist);
    const lim = TUNE.pci * 1.9; // 瞄准圈放在好球区中央时，大部分好球都碰得到，只是越偏打得越不扎实
    if (d > lim) return { type: 'whiff' };
    const q = clamp((1 - d / lim) * (1 - (0.5 * Math.abs(dt)) / TUNE.timing) * 1.2, 0, 1);
    if (q < 0.16) return { type: 'foul' };
    const spray = (dt / TUNE.timing) * 50 * batter.side + gauss() * 5;
    if (Math.abs(spray) > 45) return { type: 'foul' };
    return {
      type: 'contact', q, spray,
      ev: ((88 + 80 * q) * power(batterInfo)) / 3.6,
      la: clamp(13 + (T.y - swing.y) * (1 - TUNE.aimAssist) * 190 + gauss() * 6, -28, 62),
    };
  }

  function resolvePitch() {
    pitch.resolved = true;
    lastType[fld()] = plan.name;
    lastPitch = `${plan.name} ${Math.round(plan.kmh)} km/h`;
    ui.pitchInfo(lastPitch);
    const res = userBatting() ? userSwingResult() : aiSwing;
    if (res.type === 'take' && hitsBatter(pitch.T)) hitByPitch();
    else if (res.type === 'take') callPitch(outsideZone(pitch.T) <= 0.04 ? 'strike' : 'ball');
    else if (res.type === 'whiff') callPitch('swing');
    else if (res.type === 'foul') foulBall();
    else startPlay(res);
  }

  // 球有没有砸到击球员：击球员站在本垒板旁 0.85 公尺，身体靠本垒板这一侧大约在 0.5 公尺的位置
  function hitsBatter(T) {
    return !!batter && T.x * -batter.side > 0.5 && T.y > 0.2 && T.y < 1.6;
  }
  // 触身球：没挥棒被球砸到，直接保送上一垒（不算坏球数）
  function hitByPitch() {
    setPhase('call');
    ui.call('触身球', 'ball');
    sfx.hit(0.25);
    sfx.pop();
    // 球砸在身上（靠本垒板那一侧），击球员往外缩；球弹开掉在地上
    const hx = -batter.side * 0.62;
    pitch.hbp = { x: hx, y: pitch.T.y, vx: batter.side * 1.1, t: 0 };
    hbpFx.hit(batter, -batter.side, new THREE.Vector3(hx, pitch.T.y, 0.05));
    refresh();
    schedule(1.6, () => {
      hbpFx.stop();
      walk(true);
    });
  }

  function callPitch(kind) {
    setPhase('call');
    if (kind === 'ball') S.balls++;
    else S.strikes++;
    const k = S.strikes >= 3;
    const bb = S.balls >= 4;
    ui.call(k ? '三振' : bb ? '保送' : kind === 'ball' ? '坏球' : kind === 'swing' ? '挥棒落空' : '好球', kind);
    if (!k && !bb) sayParts(kind === 'ball' ? line.ball() : kind === 'swing' ? line.swing() : line.strike());
    sfx.call(kind !== 'ball');
    refresh();
    schedule(1.1, () => {
      if (k) strikeout();
      else if (bb) walk();
      else beginPitch();
    });
  }

  function foulBall() {
    if (S.strikes < 2) S.strikes++;
    sfx.hit(0.3);
    ui.call('界外球', 'foul');
    sayParts(line.foul());
    foul = flight(26 + Math.random() * 10, 20 + Math.random() * 30, (Math.random() < 0.5 ? -1 : 1) * (58 + Math.random() * 25));
    setPhase('foul');
    refresh();
    schedule(1.1, beginPitch);
  }

  function strikeout() {
    S.outs++;
    armOut(fld(), true);
    stat(batterInfo).ab++;
    removeBatter();
    ui.banner({ kicker: `${batterInfo.name}`, title: '三振出局', sub: `${S.outs} 出局` }, 1.6);
    sayParts(line.strikeout(batterInfo.name, S.outs), true);
    endPA(1.6);
  }

  function walk(hbp = false) {
    // 被挤垒的跑垒员依序前进
    let runs = 0;
    const b = S.bases;
    if (b[0]) {
      if (b[1]) {
        if (b[2]) {
          runs++;
          removeRunner(b[2]);
        }
        b[2] = b[1];
      }
      b[1] = b[0];
    }
    b[0] = batterInfo;
    batter.rig.bat.visible = false;
    runners.push({ actor: batter, player: batterInfo, base: 1 });
    batter = null;
    for (const r of runners) r.base = b.indexOf(r.player) + 1;
    if (runs) addRuns(runs);
    armReach(fld(), 2, hbp ? 0.3 : 0.12); // 砸到人更容易乱
    ui.dip();
    placeRunners();
    ui.banner({ kicker: batterInfo.name, title: hbp ? '触身球保送' : '四坏球保送', sub: runs ? `挤回 ${runs} 分` : '' }, 1.6);
    sayParts(line.walk(runs), true);
    endPA(1.6);
  }

  function removeRunner(player) {
    const i = runners.findIndex((r) => r.player === player);
    if (i >= 0) {
      root.remove(runners[i].actor.group);
      runners.splice(i, 1);
    }
  }

  function addRuns(n) {
    S.score[bat()] += n;
    S.lines[bat()][S.inning - 1] = (S.lines[bat()][S.inning - 1] || 0) + n;
    tire(fld(), 1.5 * n); // 掉分对投手是额外的负担
  }

  function endPA(delay) {
    S.batIdx[bat()] = (S.batIdx[bat()] + 1) % 9;
    refresh();
    setPhase('post');
    schedule(delay, () => {
      const walkOff = S.half === 1 && S.inning >= TUNE.innings && S.score[1] > S.score[0];
      if (walkOff) gameOver();
      else if (S.outs >= 3) switchHalf();
      else {
        ui.dip();
        beginPA();
      }
    });
  }

  // ── 攻守交替：防守的那一队跑回休息区，另一队从休息区跑上场就定位 ──
  const DUG = [[-19.3, 2.0], [19.3, 2.0]]; // 休息区前方：客队在三垒侧、主队在一垒侧
  const SWAP_T = 6.5;
  let swap = null;
  function startSwap(outTeam) {
    const list = [];
    for (const team of [0, 1]) {
      const [dx, dz] = DUG[team];
      const sx = Math.sign(dx);
      Object.entries(fielders[team]).forEach(([pos, a], i) => {
        // 休息区前一字排开（沿着休息区的方向错开）
        const k = (i - 4) * 1.5;
        const spot = [dx + sx * 0.707 * k, 0, dz - 0.707 * k];
        const home = [a.home[0], pos === 'P' ? MOUND_Y : 0, a.home[1]];
        const leaving = team === outTeam;
        const from = leaving ? [a.group.position.x, a.group.position.y, a.group.position.z] : spot;
        const to = leaving ? spot : home;
        a.group.visible = true;
        a.group.position.set(from[0], from[1], from[2]);
        a.face(to[0], to[2]);
        a.set('run');
        // 下场的先动，上场的晚一点出发；离得远的外场手早一点起跑
        list.push({ a, pos, from, to, leaving, delay: leaving ? i * 0.05 : 0.9 + i * 0.06, done: false });
      });
    }
    swap = { t: 0, list };
    camMode = 'follow';
    ball.visible = false;
  }
  function updateSwap(dt) {
    swap.t += dt;
    for (const m of swap.list) {
      if (m.done) continue;
      const k = clamp((swap.t - m.delay) / (SWAP_T - 1.3 - m.delay), 0, 1);
      const e = k * k * (3 - 2 * k);
      m.a.group.position.set(lerp(m.from[0], m.to[0], e), lerp(m.from[1], m.to[1], e), lerp(m.from[2], m.to[2], e));
      if (k >= 1) {
        m.done = true;
        if (m.leaving) m.a.group.visible = false;
        else {
          if (m.pos === 'C') m.a.group.rotation.y = Math.PI;
          else m.a.face(0, 0);
          m.a.set(m.pos === 'P' ? 'idle' : m.pos === 'C' ? 'crouch' : 'ready');
        }
      }
    }
    if (swap.t >= SWAP_T) {
      swap = null;
      resetField();
      beginPA();
    }
  }

  function switchHalf() {
    const outTeam = fld(); // 这半局防守的队伍，等一下要跑下场
    {
      const m = arm[outTeam]; // 回休息区喘口气：体力回一点、混乱缓和一级
      m.energy = Math.min(100, m.energy + 12);
      m.rattle = Math.max(0, m.rattle - 1);
      m.streak = 0;
    }
    runners.forEach((r) => root.remove(r.actor.group));
    runners = [];
    removeBatter();
    S.outs = 0;
    S.balls = 0;
    S.strikes = 0;
    S.bases = [null, null, null];
    const N = TUNE.innings;
    let extraStart = false; // 这次换局是不是刚进入延长赛
    if (S.half === 0) {
      if (S.inning >= N && S.score[1] > S.score[0]) return gameOver();
      S.half = 1;
    } else {
      // 打满规定局数：分出胜负就结束；平局进延长赛，延长局数用完仍平局才以和局收场
      if (S.inning >= N && S.score[0] !== S.score[1]) return gameOver();
      if (S.inning >= N + TUNE.extra) return gameOver();
      S.half = 0;
      S.inning++;
      extraStart = S.inning === N + 1;
    }
    S.lines[S.half][S.inning - 1] = 0;
    batterInfo = null;
    startSwap(outTeam);
    ui.pitchMenu(null);
    ui.hint('');
    refresh();
    const extra = S.inning > N;
    ui.banner({ kicker: extra ? '延长赛' : '攻守交替', title: `${S.inning} 局${S.half ? '下' : '上'}`, sub: extraStart ? `双方 ${S.score[0]}：${S.score[1]} 平局，比赛继续` : `${teams[bat()].name} 进攻` }, extraStart ? 3.2 : 2.2);
    sayParts(line.change(S.inning, S.half, teams[bat()].name, extraStart), true);
    setPhase('switch'); // 两队跑完位置后由 updateSwap 开始下一个打席
  }

  function gameOver() {
    S.over = true;
    S.regulation = TUNE.innings;
    removeBatter();
    batterInfo = null;
    setPhase('over');
    camMode = 'follow';
    ball.visible = false;
    ui.pitchMenu(null);
    ui.hint('');
    refresh();
    sfx.cheer(0.5);
    ui.final({ S, away: teams[0], home: teams[1], user: USER });
    sayParts(line.gameOver(S.score[0] === S.score[1] ? null : teams[S.score[0] > S.score[1] ? 0 : 1].name), true);
  }

  // ── 击出后的攻防 ──
  function startPlay(res) {
    setPhase('play');
    camMode = 'follow';
    sfx.hit(res.q ?? 0.7);
    ui.hint('');
    const fl = flight(res.ev, res.la, res.spray);
    const set = fielders[fld()];
    const list = Object.values(set).map((a) => ({ pos: a.posName, x: a.home[0], z: a.home[1] }));
    const fp = fl.hr || fl.grd ? null : fieldPlay(fl, list);
    const out = resolveOutcome(fl, fp, { outs: S.outs, on: S.bases.map(Boolean) }, res.la);
    const on = S.bases.map(Boolean);
    // 我方防守、球被接住或捡起：改成玩家选垒传球，传到了才判定出局（一垒手自己踩垒的地滚球照旧）
    if (userPitching() && fp && !(out.kind === 'GROUND' && out.own)) return startManualPlay(res, fl, fp, out, set);

    // 跑垒员与击球员的进垒计划
    const movers = [];
    const mv = (actor, player, from, to, o = {}) => movers.push({ actor, player, from, to, start: 0, ...o });
    let outsAdd = 0;
    if (out.kind === 'HR') {
      mv(batter, batterInfo, 0, 4);
      runners.forEach((r) => mv(r.actor, r.player, r.base, 4));
    } else if (out.kind === 'HIT') {
      mv(batter, batterInfo, 0, out.bases);
      for (const r of runners) {
        const extra = out.outfield && ((out.bases === 1 && r.base >= 2) || (out.bases === 2 && r.base >= 1)) && (S.outs === 2 || Math.random() < 0.55);
        mv(r.actor, r.player, r.base, Math.min(4, r.base + out.bases + (extra ? 1 : 0)));
      }
    } else if (out.kind === 'GROUND' || out.kind === 'DP') {
      outsAdd = out.kind === 'DP' ? 2 : 1;
      mv(batter, batterInfo, 0, 1, { out: true });
      for (const r of runners) {
        const forced = r.base === 1 || (r.base === 2 && on[0]) || (r.base === 3 && on[0] && on[1]);
        if (out.kind === 'DP' && r.base === 1) mv(r.actor, r.player, 1, 2, { out: true });
        else if (forced) mv(r.actor, r.player, r.base, r.base + 1);
      }
    } else {
      outsAdd = 1;
      mv(batter, batterInfo, 0, 1, { out: true });
      if (out.sac) {
        const r = runners.find((x) => x.base === 3);
        if (r) mv(r.actor, r.player, 3, 4, { start: fp.t + 0.1 });
      }
    }
    const inningOver = S.outs + outsAdd >= 3;

    // 传球与补位
    const throws = [];
    const covers = [];
    const cover = (pos, base, by) => {
      if (set[pos] && pos !== fp.who) covers.push({ actor: set[pos], base, by });
    };
    let tEnd;
    if (out.kind === 'HR') tEnd = Math.min(7.5, fl.path[fl.path.length - 1].t + 1.5);
    else if (!fp) tEnd = fl.path[fl.path.length - 1].t + 1.2;
    else if (out.kind === 'FLY') {
      tEnd = fp.t + 1.0;
      // 外场手接杀之后把球传回内场（有人回本垒就传本垒，否则传二垒），不会抱着球站在原地
      if (OUTFIELD.includes(fp.who) && !inningOver) {
        const tb = out.sac ? 0 : 2;
        const d = Math.hypot(fp.point.x - BASES[tb][0], fp.point.z - BASES[tb][1]);
        const t1 = fp.t + 0.7 + d / 35;
        throws.push({ t0: fp.t + 0.6, t1, to: BASES[tb] });
        cover(tb === 0 ? 'C' : 'SS', tb, fp.t + 0.6);
        tEnd = t1 + 0.7;
      }
    }
    else if (out.kind === 'GROUND') {
      if (!out.own) {
        throws.push({ t0: Math.max(fp.t + 0.3, out.tFirst - 0.9), t1: out.tFirst, to: BASES[1] });
        cover('1B', 1, fp.t);
      }
      tEnd = out.tFirst + 0.8;
    } else if (out.kind === 'DP') {
      throws.push({ t0: fp.t + 0.3, t1: out.tSecond, to: BASES[2] });
      throws.push({ t0: out.tSecond + 0.3, t1: out.tFirst, to: BASES[1] });
      cover(fp.who === 'SS' ? '2B' : 'SS', 2, out.tSecond - 0.1);
      cover('1B', 1, out.tSecond);
      tEnd = out.tFirst + 0.8;
    } else {
      const tb = Math.min(3, out.bases + 1);
      const d = Math.hypot(fp.point.x - BASES[tb][0], fp.point.z - BASES[tb][1]);
      const t1 = fp.t + 0.7 + d / 35;
      throws.push({ t0: fp.t + 0.6, t1, to: BASES[tb] });
      cover(tb === 3 ? '3B' : fp.who === 'SS' ? '2B' : 'SS', tb, fp.t + 0.6);
      const legs = (m) => m.start + (m.from === 0 ? 4.3 : 3.9) + Math.max(0, m.to - m.from - 1) * 3.9;
      tEnd = Math.min(13, Math.max(t1, ...movers.map(legs)) + 0.5);
    }

    if (batter) batter.rig.bat.visible = false;
    play = {
      fl, fp, out, res, movers, throws, covers, outsAdd, inningOver, tEnd, t: 0,
      fielder: fp ? set[fp.who] : null, popped: false, thrown: 0,
    };
  }

  const OUTFIELD = ['LF', 'CF', 'RF'];
  // ── 玩家选垒传球 ──
  // 跑垒员 m 跑到第 B 个垒包（4＝本垒）的时间
  function arriveAt(m, B) {
    return m.start + (m.from === 0 ? 4.3 : 3.9) + Math.max(0, B - m.from - 1) * 3.9;
  }
  // 现在从持球的位置传到 B 垒，会不会比跑垒员先到（回传那位跑垒员，没机会则 null）
  function outChance(p, B) {
    const m = p.movers.find((x) => !x.out && x.from < B && B <= x.to && arriveAt(x, B) > p.t);
    if (!m) return null;
    const [bx, bz] = BASES[B % 4];
    const t1 = p.t + 0.25 + Math.hypot(bx - p.holder.x, bz - p.holder.z) / TUNE.throwSpeed;
    return t1 + 0.05 < arriveAt(m, B) ? m : null;
  }
  function stillRunning(p) {
    return p.movers.some((m) => !m.out && arriveAt(m, m.to) > p.t);
  }
  function startManualPlay(res, fl, fp, out, set) {
    const movers = [];
    const mv = (actor, player, from, to, o = {}) => movers.push({ actor, player, from, to, start: 0, ...o });
    const on = S.bases.map(Boolean);
    let outsAdd = 0;
    if (out.kind === 'FLY') {
      outsAdd = 1;
      mv(batter, batterInfo, 0, 1, { out: true });
      if (out.sac) {
        const r = runners.find((x) => x.base === 3);
        if (r) mv(r.actor, r.player, 3, 4, { start: fp.t + 0.1, tagUp: true });
      }
    } else if (out.kind === 'HIT') {
      mv(batter, batterInfo, 0, out.bases);
      for (const r of runners) {
        const extra = out.outfield && ((out.bases === 1 && r.base >= 2) || (out.bases === 2 && r.base >= 1)) && (S.outs === 2 || Math.random() < 0.55);
        mv(r.actor, r.player, r.base, Math.min(4, r.base + out.bases + (extra ? 1 : 0)));
      }
    } else {
      // 地滚球：击球员跑一垒、被迫进垒的跑垒员往前一个垒，谁出局看玩家传哪一垒
      mv(batter, batterInfo, 0, 1);
      for (const r of runners) {
        const forced = r.base === 1 || (r.base === 2 && on[0]) || (r.base === 3 && on[0] && on[1]);
        if (forced) mv(r.actor, r.player, r.base, r.base + 1);
      }
    }
    if (batter) batter.rig.bat.visible = false;
    play = {
      manual: true, set, fl, fp, out, res, movers, throws: [], covers: [], outsAdd, inningOver: S.outs + outsAdd >= 3,
      tEnd: Math.max(fp.t + 1.2, ...movers.filter((m) => !m.out).map((m) => arriveAt(m, m.to) + 0.6)),
      t: 0, fielder: set[fp.who], thrower: set[fp.who], popped: false, thrown: 0,
      holder: { x: fp.point.x, z: fp.point.z }, pick: null, flying: null, noMore: false,
    };
  }
  function openPick(p) {
    const hints = {};
    for (const B of [1, 2, 3, 4]) hints[B] = !!outChance(p, B);
    p.pick = { real: 0, hints };
    picker.show(hints);
  }
  // 时间到没选：传到能让最前面跑垒员出局的垒包；都没机会就不传
  function autoBase(p) {
    for (const B of [4, 3, 2, 1]) if (outChance(p, B)) return B;
    return 0;
  }
  function coverActor(p, B) {
    let pos = B === 1 ? '1B' : B === 2 ? (p.fp.who === 'SS' ? '2B' : 'SS') : B === 3 ? '3B' : 'C';
    if (p.set[pos] === p.thrower) pos = B === 2 ? '2B' : 'P';
    return p.set[pos];
  }
  // 杀不到人也要把球传回内场：传到最前面那位跑垒员要去的垒包前面挡住他，没人在跑就传二垒
  function returnThrow(p) {
    p.returned = true;
    const lead = Math.max(0, ...p.movers.filter((m) => !m.out && arriveAt(m, m.to) > p.t).map((m) => m.to));
    chooseBase(p, Math.max(2, Math.min(4, lead)), true);
  }
  function chooseBase(p, B, ret = false) {
    picker.hide();
    p.pick = null;
    if (!B) {
      p.noMore = true; // 没有出局机会：不再开选垒，外场手会自己把球回传（见 manualBall）
      return;
    }
    const [bx, bz] = BASES[B % 4];
    const t0 = p.t + 0.25;
    const t1 = t0 + Math.hypot(bx - p.holder.x, bz - p.holder.z) / TUNE.throwSpeed;
    p.flying = { B, t0, t1, ret, from: { ...p.holder }, to: [bx, bz] };
    p.thrower.face(bx, bz);
    p.thrower.play('throw', 0.3, 'ready');
    const c = coverActor(p, B);
    if (c && !p.covers.some((x) => x.actor === c)) p.covers.push({ actor: c, base: B % 4, by: t1 - 0.05, t0: p.t });
    p.catcherAt = c;
    p.tEnd = Math.max(p.tEnd, t1 + 1.0);
  }
  const BASE_NAME = { 1: '一垒', 2: '二垒', 3: '三垒', 4: '本垒' };
  function resolveThrow(p, th) {
    p.holder = { x: th.to[0], z: th.to[1] };
    if (p.catcherAt) p.thrower = p.catcherAt;
    if (th.ret) return; // 单纯回传，不判出局
    const m = p.movers.find((x) => !x.out && x.from < th.B && th.B <= x.to);
    if (!m) return;
    if (arriveAt(m, th.B) > th.t1 - 0.02) {
      m.out = true;
      m.to = th.B; // 停在那个垒包
      m.outAt = p.t;
      p.outsAdd++;
      if (m.tagUp) p.out.sac = false;
      ui.call(`${BASE_NAME[th.B]}出局`, 'strike');
      sfx.pop();
      if (S.outs + p.outsAdd >= 3) {
        p.inningOver = true;
        p.noMore = true;
        p.tEnd = Math.min(p.tEnd, p.t + 1.4);
      }
    } else ui.call('安全上垒', 'ball');
  }
  function manualBall(p, t, rdt) {
    const { fl, fp } = p;
    if (t < fp.t) {
      const s = fl.path[Math.min(fl.path.length - 1, Math.floor(t / SIM_DT))];
      ball.position.set(s.x, s.y + 0.05, s.z);
      return;
    }
    if (!p.popped) {
      p.popped = true;
      sfx.pop();
      if (fp.caught) p.fielder.set('catchUp');
    }
    const th = p.flying;
    if (th && t >= th.t1) {
      p.flying = null;
      resolveThrow(p, th);
    }
    if (p.flying && t >= p.flying.t0) {
      const f = p.flying;
      const k = (t - f.t0) / (f.t1 - f.t0);
      const d = Math.hypot(f.to[0] - f.from.x, f.to[1] - f.from.z);
      ball.position.set(lerp(f.from.x, f.to[0], k), 1.0 + Math.sin(k * Math.PI) * Math.min(2.2, d * 0.05), lerp(f.from.z, f.to[1], k));
    } else ball.position.set(p.holder.x, 1.0, p.holder.z);
    // 外场手拿着球、已经没有出局机会（或根本没人在跑）：把球传回内场
    if (!p.flying && !p.pick && !p.returned && OUTFIELD.includes(fp.who) && p.thrower === p.fielder && t >= fp.t + 0.45
      && (p.noMore || !stillRunning(p)) && S.outs + p.outsAdd < 3) returnThrow(p);
    // 球在手上、还有跑垒员在跑：开放选垒（慢动作），时间到自动传
    if (!p.flying && !p.pick && !p.noMore && t >= fp.t + 0.12 && stillRunning(p) && S.outs + p.outsAdd < 3) openPick(p);
    if (p.pick) {
      p.pick.real += rdt;
      // 每一帧重算：跑垒员越来越接近，绿色提示要即时反映「现在传还来不来得及」
      const hints = {};
      for (const B of [1, 2, 3, 4]) hints[B] = !!outChance(p, B);
      picker.hints(hints);
      picker.update(1 - p.pick.real / TUNE.pickWindow);
      if (p.pick.real >= TUNE.pickWindow) chooseBase(p, autoBase(p));
    }
  }

  function moverPos(m, t) {
    let rem = t - m.start;
    let cur = m.p0;
    if (rem <= 0) return { x: cur[0], z: cur[1], moving: false };
    for (let b = m.from; b < m.to; b++) {
      const nxt = BASES[(b + 1) % 4];
      const lt = b === 0 ? 4.3 : 3.9;
      if (rem < lt) {
        const k = rem / lt;
        return { x: lerp(cur[0], nxt[0], k), z: lerp(cur[1], nxt[1], k), moving: true, nx: nxt[0], nz: nxt[1] };
      }
      rem -= lt;
      cur = nxt;
    }
    return { x: cur[0], z: cur[1], moving: false };
  }

  function updatePlay(dt) {
    const p = play;
    const rdt = dt;
    if (p.manual && p.pick) dt *= TUNE.slowMo; // 选垒时慢动作
    p.t += dt;
    const t = p.t;
    const { fl, fp } = p;

    // 球
    if (p.manual) manualBall(p, t, rdt);
    else {
    const sample = (tt) => fl.path[Math.min(fl.path.length - 1, Math.floor(tt / SIM_DT))];
    if (!fp || t < fp.t) {
      const s = sample(t);
      ball.position.set(s.x, s.y + 0.05, s.z);
    } else {
      if (!p.popped) {
        p.popped = true;
        sfx.pop();
        if (fp.caught) p.fielder.set('catchUp');
      }
      let from = { x: fp.point.x, z: fp.point.z };
      let pos = { x: from.x, y: 1.0, z: from.z };
      for (const th of p.throws) {
        if (t >= th.t1) {
          from = { x: th.to[0], z: th.to[1] };
          pos = { x: from.x, y: 1.0, z: from.z };
        } else if (t >= th.t0) {
          const k = (t - th.t0) / (th.t1 - th.t0);
          const d = Math.hypot(th.to[0] - from.x, th.to[1] - from.z);
          pos = { x: lerp(from.x, th.to[0], k), y: 1.0 + Math.sin(k * Math.PI) * Math.min(2.2, d * 0.05), z: lerp(from.z, th.to[1], k) };
          break;
        } else break;
      }
      // 自己踩垒：球跟着防守队员
      if (p.out.kind === 'GROUND' && p.out.own) {
        pos = { x: p.fielder.group.position.x, y: 1.0, z: p.fielder.group.position.z };
      }
      ball.position.set(pos.x, pos.y, pos.z);
      if (p.thrown < p.throws.length && t >= p.throws[p.thrown].t0) {
        if (p.thrown === 0) p.fielder.play('throw', 0.3, 'ready');
        p.thrown++;
      }
    }
    }

    // 接球的防守队员
    if (fp) {
      const f = p.fielder;
      const h = f.home;
      if (t < fp.react) f.set('ready');
      else if (t < fp.t) {
        const k = (t - fp.react) / Math.max(0.01, fp.t - fp.react);
        f.group.position.x = lerp(h[0], fp.point.x, k);
        f.group.position.z = lerp(h[1], fp.point.z, k);
        f.group.position.y = lerp(f.group.position.y, 0, 0.2);
        f.face(fp.point.x, fp.point.z);
        f.set('run');
      } else if (p.out.kind === 'GROUND' && p.out.own && t < p.out.tFirst) {
        const k = (t - fp.t) / (p.out.tFirst - fp.t);
        f.group.position.x = lerp(fp.point.x, BASES[1][0], k);
        f.group.position.z = lerp(fp.point.z, BASES[1][1], k);
        f.face(BASES[1][0], BASES[1][1]);
        f.set('run');
      } else if (!f.dur && f.pose === 'run') f.set('ready');
    }
    // 补位的防守队员
    for (const c of p.covers) {
      const h = c.actor.home;
      const b = BASES[c.base];
      const t0 = c.t0 ?? 0.3;
      const k = clamp((t - t0) / Math.max(0.3, c.by - t0), 0, 1);
      c.actor.group.position.x = lerp(h[0], b[0], k);
      c.actor.group.position.z = lerp(h[1], b[1], k);
      if (k < 1) {
        c.actor.face(b[0], b[1]);
        c.actor.set('run');
      } else {
        c.actor.face(ball.position.x, ball.position.z);
        c.actor.set('ready');
      }
    }
    // 跑垒员
    for (const m of p.movers) {
      if (!m.p0) m.p0 = m.from === 0 ? [m.actor.group.position.x, m.actor.group.position.z] : BASES[m.from];
      const q = moverPos(m, t);
      m.actor.group.position.x = q.x;
      m.actor.group.position.z = q.z;
      if (q.moving) {
        m.actor.group.rotation.y = Math.atan2(q.nx - q.x, q.nz - q.z);
        m.actor.set('run');
      } else if (t > m.start) m.actor.set('idle');
    }

    if (t >= p.tEnd && !(p.manual && (p.pick || p.flying))) finishPlay();
  }

  function finishPlay() {
    const p = play;
    const { out } = p;
    picker.hide();
    if (p.manual) {
      // 玩家选垒后的实际结果
      const bOut = p.movers.some((m) => m.player === batterInfo && m.out);
      if (out.kind === 'GROUND' || out.kind === 'DP') {
        if (bOut) {
          out.kind = p.outsAdd >= 2 ? 'DP' : 'GROUND';
          out.text = p.outsAdd >= 2 ? '双杀打' : '地滚球出局';
        } else if (p.outsAdd) {
          out.kind = 'GROUND';
          out.text = p.outsAdd >= 2 ? '野手选择・双杀' : '野手选择';
        } else {
          out.kind = 'HIT';
          out.bases = 1;
          out.text = '内场安打';
        }
      } else if (out.kind === 'FLY' && p.outsAdd >= 2) out.text += '・双杀';
      else if (out.kind === 'HIT' && p.outsAdd) out.text += '（跑垒员出局）';
    }
    let runs = 0;
    const b = [null, null, null];
    const next = [];
    for (const r of runners) {
      if (!p.movers.some((m) => m.player === r.player)) {
        b[r.base - 1] = r.player;
        next.push(r);
      }
    }
    for (const m of p.movers) {
      if (m.out) root.remove(m.actor.group);
      else if (m.to >= 4) {
        if (!p.inningOver) runs++;
        root.remove(m.actor.group);
      } else {
        b[m.to - 1] = m.player;
        next.push({ actor: m.actor, player: m.player, base: m.to });
      }
    }
    runners = next;
    batter = null;
    S.bases = b;
    S.outs += p.outsAdd;
    const s = stat(batterInfo);
    if (!out.sac) s.ab++;
    if (out.kind === 'HIT' || out.kind === 'HR') {
      s.h++;
      S.hits[bat()]++;
    }
    if (runs) addRuns(runs);
    const good = out.kind === 'HIT' || out.kind === 'HR';
    if (out.kind === 'HR') armReach(fld(), 5, 0.5);
    else if (good) armReach(fld(), 2.5, 0.12);
    else for (let i = 0; i < Math.max(1, p.outsAdd); i++) armOut(fld(), false);
    sfx.cheer(out.kind === 'HR' ? 1 : good ? 0.6 : 0.3);
    if (good) band.burst(out.kind === 'HR');
    if (out.kind === 'HR') ui.call('本垒打', 'strike'); // 本垒打的大字美术字
    const subs = [];
    if (out.kind === 'HR') subs.push(`飞行距离 ${Math.round(p.fl.dist)} 公尺`);
    if (runs) subs.push(`${runs} 分打点`);
    if (p.outsAdd) subs.push(`${Math.min(3, S.outs)} 出局`);
    ui.banner({ kicker: batterInfo.name, title: out.sac ? '高飞牺牲打' : out.text, sub: subs.join('　'), good }, 2.0);
    sayParts(line.result(batterInfo.name, out.sac ? '高飞牺牲打' : out.text, good, runs, p.outsAdd, S.outs), true);
    play = null;
    endPA(2.0);
  }

  // ── 镜头 ──
  const vT = new THREE.Vector3();
  function liveCam(dt) {
    camera.clearViewOffset();
    const portrait = camera.aspect < 1;
    if (camMode === 'plate') {
      const s = SHOTS.live.from;
      camera.position.fromArray(s.pos);
      vT.fromArray(s.target);
      camera.lookAt(vT);
      camera.fov = s.fov * (portrait ? 1.15 : 1);
      look.set(0, 1, -18);
      followFov = 44;
    } else if (camMode === 'mound') {
      // 投手特写：从本垒这一侧的斜前方看他
      const pp = pitcher().group.position;
      camera.position.set(pp.x + 1.5, FIELD_Y + pp.y + 0.95, pp.z + 3.6); // 放低往上拍，帽檐底下的脸才看得到
      vT.set(pp.x, FIELD_Y + pp.y + 1.3, pp.z);
      camera.lookAt(vT);
      camera.fov = portrait ? 38 : 27;
    } else {
      camera.position.set(0, 10.4, 27.4);
      const bx = ball.visible ? ball.position.x : 0;
      const by = ball.visible ? ball.position.y : 1;
      const bz = ball.visible ? ball.position.z : -18;
      vT.set(bx, Math.max(1, by * 0.75) + FIELD_Y, bz);
      look.lerp(vT, 1 - Math.pow(0.001, dt));
      camera.lookAt(look);
      const d = Math.hypot(look.x, look.z - 27.4);
      const want = clamp(50 - d * 0.27, 17, 46);
      followFov = lerp(followFov, want, 1 - Math.pow(0.02, dt));
      camera.fov = followFov * (portrait ? 1.3 : 1);
    }
    camera.updateProjectionMatrix();
  }

  // ── 输入 ──
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const active = () => started && !paused && !held && director.state.mode === 'live' && !director.state.free;

  function pointerToAim(e) {
    if (camMode !== 'plate') return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    aim.x = clamp(hit.x, -0.62, 0.62);
    aim.y = clamp(hit.y - FIELD_Y, 0.18, 1.45);
  }

  function action() {
    if (!active()) return;
    if (phase === 'select') setPhase('meter');
    else if (phase === 'meter') throwWithMeter();
    else if (userBatting() && !swing && batter) {
      // 投手还没出手、或球刚离手还很远：当成练习挥棒，只做动作、不算好球
      const practice = phase !== 'flight' || !pitch || pitch.t < pitch.Tf * 0.4;
      if (practice) {
        if (['select', 'meter', 'set', 'windup', 'flight'].includes(phase) && batter.pose !== 'swing') {
          batter.aimY = aim.y;
          batter.play('swing', 0.34, 'stance');
          sfx.swing();
        }
        return;
      }
      swing = { at: gt, x: aim.x, y: aim.y };
      batter.aimY = aim.y; // 挥棒高度跟着瞄准点：低球压低、高球挥高
      batter.play('swing', 0.34, 'stance');
      sfx.swing();
    }
  }
  const meterScale = () => 3.2 - 2.8 * pt;
  function throwWithMeter(acc) {
    const a = acc ?? 1 - Math.min(1, Math.abs(meterScale() - 1) / 1.2);
    const [wx, wy] = wobble();
    plan = finishPlan(mound().p, selPitch, { x: aim.x + wx, y: aim.y + wy }, a);
    ui.hint('');
    startWindup();
  }

  // 触摸操作：瞄准用摇杆、动作用主按钮，点画面不会投球或挥棒（手指不用伸到好球区上）
  ui.onMainPress(action);
  canvas.addEventListener('pointermove', (e) => active() && !ui.touch && pointerToAim(e));
  canvas.addEventListener('pointerdown', (e) => {
    if (!active() || ui.touch) return;
    if (phase !== 'meter') pointerToAim(e);
    action();
  });
  window.addEventListener('keydown', (e) => {
    if (!active() || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === ' ') {
      e.preventDefault();
      action();
    } else if (e.key === 'p' || e.key === 'P') {
      openBullpen();
    } else if (phase === 'select' && e.key >= '1' && e.key <= '4') {
      const n = +e.key - 1;
      if (n < mound().p.pitches.length) {
        selPitch = n;
        ui.pitchMenu(mound().p.pitches, selPitch, mound().p.maxKmh);
      }
    }
  });
  ui.onPenOpen(openBullpen);
  ui.onPitchPick((i) => {
    if (phase === 'select') {
      selPitch = i;
      ui.pitchMenu(mound().p.pitches, selPitch, mound().p.maxKmh);
    }
  });

  // ── 每帧更新 ──
  function updateWidgets() {
    const plate = camMode === 'plate' && started && director.state.mode === 'live';
    fielders[fld()].C.group.visible = !plate;
    ump.group.visible = !plate;
    widgets.visible = plate && ['select', 'meter', 'set', 'windup', 'flight', 'call'].includes(phase);
    if (!widgets.visible) {
      // 球打出去、攻守交替、比赛结束时，把击球说明和「挥！」收起来
      ui.batHelp(false);
      ui.swingNow(false);
      return;
    }
    const pitching = phase === 'select' || phase === 'meter';
    aimMark.visible = aimDot.visible = pitching;
    meterRing.visible = phase === 'meter';
    const [wx, wy] = wobble();
    aimMark.position.set(aim.x + wx, aim.y + wy, 0);
    aimDot.position.set(aim.x + wx, aim.y + wy, 0);
    if (phase === 'meter') {
      meterRing.position.set(aim.x + wx, aim.y + wy, 0);
      meterRing.scale.setScalar(Math.max(0.3, meterScale()));
    }
    const batting = userBatting() && phase !== 'call';
    pci.visible = pciCore.visible = batting;
    if (batting) {
      const x = swing ? swing.x : aim.x;
      const y = swing ? swing.y : aim.y;
      pci.position.set(x, y, 0);
      pci.scale.setScalar(TUNE.pci);
      pciCore.position.set(x, y, 0);
      // 瞄准圈盖到这球的进垒点时变绿色
      const onTarget = !!(pitch && phase === 'flight' && Math.hypot(x - pitch.T.x, y - pitch.T.y) <= TUNE.pci * 0.9);
      pci.material.color.set(onTarget ? '#58f08a' : '#d8ff3e');
    }
    // 该挥棒的那一小段时间：落点圈变绿色，并跳出「挥！」
    const swingWindow = !!(batting && pitch && phase === 'flight' && !swing && Math.abs(pitch.Tf - pitch.t - LEAD) <= TUNE.timing);
    ballMark.material.color.set(swingWindow ? '#58f08a' : '#ff7a4d');
    ui.swingNow(swingWindow);
    if (!userBatting() || phase === 'play' || phase === 'switch' || phase === 'over') ui.batHelp(false);
    ballMark.visible = !!(pitch && phase === 'flight' && pitch.t < pitch.Tf && (TUNE.assist || !userBatting()));
    if (ballMark.visible) {
      const s = pitch.t / pitch.Tf;
      const k = 2 * s - s * s;
      ballMark.position.set(pitch.A.x + pitch.B.x * k, pitch.A.y + pitch.B.y * k + 4 * pitch.arc * (1 - s) * (1 - s), 0);
      ballMark.scale.setScalar(1 + 2.2 * (1 - s));
    }
  }

  function update(rawDt) {
    if (!started || paused || held) return;
    const dt = rawDt * TUNE.timeScale;
    gt += dt;
    pt += dt;
    if (timer) {
      timer.t -= dt;
      if (timer.t <= 0) {
        const fn = timer.fn;
        timer = null;
        fn();
      }
    }

    if (phase === 'select' && TUNE.auto && pt > 0.3) throwWithMeter(0.75);
    else if (phase === 'meter' && pt >= 1.0) throwWithMeter(0.2);
    else if (phase === 'windup') {
      if (!released && pt >= PITCH.dur * 0.9) release(); // 保险：正常由下面依投球动作的进度放球，这里只防万一没触发
    }
    if (phase === 'flight' && pitch) {
      pitch.t += dt;
      const s = pitch.t / pitch.Tf;
      const { R, A, B, arc } = pitch;
      ball.position.set(
        R.x + (A.x - R.x) * s + B.x * s * s,
        R.y + (A.y - R.y) * s + B.y * s * s + arc * 4 * s * Math.max(0, 1 - s),
        R.z * (1 - s),
      );
      if (aiSwing && aiSwing.type !== 'take' && !pitch.swung && pitch.t >= pitch.Tf - 0.12) {
        pitch.swung = true;
        batter.aimY = pitch.T.y; // 电脑击球员往球的高度挥
        batter.play('swing', 0.34, 'stance');
        sfx.swing();
      }
      // 我方击球且还没挥棒：球到本垒后多等一下，晚一点点按也算数
      const wait = userBatting() && !swing ? GRACE : 0;
      if (pitch.t >= pitch.Tf + wait && !pitch.resolved) resolvePitch();
    }
    if (phase === 'call' && pitch && pitch.hbp) {
      // 触身球：球从身上弹开，落地后滚一小段
      const h = pitch.hbp;
      h.t += dt;
      const air = Math.min(h.t, 0.62);
      const y = Math.max(0.04, h.y + 1.6 * h.t - 4.9 * h.t * h.t);
      ball.position.set(h.x + h.vx * (air + Math.max(0, h.t - air) * 0.3), y, 0.05 - 1.4 * (air + Math.max(0, h.t - air) * 0.3));
    } else if (phase === 'call' && pitch) {
      // 没打到的球继续飞进接手手套
      pitch.t += dt;
      const s = pitch.t / pitch.Tf;
      if (ball.visible && s >= 1.085) {
        ball.visible = false;
        sfx.pop();
      } else if (ball.visible) {
        ball.position.set(pitch.T.x, pitch.T.y + pitch.B.y * (s - 1) * 2, -pitch.R.z * (s - 1));
      }
    }
    if (phase === 'foul' && foul) {
      const s = foul.path[Math.min(foul.path.length - 1, Math.floor(pt / SIM_DT))];
      ball.position.set(s.x, s.y + 0.05, s.z);
    }
    if (phase === 'play' && play) updatePlay(dt);

    if (swap) {
      updateSwap(dt);
      for (const set of fielders) for (const a of Object.values(set)) a.update(dt);
    } else for (const a of Object.values(fielders[fld()])) a.update(dt);
    if (batter) batter.update(dt);
    if (phase !== 'call') hbpFx.stop(); // 保险：流程被打断时不要让反应卡在击球员身上
    hbpFx.update(dt);
    for (const r of runners) r.actor.update(dt);
    ump.update(dt);
    // 投手的状态做在他身上（弯腰喘气、发抖、汗滴、星星），要排在动作更新之后
    armFx.update(pitcher(), { fatigue: fatigue(mound()), rattle: !!mound().rattle, resting: pitcher().pose === 'idle' }, dt);
    // 投手投完球：真人投球会往前跨出半公尺多，动作播完人停在跨步后的位置。接着转身小跑回投手板、再转回来面向本垒
    // （不在动作里把人平移回去：脚没动、人却滑回原位，看起来像在飘）
    {
      const p = pitcher();
      const hips = p && p.group.getObjectByName('mixamorigHips');
      if (p && hips) {
        const g = p.group.position;
        if (p.pose === 'pitch') {
          hips.getWorldPosition(_knuckle);
          const off = { x: _knuckle.x - g.x, z: _knuckle.z - g.z };
          if (!pitchBack || pitchBack.state !== 'pitching') pitchBack = { state: 'pitching', off0: off, off };
          else pitchBack.off = off;
        } else if (pitchBack && pitchBack.state === 'pitching') {
          const dx = pitchBack.off.x - pitchBack.off0.x;
          const dz = pitchBack.off.z - pitchBack.off0.z;
          if (Math.hypot(dx, dz) > 0.15) pitchBack = { state: 'settle', dx, dz, t: 0 };
          else pitchBack = null; // 这套投球动作会自己回到原位
        } else if (pitchBack && pitchBack.state === 'settle') {
          // 动作从投球淡出的这一小段，把人的位置补到跨步后的地方（和淡出同步，才不会跳一下）
          const k = Math.min(dt, SETTLE_T - pitchBack.t) / SETTLE_T;
          g.x += pitchBack.dx * k;
          g.z += pitchBack.dz * k;
          pitchBack.t += dt;
          if (pitchBack.t >= SETTLE_T) {
            pitchBack = { state: 'return' };
            p.face(p.home[0], p.home[1]);
            p.set('run');
          }
        } else if (pitchBack && pitchBack.state === 'return') {
          const dx = p.home[0] - g.x;
          const dz = p.home[1] - g.z;
          const d = Math.hypot(dx, dz);
          const step = 2.2 * dt;
          if (d <= step) {
            g.x = p.home[0];
            g.z = p.home[1];
            p.face(0, 0);
            p.set('idle');
            pitchBack = null;
          } else {
            g.x += (dx / d) * step;
            g.z += (dz / d) * step;
          }
        }
      }
    }
    // 出手前：球握在投手手里。一定要放在球员动画更新之后，不然球会用到上一格的手，慢一格就差十几公分
    if (phase === 'windup' && !released) {
      const hp = pitcherBallPos();
      if (hp) {
        ball.visible = true;
        ball.position.copy(hp);
        // 出手时机：投球动作播到「出手那一格」的进度就放球，球从手当时的位置飞出去。
        // 每套投球动作的出手进度不同（在 Blender 量手的轨迹定出来的，见 player3d.js 的 PITCH.releaseU）
        const p = pitcher();
        if (p.pose === 'pitch' && p.u >= PITCH.releaseU) release(hp);
      }
    }
    updateWidgets();
    updateTouch(dt);
    // 「换投手」按钮：轮到玩家投球、还没开始投、牛棚还有人的时候才出现
    ui.penButton(phase === 'select' && userPitching() && active() && camMode === 'plate' ? mound().pen.length : 0);
  }

  // 触摸：摇杆推多少、准星就以那个速度移动（放开就停）；主按钮的文本跟着目前能做的动作换
  const STICK_SPEED = 1.1; // 推到底时准星每秒移动的距离（公尺）
  function updateTouch(dt) {
    if (!ui.touch) return;
    let label = '';
    if (active() && camMode === 'plate') {
      if (phase === 'select' && !userBatting()) label = '投球';
      else if (phase === 'meter') label = '出手';
      else if (userBatting() && ['select', 'meter', 'set', 'windup', 'flight'].includes(phase)) label = '挥棒';
    }
    ui.touchControls(label);
    const st = ui.stick();
    if (label && phase !== 'meter' && (st.x || st.y)) {
      aim.x = clamp(aim.x + st.x * STICK_SPEED * dt, -0.62, 0.62);
      aim.y = clamp(aim.y + st.y * STICK_SPEED * dt, 0.18, 1.45);
    }
  }

  function start() {
    paused = false;
    band(true); // 开场期间会被设成暂停；第一次开始也要解除，否则进到比赛后不会更新
    if (started) return;
    started = true;
    refresh();
    beginPA();
  }

  // 开场期间先摆好防守与击球员
  resetField();
  spawnBatter();
  for (const a of Object.values(fielders[fld()])) a.update(0);
  batter.update(0);
  ump.update(0);
  widgets.visible = false;
  refresh();

  return {
    S,
    anchors,
    start,
    update,
    // 调试量测：球与投手手掌的位置（验证球有没有握在手上、有没有从手里出去）
    // 调试量测：投手的位置、骨盆与双脚的世界座标（验证投完球后有没有平移滑动）
    debugPitcher: () => {
      const p = pitcher();
      const w = (n) => {
        const b = p.group.getObjectByName(n);
        return b ? b.getWorldPosition(new THREE.Vector3()).toArray() : null;
      };
      return { pose: p.pose, state: pitchBack ? pitchBack.state : '', group: p.group.position.toArray(), hips: w('mixamorigHips'), footL: w('mixamorigLeftFoot'), footR: w('mixamorigRightFoot') };
    },
    debugBall: () => {
      // 用独立的方式取手的位置（手腕骨本身），不经过 pitcherBallPos，才验得出球是不是真的在手上
      const w = pitcher().group.getObjectByName('mixamorigRightHand');
      const h = w ? w.getWorldPosition(new THREE.Vector3()) : null;
      // 球也取世界座标（球放在有垫高的群组里，直接拿 position 比会差一截而看不出来）
      return { phase, released, visible: ball.visible, ball: ball.getWorldPosition(new THREE.Vector3()).toArray(), hand: h ? h.toArray() : null };
    },
    liveCam,
    // 玩家暂停／继续（比赛还没开始或已结束时不能暂停）；回传目前是否暂停
    hold(v) {
      if (!started || S.over || paused) return held;
      held = !!v;
      band(!held);
      return held;
    },
    get held() {
      return held;
    },
    setPaused: (v) => {
      paused = v;
      band(!v);
      if (v) widgets.visible = false;
    },
    get phase() {
      return phase;
    },
    // 测试用：目前这球的飞行进度与进垒点、直接设置光标位置
    debugPitch: () => (pitch ? { s: pitch.t / pitch.Tf, T: pitch.T, Tf: pitch.Tf } : null),
    // DEV：直接演一次触身球
    debugHbp() {
      if (!started || S.over || !batter || !pitch || phase === 'play') return false;
      timer = null;
      pitch.T = { x: -batter.side * 0.62, y: 0.95 };
      ball.visible = true;
      hitByPitch();
      return true;
    },
    debugState: () => ({ phase, aim: { ...aim }, selPitch, userBatting: userBatting() }),
    debugAim(x, y) {
      aim.x = x;
      aim.y = y;
    },
    // DEV：直接触发指定的击球结果
    debugHit(kind) {
      if (!started || S.over || !batter || phase === 'play' || phase === 'post' || phase === 'switch') return;
      timer = null;
      const sp = (Math.random() * 2 - 1) * 30;
      const presets = {
        hr: { ev: 49, la: 29, spray: sp },
        single: { ev: 38, la: 9, spray: sp },
        double: { ev: 44, la: 17, spray: (Math.random() < 0.5 ? -1 : 1) * 24 },
        ground: { ev: 30, la: -6, spray: (Math.random() < 0.5 ? -1 : 1) * 14 },
        fly: { ev: 36, la: 38, spray: sp },
      };
      batter.play('swing', 0.34, 'idle');
      startPlay({ ...presets[kind], q: 0.9 });
    },
    debugBatter() {
      return batter; // DEV：击球姿势微调用的镜头要知道击球员在哪
    },
    debugSwitch() {
      if (!started || S.over) return;
      timer = null;
      play = null;
      switchHalf();
    },
    // DEV：直接设置目前投手的状态（体力、混乱），测试用
    debugArm(o) {
      Object.assign(mound(), o);
      refresh();
      if (Object.keys(o).length && phase === 'select') beginPitch(); // 重新走一次投球前的流程（状态变差会先给特写）
      return { ...mound(), p: mound().p.name, pen: mound().pen.map((x) => x.name) };
    },
    debugPen: () => openBullpen(),
    debugEnd() {
      if (!started || S.over) return;
      timer = null;
      play = null;
      gameOver();
    },
  };
}

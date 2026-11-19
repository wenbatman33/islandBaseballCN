// 投手的状态用肢体表现，不在画面上写字：
//   累了　　慢、沉重——弯腰低头、大口喘气（胸口和肩膀起伏）、汗一直往下滴
//   混乱　　快、慌张——站得直但身体发抖、头左右乱转、头上转着星星和晕眩螺旋
// 两种同时发生时会叠在一起。做法：动作播完之后，再在几根骨头上叠一点旋转（动作本身不改），
// 汗滴、星星、螺旋是跟着头走的小贴图。
import * as THREE from 'three';

const P = 'mixamorig';
const BONES = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm'];

// 用画布画小贴图：汗滴、星星、螺旋
function tex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const T_DROP = tex((g) => {
  g.beginPath();
  g.moveTo(64, 8);
  g.bezierCurveTo(108, 62, 104, 118, 64, 118);
  g.bezierCurveTo(24, 118, 20, 62, 64, 8);
  g.fillStyle = '#bfe9ff';
  g.fill();
  g.lineWidth = 9;
  g.strokeStyle = '#1b3a78';
  g.stroke();
  g.beginPath();
  g.ellipse(50, 78, 9, 16, 0.3, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
});
const T_STAR = tex((g) => {
  g.translate(64, 66);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 22 : 54;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#ffd92e';
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = '#7a3b00';
  g.stroke();
});
const T_SWIRL = tex((g) => {
  g.translate(64, 64);
  g.lineCap = 'round';
  for (const [w, col] of [[18, '#3a1560'], [9, '#ff7ad9']]) {
    g.beginPath();
    for (let a = 0; a < Math.PI * 5.2; a += 0.1) {
      const r = 5 + a * 3.1;
      g[a ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    g.lineWidth = w;
    g.strokeStyle = col;
    g.stroke();
  }
});

const sprite = (map, size) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }));
  s.scale.setScalar(size);
  s.visible = false;
  s.renderOrder = 5;
  return s;
};

export function createArmFx(root) {
  const group = new THREE.Group();
  root.add(group);
  const drops = Array.from({ length: 10 }, () => Object.assign(sprite(T_DROP, 0.16), { life: 0, v: new THREE.Vector3() }));
  const stars = Array.from({ length: 3 }, () => sprite(T_STAR, 0.26));
  const swirl = sprite(T_SWIRL, 0.34);
  // 太阳穴那颗大汗珠：累到一定程度就一直挂着
  const bead = sprite(T_DROP, 0.24);
  group.add(...drops, ...stars, swirl, bead);
  const cache = new WeakMap();
  const head = new THREE.Vector3();
  let t = 0;
  let emit = 0;
  // 目前显示出来的程度（慢慢追上目标，状态一变不会整个人瞬间折下去）
  let kTired = 0;
  let kRattle = 0;

  function bonesOf(actor) {
    let b = cache.get(actor.group);
    if (!b) {
      b = {};
      for (const n of BONES) b[n] = actor.group.getObjectByName(P + n);
      cache.set(actor.group, b);
    }
    return b;
  }

  return {
    /**
     * 每格在投手的动作更新完之后调用。
     * fatigue：疲劳 0～1；rattle：是否混乱；resting：是不是站着等（投球动作中只留一点点，免得把投球姿势弄歪）
     */
    update(actor, { fatigue = 0, rattle = false, resting = true }, dt) {
      t += dt;
      const ease = 1 - Math.pow(0.02, dt);
      kTired += (fatigue * (resting ? 1 : 0.2) - kTired) * ease;
      kRattle += ((rattle ? 1 : 0) * (resting ? 1 : 0.3) - kRattle) * ease;
      const b = bonesOf(actor);
      const show = actor.group.visible && (kTired > 0.02 || kRattle > 0.02);

      if (b.Spine && (kTired > 0.005 || kRattle > 0.005)) {
        // ── 累了：弯腰、低头、喘气 ──
        const bend = kTired * 0.4; // 弯太深脸会被帽檐整个盖住
        const rate = 3.2 + kTired * 5.5; // 越累喘得越急
        const breath = Math.sin(t * rate);
        const amp = kTired * 0.085;
        b.Spine.rotateX(bend * 0.42);
        b.Spine1.rotateX(bend * 0.34 + breath * amp * 0.5);
        b.Spine2.rotateX(bend * 0.24 + breath * amp);
        b.Neck.rotateX(kTired * 0.06);
        b.Head.rotateX(kTired * 0.08 - breath * amp * 0.9); // 头跟着喘气一点一点
        // 肩膀跟着呼吸耸起来、手臂垂得更开
        const lift = (breath * 0.5 + 0.5) * amp * 1.6;
        b.LeftShoulder.rotateZ(-lift);
        b.RightShoulder.rotateZ(lift);
        b.LeftArm.rotateX(kTired * 0.22);
        b.RightArm.rotateX(kTired * 0.22);
        // ── 混乱：发抖、头乱转、身体晃 ──
        if (kRattle > 0.005) {
          const j = kRattle;
          b.Spine.rotateZ(Math.sin(t * 6.1) * 0.07 * j);
          b.Spine1.rotateY(Math.sin(t * 23) * 0.025 * j); // 细碎的发抖
          b.Spine2.rotateZ(Math.sin(t * 27) * 0.02 * j);
          b.Neck.rotateY(Math.sin(t * 4.3) * 0.35 * j);
          b.Head.rotateY(Math.sin(t * 4.3 + 0.6) * 0.4 * j + Math.sin(t * 19) * 0.05 * j); // 东张西望
          b.Head.rotateZ(Math.sin(t * 3.1) * 0.12 * j);
          b.LeftShoulder.rotateZ(-0.12 * j); // 肩膀紧绷耸起
          b.RightShoulder.rotateZ(0.12 * j);
        }
      }

      // ── 头的位置：贴图都跟着头 ──
      if (b.Head) {
        actor.group.updateMatrixWorld(true);
        b.Head.getWorldPosition(head);
        root.worldToLocal(head);
      }
      // 星星与螺旋（混乱）
      const starOn = show && kRattle > 0.25;
      stars.forEach((s, i) => {
        s.visible = starOn;
        if (!starOn) return;
        const a = t * 4.2 + (i / stars.length) * Math.PI * 2;
        s.position.set(head.x + Math.cos(a) * 0.36, head.y + 0.5 + Math.sin(t * 6 + i) * 0.03, head.z + Math.sin(a) * 0.36);
        s.material.rotation = -t * 3 + i;
      });
      swirl.visible = starOn;
      if (starOn) {
        swirl.position.set(head.x, head.y + 0.52, head.z);
        swirl.material.rotation = t * 5;
        swirl.scale.setScalar(0.3 + Math.sin(t * 7) * 0.03);
      }
      // 太阳穴的大汗珠（累了）
      const beadOn = show && kTired > 0.3;
      bead.visible = beadOn;
      if (beadOn) {
        const slide = (t * 0.55) % 1; // 慢慢往下滑、滑到底再从上面冒出来
        bead.position.set(head.x + 0.2, head.y + 0.22 - slide * 0.18, head.z + 0.14);
        bead.material.opacity = Math.min(1, slide * 6, (1 - slide) * 4);
        bead.scale.setScalar(0.16 + kTired * 0.1);
      }
      // 甩出来的汗滴：累了是往下滴，混乱是往两边喷
      emit -= dt;
      const rateHz = kTired * 5 + kRattle * 4;
      if (show && rateHz > 0.3 && emit <= 0) {
        emit = 1 / rateHz;
        const d = drops.find((x) => x.life <= 0);
        if (d) {
          const side = Math.random() < 0.5 ? -1 : 1;
          d.life = 0.75;
          d.position.set(head.x + side * 0.2, head.y + 0.12, head.z + 0.1);
          const spray = kRattle > 0.4 ? 1.5 : 0.35;
          d.v.set(side * (0.25 + Math.random() * spray), 0.5 + Math.random() * (kRattle > 0.4 ? 1.1 : 0.2), (Math.random() - 0.3) * 0.5);
          d.visible = true;
        }
      }
      for (const d of drops) {
        if (d.life <= 0) continue;
        d.life -= dt;
        d.v.y -= 4.6 * dt;
        d.position.addScaledVector(d.v, dt);
        d.material.opacity = Math.min(1, d.life * 4);
        d.material.rotation = Math.atan2(d.v.x, -d.v.y) * 0.6;
        if (d.life <= 0 || !show) {
          d.life = 0;
          d.visible = false;
        }
      }
    },
  };
}

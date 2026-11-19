// 触身球：击球员被球砸到的反应，不写字、用动作演
//   砸到的瞬间　身体一缩、整个人往外弹开半步，砸到的位置爆出一个冲击星
//   接下来　　　弯腰缩着、痛得发抖，头上冒出几道痛的记号
// 做法和投手状态（armfx.js）一样：动作播完之后，再在几根骨头上叠旋转，动作本身不改。
import * as THREE from 'three';

const P = 'mixamorig';
const BONES = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm'];

function tex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// 冲击星：尖刺状的爆炸图案
const T_BANG = tex((g) => {
  g.translate(64, 64);
  g.beginPath();
  for (let i = 0; i < 20; i++) {
    const r = i % 2 ? 26 : 58 - (i % 4 ? 0 : 10);
    const a = (i / 20) * Math.PI * 2;
    g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#fff6b0';
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = 8;
  g.strokeStyle = '#e8372c';
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 14, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
});
// 痛的记号：一道短短的红色斜线
const T_PAIN = tex((g) => {
  g.lineCap = 'round';
  for (const [w, col] of [[30, '#050a20'], [16, '#ff5a3c']]) {
    g.beginPath();
    g.moveTo(64, 16);
    g.lineTo(64, 112);
    g.lineWidth = w;
    g.strokeStyle = col;
    g.stroke();
  }
});

const sprite = (map, size) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false }));
  s.scale.setScalar(size);
  s.visible = false;
  s.renderOrder = 6;
  return s;
};

export function createHbpFx(root) {
  const group = new THREE.Group();
  root.add(group);
  const bang = sprite(T_BANG, 0.6);
  const pains = Array.from({ length: 3 }, () => sprite(T_PAIN, 0.2));
  group.add(bang, ...pains);
  const head = new THREE.Vector3();
  let cur = null; // { actor, away, base, t, at }

  const hide = () => {
    bang.visible = false;
    pains.forEach((p) => (p.visible = false));
  };

  return {
    /** 开始演：actor＝击球员；away＝往外弹开的方向（x 轴，±1）；at＝砸到的位置（root 的座标） */
    hit(actor, away, at) {
      const b = {};
      for (const n of BONES) b[n] = actor.group.getObjectByName(P + n);
      cur = { actor, away, b, base: actor.group.position.clone(), t: 0, at: at.clone() };
    },
    stop() {
      cur = null;
      hide();
    },
    /** 每格在击球员的动作更新完之后调用 */
    update(dt) {
      if (!cur) return;
      const { actor, b } = cur;
      if (!actor.group.parent || !actor.group.visible) return this.stop();
      cur.t += dt;
      const t = cur.t;
      const snap = 1 - Math.exp(-t * 16); // 一瞬间缩起来
      const kick = Math.exp(-t * 7); // 砸到那一下的冲击，很快消掉
      // 整个人往外弹开半步、被砸的瞬间小跳一下
      actor.group.position.set(cur.base.x + cur.away * 0.22 * snap, cur.base.y + Math.sin(Math.min(1, t / 0.28) * Math.PI) * 0.07, cur.base.z);
      if (b.Spine) {
        const shake = Math.sin(t * 34) * 0.03 * snap; // 痛得发抖
        b.Spine.rotateX(0.2 * snap + 0.18 * kick);
        b.Spine1.rotateX(0.18 * snap + shake);
        b.Spine2.rotateX(0.14 * snap);
        b.Spine2.rotateZ(shake);
        b.Neck?.rotateX(0.14 * snap);
        b.Head?.rotateX(0.16 * snap + 0.2 * kick);
        b.Head?.rotateZ(Math.sin(t * 9) * 0.06 * snap);
        // 肩膀耸起、手臂夹紧
        b.LeftShoulder?.rotateZ(-0.2 * snap);
        b.RightShoulder?.rotateZ(0.2 * snap);
        b.LeftArm?.rotateX(0.25 * snap);
        b.RightArm?.rotateX(0.25 * snap);
      }
      // 冲击星：砸到的位置，放大后淡出
      const k = t / 0.38;
      bang.visible = k < 1;
      if (bang.visible) {
        bang.position.copy(cur.at);
        bang.scale.setScalar(0.3 + k * 0.6);
        bang.material.opacity = 1 - k * k;
        bang.material.rotation = 0.4;
      }
      // 痛的记号：头上三道斜线一跳一跳
      if (b.Head) {
        actor.group.updateMatrixWorld(true);
        b.Head.getWorldPosition(head);
        root.worldToLocal(head);
      }
      pains.forEach((p, i) => {
        p.visible = t > 0.12 && !!b.Head;
        if (!p.visible) return;
        const a = (i - 1) * 0.55;
        const pulse = 0.5 + 0.5 * Math.sin(t * 16 + i * 1.3);
        const r = 0.4 + pulse * 0.06;
        p.position.set(head.x + Math.sin(a) * r, head.y + 0.12 + Math.cos(a) * r, head.z);
        p.material.rotation = -a;
        p.scale.set(0.09, 0.2 + pulse * 0.05, 1);
        p.material.opacity = Math.min(1, (t - 0.12) * 8);
      });
    },
  };
}

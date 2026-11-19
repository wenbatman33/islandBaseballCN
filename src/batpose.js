import * as THREE from 'three';

// ── 击球预备姿势微调层 ──
// 动作档播完后再叠一层调整：握点位置、球棒角度、前后手肘方向、蹲低、上身前倾、脚距。
// 用两节 IK 让双手始终握在球棒上、双脚踩在原处。DEV 面板（D 键）即时调整，导出后把数值写回 BATPOSE_DEFAULT。
// 单位：位移是公分、角度是度。全部是 0 时等于没有调整。
// 目前的默认值是用户在 DEV 面板对照职业击球员视频调好、导出后锁定的数值。

export const BATPOSE_DEFAULT = {
  on: true,
  gripPlate: 7.5, // 握点往本垒（+）／往身体（-）
  gripUp: -25, // 握点往上（+）／往下（-）
  gripCatcher: 0, // 握点往接手（+）／往投手（-）
  tiltBack: -25, // 球棒往击球员背后倒（+）／往本垒倒（-）
  tiltCatcher: 10, // 球棒往接手倒（+）／往投手倒（-）
  roll: -8, // 球棒绕自己转
  elbowFront: 2, // 前手肘绕手臂转的角度
  elbowBack: 23, // 后手肘绕手臂转的角度
  crouch: 4, // 重心压低
  lean: 0.5, // 上身往本垒前倾
  spread: -7, // 两脚再分开
  freeze: false, // 定格预备姿势（不晃动，方便对照）
};

const KEY = 'island.batpose';
export const BATPOSE = { ...BATPOSE_DEFAULT };
try {
  Object.assign(BATPOSE, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch {
  /* 读不到就用默认值 */
}
export function saveBatPose() {
  try {
    localStorage.setItem(KEY, JSON.stringify(BATPOSE));
  } catch {
    /* 存不了就算了，只是刷新后会回到缺省 */
  }
}
export function resetBatPose() {
  Object.assign(BATPOSE, BATPOSE_DEFAULT);
  saveBatPose();
}

// 动作档（模型自己的座标）里的方向：击球员面向 -X（本垒），+Y 上，-Z 往接手
const PLATE = new THREE.Vector3(-1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const CATCHER = new THREE.Vector3(0, 0, -1);
const P = 'mixamorig';
const NAMES = ['Hips', 'Spine', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

// 以下都在「模型自己的座标」（inner 的座标系）里算：左击球员的镜射在 inner 上，这样算出的旋转不会被镜射搞乱
function inSpace(inv, obj) {
  return new THREE.Matrix4().multiplyMatrices(inv, obj.matrixWorld);
}
function posOf(inv, obj) {
  return new THREE.Vector3().setFromMatrixPosition(inSpace(inv, obj));
}
function quatOf(inv, obj) {
  inSpace(inv, obj).decompose(_v, _q, _s);
  return _q.clone();
}
// 把骨头的「模型座标」转成父骨头底下的区域座标
function setInSpace(inv, obj, M) {
  const parentM = inSpace(inv, obj.parent);
  _m.copy(parentM).invert().multiply(M);
  const scale = obj.scale.clone();
  _m.decompose(obj.position, obj.quaternion, _s);
  obj.scale.copy(scale);
  obj.updateMatrixWorld(true);
}
// 让骨头在模型座标里多转 q（以骨头自己的位置为轴心）
function rotateBone(inv, bone, q) {
  const parentQ = quatOf(inv, bone.parent);
  const worldQ = quatOf(inv, bone);
  bone.quaternion.copy(parentQ.invert().multiply(q.clone().multiply(worldQ)));
  bone.updateMatrixWorld(true);
}

// 两节 IK：上段 A、下段 B、末端 C 指向目标 T，中间关节往 pole 方向弯
function ik2(inv, A, B, C, T, pole) {
  const a = posOf(inv, A);
  const b = posOf(inv, B);
  const c = posOf(inv, C);
  const L1 = a.distanceTo(b);
  const L2 = b.distanceTo(c);
  const dv = T.clone().sub(a);
  const d = THREE.MathUtils.clamp(dv.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
  const dn = dv.normalize();
  const x = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  const pv = pole.clone().sub(dn.clone().multiplyScalar(pole.dot(dn)));
  if (pv.lengthSq() < 1e-8) pv.copy(UP);
  pv.normalize();
  const e = a.clone().add(dn.clone().multiplyScalar(x)).add(pv.multiplyScalar(h));
  rotateBone(inv, A, new THREE.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(), e.clone().sub(a).normalize()));
  const b2 = posOf(inv, B);
  const c2 = posOf(inv, C);
  const end = a.clone().add(dn.clone().multiplyScalar(d));
  rotateBone(inv, B, new THREE.Quaternion().setFromUnitVectors(c2.sub(b2.clone()).normalize(), end.sub(b2).normalize()));
}

// 关节目前往哪边弯（给 IK 当缺省的弯曲方向）
function bendDir(inv, A, B, C) {
  const a = posOf(inv, A);
  const b = posOf(inv, B);
  const c = posOf(inv, C);
  const ax = c.clone().sub(a).normalize();
  const v = b.clone().sub(a);
  return v.sub(ax.multiplyScalar(v.dot(ax))).normalize();
}

function bonesOf(inner) {
  let B = inner.userData.batBones;
  if (!B) {
    B = {};
    for (const n of NAMES) B[n] = inner.getObjectByName(P + n);
    if (NAMES.some((n) => !B[n])) return null;
    inner.userData.batBones = B;
  }
  return B;
}

// 球棒在 bat 骨头座标里的方向与长度（从球棒网格量，不假设骨头的轴向）
function batInfo(inner, bat) {
  if (inner.userData.batInfo) return inner.userData.batInfo;
  let mesh = null;
  inner.traverse((o) => {
    if (o.name === 'bat_mesh' && o.isSkinnedMesh) mesh = o;
  });
  const info = { axis: new THREE.Vector3(0, 1, 0), len: 0.9 };
  if (mesh) {
    const i = mesh.skeleton.bones.indexOf(bat);
    if (i >= 0) {
      const M = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[i], mesh.bindMatrix);
      const pos = mesh.geometry.attributes.position;
      const v = new THREE.Vector3();
      let best = 0;
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(M);
        if (v.length() > best) {
          best = v.length();
          info.axis.copy(v).normalize();
        }
      }
      info.len = best;
    }
  }
  inner.userData.batInfo = info;
  return info;
}

// 把球棒移到 batNew，双手 IK 回到球棒上原本握的位置（turn：前／后手肘绕手臂转几度）
function moveBat(inv, B, bat, batNew, relL, relR, poles, turnF, turnB) {
  setInSpace(inv, bat, batNew);
  for (const [side, rel, turn] of [['Left', relL, turnF], ['Right', relR, turnB]]) {
    const target = batNew.clone().multiply(rel);
    const T = new THREE.Vector3().setFromMatrixPosition(target);
    const sh = posOf(inv, B[side + 'Arm']);
    const axis = T.clone().sub(sh).normalize();
    const pole = poles[side].clone().applyAxisAngle(axis, turn);
    ik2(inv, B[side + 'Arm'], B[side + 'ForeArm'], B[side + 'Hand'], T, pole);
    target.setPosition(posOf(inv, B[side + 'Hand']));
    setInSpace(inv, B[side + 'Hand'], target);
  }
}

/**
 * 挥棒高度跟着瞄准点：击球前后把双手往下沉、棒头往下压（或往上擡），让球棒甜蜜点经过瞄准的高度。
 * aimY：瞄准点离地高度（公尺，和好球区同一套座标）；w：套用比例（击球那一刻最大）
 */
export function applySwingAim(inner, bat, w, aimY) {
  if (w <= 0 || !bat || aimY == null) return;
  const B = bonesOf(inner);
  if (!B) return;
  inner.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  const bat0 = inSpace(inv, bat);
  const bat0inv = bat0.clone().invert();
  const relL = bat0inv.clone().multiply(inSpace(inv, B.LeftHand));
  const relR = bat0inv.clone().multiply(inSpace(inv, B.RightHand));
  const poles = {
    Left: bendDir(inv, B.LeftArm, B.LeftForeArm, B.LeftHand),
    Right: bendDir(inv, B.RightArm, B.RightForeArm, B.RightHand),
  };
  const info = batInfo(inner, bat);
  const origin = new THREE.Vector3().setFromMatrixPosition(bat0);
  const dir = info.axis.clone().transformDirection(bat0);
  const pivot = new THREE.Vector3().setFromMatrixPosition(bat0.clone().multiply(relL))
    .add(new THREE.Vector3().setFromMatrixPosition(bat0.clone().multiply(relR))).multiplyScalar(0.5);
  // 甜蜜点：离棒头约 17 公分
  const sweet = origin.clone().add(dir.clone().multiplyScalar(info.len - 0.17));
  const target = aimY / Math.max(0.5, inner.scale.y); // 模型座标里的高度（模型有依体型缩放）
  const dh = sweet.y - target; // 正值＝要往下
  const hands = THREE.MathUtils.clamp(dh * 0.35, -0.08, 0.22);
  const reach = sweet.clone().sub(pivot);
  const flat = Math.max(0.2, Math.hypot(reach.x, reach.z));
  const ang = Math.asin(THREE.MathUtils.clamp((dh - hands) / Math.max(0.3, reach.length()), -0.8, 0.8));
  const axis = new THREE.Vector3().crossVectors(dir, UP);
  if (axis.lengthSq() < 1e-6 || flat < 0.2) return;
  axis.normalize();
  const R = new THREE.Matrix4().makeRotationAxis(axis, -ang * w);
  const batNew = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y - hands * w, pivot.z)
    .multiply(R).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)).multiply(bat0);
  moveBat(inv, B, bat, batNew, relL, relR, poles, 0, 0);
}

/**
 * 在动作档的姿势上套用微调。w：套用比例（预备姿势 1；挥棒刚开始时从 1 平顺降到 0）
 */
export function applyBatPose(inner, bat, w) {
  const S = BATPOSE;
  if (!S.on || w <= 0 || !bat) return;
  const B = bonesOf(inner);
  if (!B) return;
  inner.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  const cm = 0.01 * w;
  const deg = THREE.MathUtils.DEG2RAD * w;

  // 先记下原本：球棒、双手相对球棒的位置、双脚
  const bat0 = inSpace(inv, bat);
  const bat0inv = bat0.clone().invert();
  const relL = bat0inv.clone().multiply(inSpace(inv, B.LeftHand));
  const relR = bat0inv.clone().multiply(inSpace(inv, B.RightHand));
  const feet = {
    Left: inSpace(inv, B.LeftFoot),
    Right: inSpace(inv, B.RightFoot),
  };
  const poles = {
    Left: bendDir(inv, B.LeftArm, B.LeftForeArm, B.LeftHand),
    Right: bendDir(inv, B.RightArm, B.RightForeArm, B.RightHand),
    knee: {
      Left: bendDir(inv, B.LeftUpLeg, B.LeftLeg, B.LeftFoot),
      Right: bendDir(inv, B.RightUpLeg, B.RightLeg, B.RightFoot),
    },
  };

  // 1. 身体：压低重心、上身前倾
  if (S.crouch) {
    const hp = inSpace(inv, B.Hips);
    hp.elements[13] -= S.crouch * cm;
    setInSpace(inv, B.Hips, hp);
  }
  if (S.lean) {
    const axis = new THREE.Vector3().crossVectors(UP, PLATE).normalize(); // 绕这个轴，头往本垒那侧倒
    rotateBone(inv, B.Spine, new THREE.Quaternion().setFromAxisAngle(axis, -S.lean * deg));
  }

  // 2. 双脚：踩回原处（再依脚距往两侧分开），膝盖照原本方向弯，脚掌维持原本朝向
  const pitcher = CATCHER.clone().negate();
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const F = feet[side];
    const T = new THREE.Vector3().setFromMatrixPosition(F).add(pitcher.clone().multiplyScalar(sign * S.spread * 0.5 * cm));
    ik2(inv, B[side + 'UpLeg'], B[side + 'Leg'], B[side + 'Foot'], T, poles.knee[side]);
    const FM = F.clone();
    FM.setPosition(posOf(inv, B[side + 'Foot']));
    setInSpace(inv, B[side + 'Foot'], FM);
  }

  // 3. 球棒：以双手中间为轴心转动、再整根移动
  const pivot = new THREE.Vector3().setFromMatrixPosition(bat0.clone().multiply(relL))
    .add(new THREE.Vector3().setFromMatrixPosition(bat0.clone().multiply(relR))).multiplyScalar(0.5);
  const batDir = batInfo(inner, bat).axis.clone().transformDirection(bat0);
  const rot = new THREE.Quaternion()
    .setFromAxisAngle(CATCHER, S.tiltBack * deg)
    .multiply(new THREE.Quaternion().setFromAxisAngle(PLATE, -S.tiltCatcher * deg))
    .multiply(new THREE.Quaternion().setFromAxisAngle(batDir, S.roll * deg));
  const move = PLATE.clone().multiplyScalar(S.gripPlate * cm)
    .add(UP.clone().multiplyScalar(S.gripUp * cm))
    .add(CATCHER.clone().multiplyScalar(S.gripCatcher * cm));
  const R = new THREE.Matrix4().makeRotationFromQuaternion(rot);
  const batNew = new THREE.Matrix4().makeTranslation(pivot.x + move.x, pivot.y + move.y, pivot.z + move.z)
    .multiply(R).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)).multiply(bat0);
  moveBat(inv, B, bat, batNew, relL, relR, poles, S.elbowFront * deg, S.elbowBack * deg);
}

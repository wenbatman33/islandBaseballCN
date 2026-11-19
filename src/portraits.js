import * as THREE from 'three';
import { makePlayer } from './player3d.js';

// 用同一套 3D 球员模型渲染头像，写进每位球员的 face 字段
export function renderPortraits(game) {
  const SIZE = 220;
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(SIZE, SIZE, false);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a7a6a', 1.7));
  const key = new THREE.DirectionalLight('#fff1dc', 2.4);
  key.position.set(1.6, 2.2, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#bcd6ff', 1.2);
  rim.position.set(-2.5, 1.5, -2);
  scene.add(rim);

  const cam = new THREE.PerspectiveCamera(25, 1, 0.1, 20);
  cam.position.set(0.2, 1.7, 1.45); // 新模型（身高 1.9 m、头比较小）的头和肩膀
  cam.lookAt(0, 1.63, 0);

  for (const team of [game.away, game.home]) {
    for (const p of [...team.lineup, team.sp, ...(team.rp || [])]) {
      const g = makePlayer({ ...team.kit, skin: p.skin, hair: p.hair, no: p.no, name: p.name, look: p.look, flat: true });
      g.rotation.y = -0.25;
      scene.add(g);
      r.render(scene, cam);
      p.face = r.domElement.toDataURL('image/png');
      scene.remove(g); // 几何与材质是所有球员共用的，不在这里释放
    }
  }
  r.dispose();
  r.forceContextLoss();
}


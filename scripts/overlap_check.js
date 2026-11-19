// 重叠侦测：文本对文本、文本对面板／按钮、面板对面板；也回报超出画面的文本
window.__ov = function () {
  const vis = (el) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = getComputedStyle(e);
      if (c.display === 'none' || c.visibility === 'hidden') return false;
      o *= parseFloat(c.opacity);
    }
    return o > 0.15;
  };
  const name = (el) => (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.id ? '#' + el.id : el.tagName);
  const items = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || !vis(el)) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const b of r.getClientRects()) {
      if (b.width < 3 || b.height < 3) continue;
      const pad = b.height * 0.2; // 行高的上下留白不算
      items.push({ el, t: '「' + n.nodeValue.trim().slice(0, 12) + '」' + name(el), x: b.left, y: b.top + pad, r: b.right, b: b.bottom - pad });
    }
  }
  document.querySelectorAll('body *').forEach((el) => {
    if (el.tagName === 'CANVAS') return;
    const c = getComputedStyle(el);
    const solid = el.tagName === 'BUTTON' || el.tagName === 'IMG' || c.borderImageSource !== 'none' || (c.backgroundImage !== 'none' && !/gradient\(.*transparent/.test(c.backgroundImage) && el.tagName !== 'I');
    if (!solid || !vis(el)) return;
    const b = el.getBoundingClientRect();
    if (b.width < 6 || b.height < 6) return;
    if (b.width * b.height > innerWidth * innerHeight * 0.45) return;
    if (c.pointerEvents === 'none' && c.borderImageSource === 'none' && el.tagName !== 'IMG') return;
    items.push({ el, t: '[' + name(el) + ']', x: b.left, y: b.top, r: b.right, b: b.bottom, box: 1 });
  });
  const out = new Set();
  const off = new Set();
  for (const a of items) if (!a.box && (a.x < -1 || a.y < -3 || a.r > innerWidth + 1 || a.b > innerHeight + 3)) off.add(a.t);
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], c = items[j];
      if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
      if (a.box && c.box) {
        // 面板对面板：只看互不相属的两个大区块
        const la = a.el.closest('[data-lay]'), lc = c.el.closest('[data-lay]');
        if (!la || !lc || la === lc) continue;
      } else if (a.box || c.box) {
        // 文本对面板：同一个面板里的装饰图不算
        const la = a.el.closest('[data-lay]'), lc = c.el.closest('[data-lay]');
        if (la && la === lc) continue;
      }
      const ox = Math.min(a.r, c.r) - Math.max(a.x, c.x), oy = Math.min(a.b, c.b) - Math.max(a.y, c.y);
      if (ox > 2 && oy > 2) out.add(a.t + ' ↔ ' + c.t);
    }
  return { overlap: [...out], off: [...off] };
};
// 连续采样一段时间，回传不重复的结果
window.__scan = async function (sec = 6, step = 600) {
  const o = new Set(), f = new Set();
  for (let t = 0; t < sec * 1000; t += step) {
    const r = window.__ov();
    r.overlap.forEach((x) => o.add(x));
    r.off.forEach((x) => f.add(x));
    await new Promise((r) => setTimeout(r, step));
  }
  return { size: innerWidth + 'x' + innerHeight, overlap: [...o].slice(0, 60), off: [...f].slice(0, 30) };
};
// 比赛中各种状态跑一轮：选球、牛棚、各种判定字卡、换边击球、赛后
window.__tour = async function () {
  const zz = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const g = window.__game;
  const add = async (k, sec) => { const r = await window.__scan(sec); out[k] = { overlap: r.overlap, off: r.off }; };
  await add('intro', 9);
  document.querySelector('.ib-skip')?.click();
  await zz(2500);
  await add('pitching', 5);
  g.debugArm({ energy: 8, rattle: 2 });
  await zz(3200);
  await add('tired', 2);
  g.debugPen();
  await zz(800);
  await add('bullpen', 1.2);
  document.querySelector('.bp-cancel')?.click();
  await zz(800);
  for (const k of ['hr', 'single', 'ground', 'fly']) { try { g.debugHit(k); } catch (e) { out['err_' + k] = String(e); } await add('hit_' + k, 3.5); }
  g.debugSwitch();
  await zz(1500);
  await add('batting', 8);
  out.size = innerWidth + 'x' + innerHeight;
  return JSON.stringify(out).replace(/data:[^\]"]+/g, 'data');
};

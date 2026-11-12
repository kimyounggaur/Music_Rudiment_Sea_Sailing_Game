'use strict';
/*
 * 그림자·반사 패스의 삼각형 기여자를 항목별로 뽑는다(RM6 5.12절 예산 추적).
 *   node rm6-casters.cjs [--points 0,3,7] [--top 14]
 * 그림자: visible && castShadow && layers.test(main camera) 인 메시
 * 반사:   visible && layers.isEnabled(PIPELINE_LAYER) && 불투명 메시(대역 포함)
 * 삼각형 = (색인 수 또는 정점 수)/3 × 인스턴스 수. 부모 사슬의 이름으로 묶는다. 프러스텀은 따지지 않는 상한 값이다.
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const wanted = arg('points', '0,3,7').split(',').map(Number), top = Number(arg('top', '14'));
(async () => {
  const { browser, page, errors } = await open({ query: '?qa=1', width: 1280, height: 720 });
  await startSailing(page);
  await page.evaluate(async () => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    if (g.remaster && g.remaster.start) { try { await g.remaster.start(); } catch (e) {} }
    a.vfxQa.setTimeOfDay(0.25); g.applyQualityProfile('mid', false);
  });
  const result = [];
  for (const p of POINTS.filter((p) => wanted.includes(p.id))) {
    await teleport(page, p, { settle: 8 });
    const r = await page.evaluate(({ top }) => {
      const g = window.__OCEAN_GAME__, scene = g.world.scene, cam = g.camera;
      const label = (o) => { const chain = []; for (let n = o; n && n !== scene; n = n.parent) chain.push(n.name || n.type); return chain.slice(0, 3).join('<'); };
      const tris = (o) => { const geo = o.geometry; if (!geo) return 0; const per = geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0); return per * (o.isInstancedMesh ? o.count : 1); };
      const alive = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
      const sh = new Map(), rf = new Map();
      scene.traverse((o) => {
        if (!o.isMesh || !alive(o)) return;
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!mat || mat.visible === false) return;
        if (o.castShadow && o.layers.test(cam.layers)) { const k = label(o); const e = sh.get(k) || { calls: 0, tris: 0 }; e.calls++; e.tris += tris(o); sh.set(k, e); }
        if (((o.layers.mask & 2) !== 0) && !mat.transparent && mat.blending !== 2) { const k = label(o); const e = rf.get(k) || { calls: 0, tris: 0 }; e.calls++; e.tris += tris(o); rf.set(k, e); }
      });
      const rows = (m) => [...m.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.tris - a.tris).slice(0, top);
      const sum = (m) => [...m.values()].reduce((s, v) => ({ calls: s.calls + v.calls, tris: s.tris + v.tris }), { calls: 0, tris: 0 });
      return { region: g.currentRegion, shadow: { total: sum(sh), top: rows(sh) }, reflection: { total: sum(rf), top: rows(rf) } };
    }, { top });
    r.point = p.name; result.push(r);
    console.log(`\n== ${p.name} region ${r.region}  shadow ${r.shadow.total.calls}c/${Math.round(r.shadow.total.tris)}t  reflection(상한) ${r.reflection.total.calls}c/${Math.round(r.reflection.total.tris)}t`);
    console.log(' 그림자'); r.shadow.top.forEach((e) => console.log('   ', String(Math.round(e.tris)).padStart(7), String(e.calls).padStart(3) + 'c', e.k));
    console.log(' 반사'); r.reflection.top.forEach((e) => console.log('   ', String(Math.round(e.tris)).padStart(7), String(e.calls).padStart(3) + 'c', e.k));
  }
  fs.writeFileSync(outPath('rm6-casters.json'), JSON.stringify({ result, errors }, null, 1));
  console.log('errors', JSON.stringify(errors.slice(0, 4)));
  await browser.close();
})();

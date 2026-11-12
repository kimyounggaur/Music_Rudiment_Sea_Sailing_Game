'use strict';
/*
 * 고정 촬영 지점에서 렌더 통계를 잰다.
 *  - 옛 방식: renderer.info.autoReset = true 상태에서 render() 한 번 -> 마지막 패스(본 패스)만 센다
 *  - 새 방식: RenderStats 패스별 합계(그림자·반사·본·후처리)
 *   node render-stats.cjs [--base URL] [--quality low|mid|high] [--out file.json] [--viewport 1280x720] [--query ?qa=1] [--points 0,3,7]
 * 새 방식이 없는 옛 빌드에서는 옛 방식 값만 낸다.
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', undefined), quality = arg('quality', 'mid'), out = arg('out', '');
const [w, h] = arg('viewport', '1280x720').split('x').map(Number);
const query = arg('query', '?qa=1');
const wanted = arg('points', '0,1,2,3,4,5,6,7,8').split(',').map(Number);
(async () => {
  const { browser, page, errors } = await open({ base, query, width: w, height: h });
  await startSailing(page);
  await page.evaluate(async (quality) => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    if (g.remaster && g.remaster.start) { try { await g.remaster.start(); } catch (e) {} }
    if (a.vfxQa && a.vfxQa.setTimeOfDay) a.vfxQa.setTimeOfDay(0.25);
    g.applyQualityProfile(quality, false);
  }, quality);
  const rows = [];
  for (const p of POINTS.filter((p) => wanted.includes(p.id))) {
    await teleport(page, p, { settle: 8 });
    await page.evaluate(() => window.__OCEAN_API__.vfxQa && window.__OCEAN_API__.vfxQa.settle && window.__OCEAN_API__.vfxQa.settle());
    await frames(page, 3);
    // RM6: 이 지점의 해역 랜드마크(비동기 로드)가 올라오거나 실패로 확정될 때까지 기다린 뒤 잰다. 상태도 함께 남긴다.
    let lm = null;
    for (const t0 = Date.now(); Date.now() - t0 < 60000;) {
      lm = await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, l = g.remaster && g.remaster.landmarks;
        if (!l) return { ok: true, none: true };
        const e = l.entries.find((x) => x.spec.region === g.currentRegion), done = (x) => x === 'ready' || x === 'failed';
        return { ok: !e || e.stage === 'none' || (done(e.far.status) && (e.stage === 'far' || done(e.near.status))), id: e && e.spec.id, stage: e && e.stage, far: e && e.far.status, near: e && e.near.status, nearVisible: Boolean(e && e.near.root && e.near.root.visible) };
      });
      if (lm.ok) break;
      await frames(page, 3);
    }
    await frames(page, 3);
    const r = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, info = g.renderer.info;
      const prev = info.autoReset;
      info.autoReset = true;
      g.renderer.render(g.world.scene, g.camera); // 옛 방식: 그림자 패스는 자동 초기화로 사라진다
      const old = { calls: info.render.calls, triangles: info.render.triangles };
      info.autoReset = prev;
      const res = { region: g.currentRegion, old, programs: info.programs ? info.programs.length : null, geometries: info.memory.geometries, textures: info.memory.textures };
      if (g.renderStats) { g.renderFrame(); res.passes = g.renderStats.snapshot(); }
      return res;
    });
    r.point = p.name;
    r.landmark = lm;
    rows.push(r);
    console.log(p.name.padEnd(13), 'region', r.region, 'old', r.old.calls + '/' + r.old.triangles, r.passes ? 'new total ' + r.passes.total.calls + '/' + r.passes.total.triangles + ' (S ' + r.passes.shadow.triangles + ' R ' + r.passes.reflection.triangles + ' M ' + r.passes.main.triangles + ' P ' + r.passes.post.triangles + ')' : '');
  }
  if (out) fs.writeFileSync(out, JSON.stringify({ base: base || 'default', quality, viewport: [w, h], rows }, null, 1));
  console.log('errors', JSON.stringify(errors.slice(0, 4)));
  await browser.close();
})();

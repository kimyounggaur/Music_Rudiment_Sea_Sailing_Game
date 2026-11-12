'use strict';
/*
 * RM3 첫 확인: 파이프라인이 돌고 있는지, 반사·후처리 패스가 잡히는지, 오류가 없는지.
 *   node rm3-smoke.cjs [--q mid] [--fx full] [--point 0] [--shot name.png] [--w 1280 --h 720]
 */
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const quality = arg('q', 'mid'), fx = arg('fx', 'full'), pointId = Number(arg('point', '0')), shot = arg('shot', '');
const W = Number(arg('w', '1280')), H = Number(arg('h', '720'));
(async () => {
  const { browser, page, errors } = await open({ width: W, height: H });
  await startSailing(page);
  await page.evaluate(({ quality, fx }) => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
    g.applyQualityProfile(quality, false);
    a.remasterQa.setFx(fx);
  }, { quality, fx });
  await teleport(page, POINTS.find((p) => p.id === pointId), { settle: 30 });
  await frames(page, 20);
  const info = await page.evaluate(() => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, r = g.renderer;
    return {
      pipeline: a.remasterQa.pipeline(),
      passes: a.remasterQa.passes(),
      programs: r.info.programs.length,
      textures: r.info.memory.textures,
      geometries: r.info.memory.geometries,
      defines: g.atmosphere.waterMaterial.defines,
      dpr: r.getPixelRatio(),
      size: r.getSize(new window.THREE.Vector2()).toArray(),
      tone: a.remasterQa.tone(),
    };
  });
  console.log(JSON.stringify(info, (k, v) => (k === 'reflectionSet' ? (v || []).length + ' entries' : v)));
  if (shot) await page.screenshot({ path: outPath(shot) });
  console.log('errors', JSON.stringify(errors.slice(0, 8)));
  await browser.close();
})();

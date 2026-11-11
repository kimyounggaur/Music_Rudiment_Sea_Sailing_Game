'use strict';
/*
 * RM3 캡처 18장: 무드 3종(dawn r0, deep r3, aurora r7) × 의미 있는 품질·fx 6조합.
 *   node capture-rm3.cjs [--label after] [--w 1280 --h 720] [--k 1]
 * 이름: rm_RM3_{무드}_{품질}_{fx}_{w}x{h}_{label}.png  (HUD 숨김, 점등 계수 고정)
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const label = arg('label', 'after'), W = Number(arg('w', '1280')), H = Number(arg('h', '720')), K = Number(arg('k', '1'));
const MOODS = [{ mood: 'dawn', id: 0 }, { mood: 'deep', id: 3 }, { mood: 'aurora', id: 7 }];
const COMBOS = [['low', 'auto'], ['low', 'off'], ['mid', 'off'], ['mid', 'lite'], ['mid', 'full'], ['high', 'full']];
const HIDE = '#qa-hud{display:none!important} body.nohud .hud, body.nohud #control-layer, body.nohud .minimap-panel, body.nohud #world-labels, body.nohud #objective-chip, body.nohud #help-strip, body.nohud #game-toast, body.nohud #caption-strip, body.nohud #region-banner, body.nohud #remaster-region-art, body.nohud .collect-counter, body.nohud .action-cluster, body.nohud #effect-cue{display:none!important}';
(async () => {
  const { browser, page, errors } = await open({ width: W, height: H });
  await startSailing(page);
  await page.evaluate((css) => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); document.body.classList.add('nohud'); window.__OCEAN_GAME__.atmosphere.forceK = null; }, HIDE);
  await page.evaluate((k) => { window.__OCEAN_GAME__.atmosphere.forceK = k; }, K);
  const rows = [], files = [];
  for (const { mood, id } of MOODS) {
    const p = POINTS.find((x) => x.id === id);
    for (const [q, fx] of COMBOS) {
      await page.evaluate(({ q, fx }) => { const g = window.__OCEAN_GAME__; g.applyQualityProfile(q, false); window.__OCEAN_API__.remasterQa.setFx(fx); }, { q, fx });
      await teleport(page, p, { settle: 14 });
      await page.evaluate(() => { const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__; a.vfxQa.settle(); g.atmosphere.refresh(g.simTime, g.motion.x, g.motion.z); });
      await frames(page, 4);
      const info = await page.evaluate(() => { const a = window.__OCEAN_API__, p = a.remasterQa.pipeline(), s = a.remasterQa.passes(); return { plan: p.plan, targets: p.targetCount, calls: { reflection: s.reflection.calls, main: s.main.calls, post: s.post.calls }, tone: a.remasterQa.tone() }; });
      const file = outPath(`rm_RM3_${mood}_${q}_${fx}_${W}x${H}_${label}.png`);
      await page.screenshot({ path: file });
      files.push(file);
      rows.push({ mood, q, fx, ...info });
      console.log(mood.padEnd(6), q.padEnd(4), fx.padEnd(5), 'passes', info.plan.passes, 'targets', info.targets, 'calls', JSON.stringify(info.calls), 'canvasTone', JSON.stringify(info.tone));
    }
  }
  fs.writeFileSync(outPath('rm3-captures.json'), JSON.stringify({ viewport: [W, H], k: K, rows, files, errors: errors.slice(0, 8) }, null, 1));
  console.log('written', files.length, 'errors', JSON.stringify(errors.slice(0, 8)));
  await browser.close();
})();

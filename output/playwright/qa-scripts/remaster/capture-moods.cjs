'use strict';
/*
 * RM1 무드 캡처: 9개 해역 × 점등(k=1)·미점등(k=0.35) × 뷰포트.
 *   node capture-moods.cjs --label after [--viewports 1440x900,390x844] [--ks 1,0.35] [--points 0,1,...] [--hud 0]
 * 이름: rm_RM1_{지점}_k{k}_{w}x{h}_{label}.png
 */
const fs = require('fs');
const path = require('path');
const { open, frames, startSailing, teleport, POINTS } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const label = arg('label', 'after'), stage = arg('stage', 'RM1');
const viewports = arg('viewports', '1440x900,390x844').split(',').map((v) => v.split('x').map(Number));
const ks = arg('ks', '1,0.35').split(',').map(Number);
const wanted = arg('points', '0,1,2,3,4,5,6,7,8').split(',').map(Number);
const hud = arg('hud', '0') === '1';
const dir = arg('dir', 'output/playwright');
const settle = Number(arg('settle', '8'));
const HIDE = '#qa-hud{display:none!important} body.nohud .hud, body.nohud #control-layer, body.nohud .minimap-panel, body.nohud #world-labels, body.nohud #objective-chip, body.nohud #help-strip, body.nohud #game-toast, body.nohud #caption-strip, body.nohud #region-banner, body.nohud #remaster-region-art, body.nohud .collect-counter, body.nohud .action-cluster, body.nohud #effect-cue{display:none!important}';
(async () => {
  const { browser, page, errors } = await open({ width: viewports[0][0], height: viewports[0][1] });
  await startSailing(page);
  await page.evaluate((css) => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }, HIDE);
  if (!hud) await page.evaluate(() => document.body.classList.add('nohud'));
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [w, h] of viewports) {
    await page.setViewportSize({ width: w, height: h });
    await frames(page, 6);
    for (const k of ks) {
      await page.evaluate((k) => { window.__OCEAN_GAME__.atmosphere.forceK = k; }, k);
      for (const p of POINTS.filter((p) => wanted.includes(p.id))) {
        await teleport(page, p, { settle });
        await page.evaluate(() => { const a = window.__OCEAN_API__; if (a.vfxQa && a.vfxQa.settle) a.vfxQa.settle(); window.__OCEAN_GAME__.atmosphere.refresh(window.__OCEAN_GAME__.simTime, window.__OCEAN_GAME__.motion.x, window.__OCEAN_GAME__.motion.z); });
        await frames(page, 3);
        const file = path.join(dir, `rm_${stage}_${p.name}_k${k}_${w}x${h}_${label}.png`);
        await page.screenshot({ path: file });
        written.push(file);
      }
    }
  }
  console.log(JSON.stringify({ written: written.length, errors: errors.slice(0, 8) }));
  await browser.close();
})();

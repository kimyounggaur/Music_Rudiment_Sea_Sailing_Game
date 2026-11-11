'use strict';
/*
 * 고정 촬영 지점 캡처 (설계서 9.0절).
 *   node capture-points.cjs --stage RM0 --label before --mood legacy --base http://127.0.0.1:8766
 * 옵션: --viewports 1440x900,390x844  --points 0,1,2  --nohud 1(1440 폭에서 HUD 숨김판도 함께)  --phase 0.25(옛 낮밤 위상)
 *       --query "?qa=1"  --lit 1(점등 상태 준비)  --dir output/playwright
 * 이름: rm_RM{단계}_{지점}_{무드}_scale{글자배율}_{폭}x{높이}_{before|after}.png
 */
const fs = require('fs');
const path = require('path');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const stage = arg('stage', 'RM0'), label = arg('label', 'after'), mood = arg('mood', 'legacy');
const base = arg('base', undefined);
const viewports = arg('viewports', '1440x900,390x844').split(',').map((v) => v.split('x').map(Number));
const wanted = arg('points', '0,1,2,3,4,5,6,7,8').split(',').map(Number);
const nohud = arg('nohud', '1') === '1';
const phase = Number(arg('phase', '0.25'));
const query = arg('query', '?qa=1');
const dir = arg('dir', 'output/playwright');
const textScale = arg('textscale', '1');
const settle = Number(arg('settle', '10'));
const HIDE_HUD = '#qa-hud{display:none!important} body.nohud .hud, body.nohud #control-layer, body.nohud .minimap-panel, body.nohud #world-labels, body.nohud #objective-chip, body.nohud #help-strip, body.nohud #game-toast, body.nohud #caption-strip, body.nohud #region-banner, body.nohud #remaster-region-art, body.nohud .collect-counter, body.nohud .action-cluster, body.nohud #effect-cue{display:none!important}';

(async () => {
  const { browser, page, errors, requests } = await open({ base, query, width: viewports[0][0], height: viewports[0][1] });
  await startSailing(page);
  await page.evaluate(async (phase) => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    if (g.remaster && g.remaster.start) { try { await g.remaster.start(); } catch (e) {} }
    if (a.vfxQa && a.vfxQa.setTimeOfDay) a.vfxQa.setTimeOfDay(phase);
  }, phase);
  await page.evaluate((css) => { const st = document.createElement('style'); st.id = 'rm-hide'; st.textContent = css; document.head.appendChild(st); }, HIDE_HUD);
  const written = [];
  for (const [w, h] of viewports) {
    await page.setViewportSize({ width: w, height: h });
    await frames(page, 6);
    for (const p of POINTS.filter((p) => wanted.includes(p.id))) {
      await teleport(page, p, { settle });
      await page.evaluate(() => { const a = window.__OCEAN_API__; if (a.vfxQa && a.vfxQa.settle) a.vfxQa.settle(); });
      await frames(page, 3);
      const file = (suffix) => path.join(dir, `rm_${stage}_${p.name}${suffix}_${mood}_scale${textScale}_${w}x${h}_${label}.png`);
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: file('') });
      written.push(file(''));
      if (nohud && w >= 1000) {
        await page.evaluate(() => document.body.classList.add('nohud'));
        await frames(page, 2);
        await page.screenshot({ path: file('-nohud') });
        written.push(file('-nohud'));
        await page.evaluate(() => document.body.classList.remove('nohud'));
      }
    }
  }
  console.log(JSON.stringify({ written: written.length, errors: errors.slice(0, 6), externalRequests: requests }));
  await browser.close();
})();

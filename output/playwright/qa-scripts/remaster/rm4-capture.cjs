'use strict';
/*
 * RM4 보조 캡처: 해역 표제 카드(보이는 구간 고정), 타이틀 세로 화면, 조타 구도 9지점 HUD 숨김판.
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm4-capture.cjs [--only A,B,C]
 *   A 해역 표제 카드: 1280×720, 390×844 (카드가 hold 구간 한가운데에 오도록 시작 시각을 맞춰 촬영)
 *   B 타이틀: 390×844 (세로) 3D 전환 뒤
 *   C 조타 구도 9지점(HUD 숨김, 1280×720)과 휘도 시트
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const only = String(arg('only', 'A,B,C')).split(',').map((s) => s.trim().toUpperCase());
const HIDE = '#qa-hud{display:none!important} body.nohud .hud, body.nohud #control-layer, body.nohud .minimap-panel, body.nohud #world-labels, body.nohud #objective-chip, body.nohud #help-strip, body.nohud #game-toast, body.nohud #caption-strip, body.nohud #region-banner, body.nohud #remaster-region-art, body.nohud .collect-counter, body.nohud .action-cluster, body.nohud #effect-cue{display:none!important}';
const out = {};

(async () => {
  if (only.includes('A')) {
    for (const [w, h] of [[1280, 720], [390, 844]]) {
      const { browser, page, errors } = await open({ width: w, height: h });
      await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => { window.__OCEAN_GAME__.audio.setMuted(true); const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; });
      await page.click('#start-sailing');
      await page.waitForFunction(() => document.getElementById('region-banner').dataset.phase === 'hold', null, { timeout: 15000 });
      // 느린 프레임에서도 카드가 사라지기 전에 찍도록 hold 한가운데로 시각을 되돌린 뒤 바로 찍는다
      const info = await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, b = document.getElementById('region-banner');
        g.ux.cardStart = performance.now() - 1700;
        const cs = getComputedStyle(b), r = b.getBoundingClientRect();
        return { phase: b.dataset.phase, opacity: cs.opacity, rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v)), text: b.innerText.replace(/\s+/g, ' ').trim(), hidden: b.hidden };
      });
      await page.screenshot({ path: outPath(`rm_RM4_region_card_${w}x${h}_after.png`) });
      out[`card_${w}x${h}`] = { ...info, errors: errors.slice(0, 3) };
      console.log('A', w, h, JSON.stringify(out[`card_${w}x${h}`]));
      await browser.close();
    }
  }
  if (only.includes('B')) {
    const { browser, page, errors } = await open({ width: 390, height: 844 });
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('title-overlay').classList.contains('title-live'), null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; });
    await page.screenshot({ path: outPath('rm_RM4_title_live_390x844_after.png') });
    out.title_390 = { errors: errors.slice(0, 3) };
    console.log('B', JSON.stringify(out.title_390));
    await browser.close();
  }
  if (only.includes('C')) {
    const { browser, page, errors } = await open({ width: 1280, height: 720 });
    await startSailing(page);
    await page.evaluate((css) => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); document.body.classList.add('nohud'); window.__OCEAN_GAME__.atmosphere.forceK = 1; }, HIDE);
    const files = [];
    for (const p of POINTS) {
      await teleport(page, p, { settle: 12 });
      await page.evaluate(() => { const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__; if (a.vfxQa && a.vfxQa.settle) a.vfxQa.settle(); g.atmosphere.refresh(g.simTime, g.motion.x, g.motion.z); a.cameraQa.noteInput(); });
      await frames(page, 3);
      const f = outPath(`rm_RM4_steer_${p.name}_1280x720_after.png`);
      await page.screenshot({ path: f });
      files.push(f);
    }
    out.points = { files: files.length, errors: errors.slice(0, 5) };
    console.log('C', JSON.stringify(out.points));
    await browser.close();
  }
  fs.writeFileSync(outPath('rm4-capture.json'), JSON.stringify(out, null, 1));
})();

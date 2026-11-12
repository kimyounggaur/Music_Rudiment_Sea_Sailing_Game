'use strict';
/*
 * RM4 보조 캡처: 점등 연출의 "검은 띠가 덮인 장면"과 "표제가 뜬 장면"을 시각을 고정해 촬영한다.
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm4-lighthouse-capture.cjs [--region 1] [--w 1280 --h 720] [--reduced]
 * 소프트웨어 렌더는 한 프레임이 0.5~1초라 6초 연출 안에서 원하는 순간에 찍기 어렵다.
 * 그래서 연출 시작 시각(ux.lighthouseStarted)을 매 프레임 "지금 − 고정 시간"으로 잡아 시간표의 한 순간에 멈춘다.
 * 점등 곡선(게임 시간 기준)은 같은 방식으로 해당 순간의 진행에 맞춘다. 카메라는 그 순간의 목표 자세로 즉시 놓는다.
 */
const fs = require('fs');
const { open, frames, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const region = Number(arg('region', '1'));
const W = Number(arg('w', '1280')), H = Number(arg('h', '720'));
const reduced = process.argv.includes('--reduced');
const tag = reduced ? '_reduced' : '';

(async () => {
  const { browser, page, errors } = await open({ width: W, height: H });
  await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
  await page.click('#start-sailing');
  await page.waitForTimeout(1500);
  await page.evaluate(({ region, reduced }) => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    g.audio.setMuted(true);
    a.questQa.prepare(region);
    g.applyReducedMotion(reduced);
    const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
    a.cameraQa.snap();
    g.startRegionTrial(region);
  }, { region, reduced });
  await page.waitForTimeout(800);
  // 시련을 통과 처리해 점등 연출을 시작한다(문제 풀이는 rm4-trials.cjs가 따로 확인한다)
  await page.evaluate(() => { window.__OCEAN_GAME__.finishTrialPass(); });
  await frames(page, 2);
  const pinTo = async (ms, name, plan) => {
    await page.evaluate(({ ms, region, plan }) => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
      window.__pinMs = ms;
      if (!window.__pinLoop) {
        window.__pinLoop = true;
        const f = () => {
          const now = performance.now();
          if (window.__pinMs !== null) {
            g.ux.lighthouseStarted = now - window.__pinMs;
            g.lighthouseEventUntil = now + 60000;
            const ev = g.atmosphere.lightEvents.get(region);
            if (ev) ev.start = g.simTime - (window.__pinMs / 1000 - plan.delay);
          }
          requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }
      a.cameraQa.snap();
    }, { ms, region, plan });
    await frames(page, 6);
    const info = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, root = document.getElementById('lighthouse-event'), snap = a.cameraQa.snapshot();
      return { bars: root.dataset.bars, title: root.dataset.title, hidden: root.hidden, mode: snap.mode, lit: +g.atmosphere.regionLit[g.ux.lighthouseRegion].toFixed(3), k: +g.atmosphere.k.toFixed(3), fov: snap.fov, state: g.constructor && window.MODE ? window.MODE.current : null };
    });
    await page.screenshot({ path: outPath(name) });
    return info;
  };
  const plan = reduced ? { delay: 0.2, duration: 1 } : { delay: 1, duration: 3 };
  const out = {};
  const stills = reduced ? [[900, 'bars'], [1400, 'title']] : [[1500, 'bars'], [4600, 'title']];
  for (const [ms, label] of stills) {
    out[label] = { pinMs: ms, ...(await pinTo(ms, `rm_RM4_lighthouse_${label}${tag}_${W}x${H}_after.png`, plan)) };
    console.log(label, JSON.stringify(out[label]));
  }
  out.errors = errors.slice(0, 5);
  fs.writeFileSync(outPath(`rm4-lighthouse-capture${tag}.json`), JSON.stringify(out, null, 1));
  await browser.close();
})();

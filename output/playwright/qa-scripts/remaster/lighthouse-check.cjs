'use strict';
/*
 * RM1: 점등 연출의 k 곡선과 밤 무드 효과 확인.
 *  - 5번 해역(푸른 시간)에서 점등 이벤트 시 해역 k가 1.0초 뒤 올라 4.0초에 1이 된다.
 *  - 건너뛰기(completeLights)는 즉시 k=1.
 *  - 반딧불(night_fireflies)이 밤 무드 해역(5번)에서 자동으로 나온다.
 *  - 광선(lighthouseBeam)이 보인다.
 * 설정: 튜토리얼 완료 + 항구 등대만 켠 저장(questQa.prepare(5))에서 시작해 5번 해역만 미점등으로 둔다.
 */
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
(async () => {
  const { browser, page, errors } = await open({ width: 480, height: 270 });
  await startSailing(page, { prepare: false });
  await page.evaluate(() => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    g.audio.setMuted(true);
    a.questQa.prepare(5);
    const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
  });
  await teleport(page, POINTS[5], { settle: 40 });
  const before = await page.evaluate(() => { const g = window.__OCEAN_GAME__; return { k: +g.atmosphere.k.toFixed(3), regionLit5: g.atmosphere.regionLit[5], daylight: +g.world.daylight.toFixed(3), currentRegion: g.currentRegion, mode: g.atmosphere.snapshot().mood }; });
  // 반딧불: 시뮬레이션 시간 3초 동안 센다
  const fireflies = await page.evaluate(async () => {
    const g = window.__OCEAN_GAME__; let seen = 0; const orig = g.effects.trigger.bind(g.effects), t0 = g.simTime;
    g.effects.trigger = (id, o) => { if (id === 'night_fireflies') seen++; return orig(id, o); };
    await new Promise((res) => { const f = () => (g.simTime - t0 >= 3.2 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    g.effects.trigger = orig; return { count: seen, simSeconds: +(g.simTime - t0).toFixed(2), region: g.currentRegion };
  });
  // 점등: 5번 해역만 이벤트로 올린다
  const t0 = await page.evaluate(() => {
    const g = window.__OCEAN_GAME__;
    g.effects.trigger('lighthouse_sequence', { region: 5 });
    return { sim: g.simTime, lit5: g.atmosphere.regionLit[5], events: g.atmosphere.snapshot().events, beam: g.effects.lighthouseBeam ? g.effects.lighthouseBeam.visible : null };
  });
  const samples = [];
  for (let i = 0; i < 80; i++) {
    await frames(page, 3);
    samples.push(await page.evaluate(() => { const g = window.__OCEAN_GAME__; return [+g.simTime.toFixed(2), +g.atmosphere.regionLit[5].toFixed(3), +g.atmosphere.k.toFixed(3), +g.world.scene.fog.density.toFixed(5)]; }));
    if (samples[samples.length - 1][0] - t0.sim > 4.4) break;
  }
  await page.screenshot({ path: outPath('rm1_lighthouse_event.png') });
  const skip = await page.evaluate(() => {
    const g = window.__OCEAN_GAME__; g.atmosphere.regionLit[6] = 0.35; g.atmosphere.beginLight(6, 1, 3);
    const during = g.atmosphere.regionLit[6]; g.atmosphere.completeLights();
    return { during, after: g.atmosphere.regionLit[6], events: g.atmosphere.snapshot().events };
  });
  console.log(JSON.stringify({ before, fireflies, t0, curve: samples.map((s) => [+(s[0] - t0.sim).toFixed(2), s[1], s[2], s[3]]), skip, errors: errors.slice(0, 5) }));
  await browser.close();
})();

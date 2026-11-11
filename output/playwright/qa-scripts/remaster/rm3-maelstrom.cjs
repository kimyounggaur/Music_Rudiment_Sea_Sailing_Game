'use strict';
/*
 * RM3: 소용돌이 세기에 따라 평면 반사가 줄어드는지(uReflOn = 1 - 세기) 확인한다.
 *   node rm3-maelstrom.cjs [--w 960 --h 540]
 * 세기 0 → 세기 1(고정) → 세기 약 0.5(사라지는 중) → 다시 0. 각 단계의 uReflOn과 화면 한 장.
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const W = Number(arg('w', '960')), H = Number(arg('h', '540'));
(async () => {
  const { browser, page, errors } = await open({ width: W, height: H });
  await startSailing(page);
  await page.evaluate(() => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
    g.applyQualityProfile('mid', false); a.remasterQa.setFx('full');
  });
  await teleport(page, { x: 0, z: -430, h: 0.57 }, { settle: 20 }); // 0번 항구: 이 자리에서는 게임이 소용돌이를 스스로 다시 걸지 않는다
  const read = () => page.evaluate(() => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, p = a.remasterQa.pipeline(), s = a.remasterQa.passes();
    return { strength: +Number(g.world.ocean.userData.maelstromStrength).toFixed(3), uReflOn: +Number(g.atmosphere.waterMaterial.uniforms.uReflOn.value).toFixed(3), reflReady: p.reflReady, reflectionCalls: s.reflection.calls, plan: p.plan.fx };
  });
  const rows = {};
  await frames(page, 12);
  rows.calm = await read();
  await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.effects.maelstromUntil = g.effects.time + 1e6; });
  await frames(page, 12);
  rows.full = await read();
  // 사라지는 중: 남은 시간을 0.8초로 걸고 프레임마다 (세기, uReflOn)을 읽는다. 한 프레임 안에서 세기 갱신 뒤 렌더가 uReflOn을 쓰므로 둘은 항상 uReflOn = 1 - 세기다.
  rows.fadeSamples = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__OCEAN_GAME__, samples = [];
    g.effects.maelstromUntil = g.effects.time + 0.8;
    let n = 0;
    const f = () => {
      samples.push({ strength: +Number(g.world.ocean.userData.maelstromStrength).toFixed(3), uReflOn: +Number(g.atmosphere.waterMaterial.uniforms.uReflOn.value).toFixed(3), sim: +g.simTime.toFixed(2), frame: g.frame, until: +g.effects.maelstromUntil.toFixed(2) });
      if (++n >= 10) resolve(samples); else requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }));
  rows.fading = rows.fadeSamples.find((x) => x.strength > 0.02 && x.strength < 0.98) || rows.fadeSamples[rows.fadeSamples.length - 1];
  rows.fadeRelationOk = rows.fadeSamples.slice(1).every((x) => Math.abs(x.uReflOn - (1 - x.strength)) < 0.003);
  await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.effects.maelstromUntil = 0; });
  await frames(page, 12);
  rows.after = await read();
  // 소용돌이 한가운데에서 세기 1로 한 장
  await teleport(page, { x: 0, z: -62, h: 0 }, { settle: 20 });
  await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.effects.maelstromUntil = g.effects.time + 1e6; });
  await frames(page, 12);
  rows.centre = await read();
  await page.screenshot({ path: outPath('rm_RM3_maelstrom_after.png') });
  const ok = rows.calm.uReflOn === 1 && rows.full.uReflOn === 0 && rows.fading.uReflOn > 0 && rows.fading.uReflOn < 1 && rows.fadeRelationOk && rows.after.uReflOn === 1 && rows.centre.uReflOn === 0;
  console.log(JSON.stringify({ ok, rows }), 'errors', JSON.stringify(errors.slice(0, 5)));
  fs.writeFileSync(outPath('rm3-maelstrom.json'), JSON.stringify({ ok, rows, errors: errors.slice(0, 5) }, null, 1));
  await browser.close();
})();

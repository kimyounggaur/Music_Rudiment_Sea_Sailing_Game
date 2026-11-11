'use strict';
/*
 * RM2: 최종 해역 소용돌이 변형(중심 함몰·접선 회전)이 새 수면에서도 그대로 보이는지 확인한다.
 *   node capture-maelstrom.cjs [--legacy] [--label after] [--w 960 --h 540]
 * effects.maelstromUntil을 길게 걸어 세기를 1로 고정하고, 소용돌이 중심 쪽을 본다.
 * 수치: 수면 메시 최저 y(중심 함몰), 원경 판 구멍이 소용돌이를 가리지 않는지(구멍 반 길이 > 소용돌이 반지름+배 거리).
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const legacy = process.argv.includes('--legacy');
const label = arg('label', legacy ? 'legacy' : 'after');
const W = Number(arg('w', '960')), H = Number(arg('h', '540'));
(async () => {
  const { browser, page, errors } = await open({ width: W, height: H, query: legacy ? '?qa=1&legacy=1' : '?qa=1' });
  await startSailing(page);
  await page.evaluate(() => { const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; });
  await teleport(page, { x: 0, z: -62, h: 0 }, { settle: 20 });
  await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.effects.maelstromUntil = g.effects.time + 1e6; });
  await frames(page, 40);
  const info = await page.evaluate(() => {
    const g = window.__OCEAN_GAME__, ocean = g.world.ocean, pos = ocean.geometry.attributes.position;
    let minY = 1e9, maxY = -1e9;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const far = g.world.farSea;
    return { strength: ocean.userData.maelstromStrength, minY: +minY.toFixed(2), maxY: +maxY.toFixed(2), shader: Boolean(ocean.material.isShaderMaterial), far: far ? { visible: far.visible, x: far.position.x, z: far.position.z } : null, region: g.currentRegion };
  });
  await page.screenshot({ path: outPath(`rm_RM2_maelstrom_${label}.png`) });
  console.log(JSON.stringify(info), 'errors', JSON.stringify(errors.slice(0, 5)));
  await browser.close();
})();

'use strict';
/*
 * GRM4: 조타 구도에서 정면 60 이내의 미수집 등불이 돛에 완전히 가려지는 경우가 없는지, 고정 촬영 지점 9곳에서 잰다.
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm4-occlusion.cjs [--w 640 --h 360] [--cone 30] [--range 60]
 * 지점마다 (1) 실제 미수집 용어 부표(range 이내, ±cone), (2) 진단용 가상 등불 격자(방위 3° × 거리 6단계)를 잰다.
 * (1)이 이번 게이트의 판정이고 (2)는 "어느 방위 폭이 가려지는가"를 알려 주는 진단이다.
 * 세로 화면(390×844)에서도 한 번 더 잰다(--portrait).
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes('--' + n);
const range = Number(arg('range', '60')), cone = Number(arg('cone', '30'));
const portrait = flag('portrait');
const W = Number(arg('w', portrait ? '390' : '640')), H = Number(arg('h', portrait ? '844' : '360'));
(async () => {
  const { browser, page, errors } = await open({ width: W, height: H });
  await startSailing(page);
  // 진행도: 튜토리얼만 끝낸 상태에서 모든 부표가 "미수집"으로 보이게 5번을 준비해도 그 해역 용어만 수집 처리되므로,
  // 점마다 해당 해역이 아닌 부표를 센다. 해역 용어를 수집한 지점(준비한 해역)은 결과에 표시한다.
  const rows = [];
  for (const p of POINTS) {
    await teleport(page, p, { settle: 10 });
    await frames(page, 4);
    const r = await page.evaluate(({ range, cone }) => {
      const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
      a.cameraQa.noteInput();
      const real = a.cameraQa.occlusion(range, cone, { scan: true });
      const all = a.cameraQa.occlusion(range, cone, { includeCollected: true });
      const snap = a.cameraQa.snapshot();
      // 비교: 기존(RM3까지) 카메라 자세 — 선수 뒤 22.6(=24·cos 0.34), 높이 5.1+13·sin 0.34, 배를 바라봄(+3.2)
      const cam = g.camera, m = g.motion, ship = g.world.ship, keep = { pos: cam.position.clone(), fov: cam.fov };
      const back = 24 * Math.cos(0.34);
      cam.position.set(m.x - Math.sin(m.heading) * back, ship.position.y + 5.1 + Math.sin(0.34) * 13, m.z - Math.cos(m.heading) * back);
      cam.lookAt(m.x, ship.position.y + 3.2, m.z);
      cam.updateMatrixWorld(true);
      const legacy = a.cameraQa.occlusion(range, cone, { scan: true, includeCollected: true });
      cam.position.copy(keep.pos); a.cameraQa.snap(); // 다음 프레임에 원래 자세로 돌려 놓는다
      return { real, all, legacy, mode: snap.mode, region: g.currentRegion, heading: g.motion.heading };
    }, { range, cone });
    rows.push({ id: p.id, name: p.name, mode: r.mode, region: r.region, heading: r.heading, real: { count: r.real.count, fully: r.real.fully, rows: r.real.rows }, allBuoys: { count: r.all.count, fully: r.all.fully, rows: r.all.rows }, scan: r.real.scan, legacyScan: r.legacy.scan, legacyAll: { count: r.legacy.count, fully: r.legacy.fully }, sailMeshes: r.real.sailMeshes });
    if (p.id === 3) await page.screenshot({ path: outPath(`rm_RM4_occlusion_${W}x${H}_after.png`) });
  }
  const summary = rows.map((r) => ({ id: r.id, name: r.name, mode: r.mode, buoys: r.allBuoys.count, fullyAll: r.allBuoys.fully, uncollected: r.real.count, fullyUncollected: r.real.fully, deadBearings: r.scan.map((s) => ({ d: s.distance, fully: s.fully })), legacyDead: r.legacyScan.map((s) => ({ d: s.distance, fully: s.fully })), legacyAll: r.legacyAll }));
  // 거리별로 9지점 평균 "완전히 가려지는 방위 폭(°)" — 새 구도 vs 기존 구도
  const width = (key) => [12, 20, 30, 40, 50, 60].map((d) => ({ d, deg: +(summary.reduce((n, r) => n + (r[key].find((x) => x.d === d).fully.length * 3), 0) / summary.length).toFixed(1) }));
  const wedge = { new: width('deadBearings'), legacy: width('legacyDead') };
  const gate = rows.every((r) => r.mode === 'steer' && r.real.fully === 0);
  const totals = { points: rows.length, uncollectedInView: rows.reduce((n, r) => n + r.real.count, 0), buoysInView: rows.reduce((n, r) => n + r.allBuoys.count, 0), fullyUncollected: rows.reduce((n, r) => n + r.real.fully, 0), fullyAll: rows.reduce((n, r) => n + r.allBuoys.fully, 0) };
  const out = { viewport: [W, H], range, cone, gate, totals, wedge, summary, rows: rows.map((r) => ({ id: r.id, real: r.real.rows, all: r.allBuoys.rows })), sailMeshes: rows[0] && rows[0].sailMeshes, errors: errors.slice(0, 5) };
  console.log(JSON.stringify({ gate, totals, wedge }));
  for (const s of summary) console.log(s.id, s.name, 'mode', s.mode, 'buoys', s.buoys, 'fullyAll', s.fullyAll, 'uncollected', s.uncollected, 'fullyUncollected', s.fullyUncollected, '| dead:', s.deadBearings.map((x) => x.d + 'm:' + (x.fully.length ? x.fully.join(',') + '°' : '-')).join(' '));
  fs.writeFileSync(outPath(`rm4-occlusion-${W}x${H}.json`), JSON.stringify(out, null, 1));
  await browser.close();
})();

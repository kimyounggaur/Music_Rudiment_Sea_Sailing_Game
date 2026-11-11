'use strict';
/*
 * GRM5: 돛 뒤에 완전히 가려지던 먼 등불이 "빛 점"으로 돛 너머로 보이는지 확인한다(RM4가 넘긴 과제).
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm5-sail.cjs
 *
 * 방법
 *  1) 미수집 등불 하나를 고르고, 배를 그 등불에서 "배 앞 d미터 · 왼쪽 β도"가 되게 놓는다(d ∈ {40, 50, 60}).
 *     돛이 가리는 쐐기는 RM4의 occlusion(scan)으로 찾는다(카메라→등불 9개 표본 광선이 모두 돛에 막히는 자리).
 *  2) 그 자리에서 through 플래그가 1인지 확인하고(판정 켬) 화면을 찍는다.
 *  3) 판정을 끈(같은 장면, through 전부 0) 화면을 다시 찍는다.
 *  4) 대조군: 배를 30° 돌려 돛이 안 가리게 하면 through가 0이어야 한다(거짓 양성 없음).
 * 시험 중 배가 흘러가지 않도록 튜토리얼 완료·외곽 등대 점등(startSailing 기본)과 충돌체 여유(r+12)를 쓴다.
 */
const fs = require('fs');
const { open, frames, startSailing, outPath } = require('./lib.cjs');
(async () => {
  const W = 1280, H = 720;
  const { browser, page, errors } = await open({ query: '?qa=1', width: W, height: H });
  await startSailing(page);
  await page.evaluate(async () => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    await g.remaster.start(); g.audio.setMuted(true); a.vfxQa.setTimeOfDay(0.25);
    const st = document.createElement('style'); st.textContent = '#qa-hud,.hud,#control-layer,.minimap-panel,#world-labels,#objective-chip,#help-strip,#game-toast,#caption-strip,#region-banner,.collect-counter,.action-cluster,#effect-cue,#remaster-region-art{display:none!important}'; document.head.appendChild(st);
  });
  const rows = [];

  // 배를 (spec에서 approach 방향으로 d미터 떨어진 자리, 등불이 선수 기준 betaDeg)에 놓고 카메라를 붙인다.
  const place = (index, approach, d, betaDeg) => page.evaluate(({ index, approach, d, betaDeg }) => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, spec = TERM_BUOY_SPECS[index];
    const sx = spec.x - Math.sin(approach) * d, sz = spec.z - Math.cos(approach) * d;
    g.motion.x = sx; g.motion.z = sz; g.motion.heading = approach - (betaDeg * Math.PI) / 180; g.motion.speed = 0; g.motion.yawVelocity = 0;
    g.cameraDrag.yaw = 0; g.cameraDrag.pitch = 0.34;
    if (g.currentTerm) g.closeTermCard();
    a.cameraQa.snap(); a.cameraQa.noteInput(); g.atmosphere.refresh(g.simTime, sx, sz); a.vfxQa.settle();
    return { x: sx, z: sz };
  }, { index, approach, d, betaDeg });

  const probe = (index) => page.evaluate(({ index }) => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, spec = TERM_BUOY_SPECS[index];
    a.cameraQa.noteInput();
    g.camera.updateMatrixWorld(true);
    const lamp = new THREE.Vector3(spec.x, waterY(spec.x, spec.z, g.simTime) + LANTERN_BUOY.lampHeight, spec.z), p = lamp.clone().project(g.camera);
    const occ = a.cameraQa.occlusion(130, 40, { points: [{ id: spec.term.id, x: spec.x, z: spec.z }] }), row = occ && occ.rows && occ.rows[0];
    const cam = g.camera.position;
    return {
      px: Math.round((p.x * 0.5 + 0.5) * g.renderer.domElement.clientWidth), py: Math.round((-p.y * 0.5 + 0.5) * g.renderer.domElement.clientHeight), inFront: p.z < 1,
      through: g.world.termBuoys.through[index], lit: +g.world.termBuoys.target[index].toFixed(2), sailRays: g.world.termBuoys.sailRays,
      throughTotal: Array.from(g.world.termBuoys.through).filter((v) => v > 0.5).length,
      blocked: row ? [row.blocked, row.samples] : null, bearing: row ? row.bearingDeg : null, shipDistance: row ? row.distance : null,
      cameraDistance: +Math.hypot(spec.x - cam.x, spec.z - cam.z).toFixed(1), ship: [+g.motion.x.toFixed(2), +g.motion.z.toFixed(2), +g.motion.heading.toFixed(3)],
    };
  }, { index });

  for (const [tag, region] of [['r5', 5], ['r6', 6], ['r3', 3]]) {
    // 1) 등불·접근 방향 고르기: 충돌체 여유와 해역 경계 안쪽 조건을 모든 시험 자리에서 만족하는 것
    const setup = await page.evaluate(({ region }) => {
      const g = window.__OCEAN_GAME__, reg = CONFIG.world.regions[region];
      const clear = (x, z) => g.world.colliders.every((c) => Math.hypot(x - c.x, z - c.z) >= c.r + 12) && Math.hypot(x - reg.center[0], z - reg.center[1]) <= reg.radius - 20;
      const specs = TERM_BUOY_SPECS.map((s, i) => [s, i]).filter(([s]) => s.term.region === region && !SAVE.progress.termsFound.includes(s.term.id));
      for (const [spec, index] of specs) {
        // 등불 자체도 다른 충돌체와 겹치지 않는 것(부표 배치는 이미 보장)
        for (let k = 0; k < 16; k++) {
          const approach = (k / 16) * Math.PI * 2;
          const ok = [40, 50, 60].every((d) => clear(spec.x - Math.sin(approach) * d, spec.z - Math.cos(approach) * d));
          if (ok) return { ok: true, id: spec.term.id, index, approach, candidates: specs.length };
        }
      }
      return { ok: false, candidates: specs.length };
    }, { region });
    if (!setup.ok) { rows.push({ tag, setup }); continue; }

    // 2) 쐐기 찾기: 한 번 놓고 scan 결과(거리별 완전 차폐 방위)를 읽는다
    await place(setup.index, setup.approach, 50, 3);
    await frames(page, 5);
    const scan = await page.evaluate(({ index }) => {
      const a = window.__OCEAN_API__, spec = TERM_BUOY_SPECS[index];
      a.cameraQa.noteInput();
      const out = a.cameraQa.occlusion(130, 30, { scan: true, points: [{ id: spec.term.id, x: spec.x, z: spec.z }] });
      return out.scan;
    }, { index: setup.index });
    const wedge = {};
    for (const s of scan) if ([40, 50, 60].includes(s.distance)) wedge[s.distance] = s.fully;

    const result = { tag, setup, wedge, cases: [] };
    for (const d of [40, 50, 60]) {
      const fully = wedge[d] || [];
      const beta = [3, 0, 6, 9, -3, 12].find((b) => fully.includes(b));
      if (beta === undefined) { result.cases.push({ d, skipped: 'no fully-blocked bearing at this distance', fully }); continue; }
      await place(setup.index, setup.approach, d, beta);
      await frames(page, 7);
      const on = await probe(setup.index);
      const fileOn = outPath(`rm_RM5_sail_${tag}_d${d}_through_on_${W}x${H}_after.png`);
      await page.screenshot({ path: fileOn });
      // 판정을 끈 같은 장면
      await page.evaluate(() => {
        window.__realThrough = window.updateLanternSailThrough;
        window.updateLanternSailThrough = () => { const b = window.__OCEAN_GAME__.world.termBuoys; b.through.fill(0); b.throughAttr.needsUpdate = true; return 0; };
      });
      await frames(page, 7);
      const off = await probe(setup.index);
      const fileOff = outPath(`rm_RM5_sail_${tag}_d${d}_through_off_${W}x${H}_after.png`);
      await page.screenshot({ path: fileOff });
      await page.evaluate(() => { window.updateLanternSailThrough = window.__realThrough; });
      await frames(page, 4);
      // 대조군: 배를 30° 돌려(등불이 돛에서 벗어남) 판정 켠 채로 through가 0인지
      await place(setup.index, setup.approach, d, 30);
      await frames(page, 7);
      const control = await probe(setup.index);
      result.cases.push({ d, beta, on, off, control, fileOn, fileOff });
    }
    rows.push(result);
  }
  // 게이트: ① 돛이 가운데 광선을 막는(또는 9개 표본이 모두 막힌) 자리는 through=1이어야 하고 ② 판정을 끄면 0 ③ 돌린 대조군은 0
  // ④ 해역마다 "완전히 가려진" 자리가 한 번 이상 있어 쐐기를 실제로 시험했다
  const fullyCases = [];
  let gate = rows.length > 0;
  for (const r of rows) {
    const done = (r.cases || []).filter((c) => c.on);
    if (!done.length) { gate = false; continue; }
    let sawFully = false;
    for (const c of done) {
      const fully = c.on.blocked && c.on.blocked[0] === c.on.blocked[1];
      const centerBlocked = c.on.blocked && c.on.blocked[0] > 0;
      if (fully) { sawFully = true; fullyCases.push({ tag: r.tag, d: c.d, through: c.on.through }); }
      if (centerBlocked && c.on.through !== 1) gate = false;
      if (c.off.through !== 0 || c.control.through !== 0) gate = false;
    }
    if (!sawFully) gate = false;
  }
  console.log(JSON.stringify({ gate, fullyCases, rows, errors: errors.slice(0, 4) }, null, 1));
  fs.writeFileSync(outPath('rm5-sail.json'), JSON.stringify({ gate, fullyCases, rows, errors }, null, 1));
  await browser.close();
  process.exit(gate && errors.length === 0 ? 0 : 1);
})();

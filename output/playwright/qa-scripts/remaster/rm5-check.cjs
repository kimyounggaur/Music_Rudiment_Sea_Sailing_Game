'use strict';
/*
 * GRM5 정량 점검 (한 번에):
 *   A 등불 요약(삼각형·부품·그림자·점광원)           B 품질 3단계(고리 칸·풀 상한·프로그램 컴파일 오류 없음)
 *   C 동작 줄이기(풀 상한 500·입자 양 40%·고정 흔들림) D 자원 누수(vfxQa.stress) · 섬광 제한(초당 3회)
 *   E 음악 → 화면 경로(큐 · 연속) F 용어 발견 빛 덩이·원통 빛기둥 없음
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm5-check.cjs [--only A,B,...]
 * 결과 JSON: output/playwright/rm5-check.json
 */
const fs = require('fs');
const { open, frames, startSailing, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const only = String(arg('only', 'A,B,C,D,E,F')).split(',').map((s) => s.trim());
const result = {};
const check = (name, ok, detail) => { result.checks = result.checks || []; result.checks.push({ name, ok: Boolean(ok), detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); };
(async () => {
  const { browser, page, errors } = await open({ query: '?qa=1', width: 960, height: 540 });
  await startSailing(page);
  await page.evaluate(async () => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    await g.remaster.start(); a.vfxQa.setTimeOfDay(0.25);
    a.audioQa.stop(); // 박자 큐가 섞이지 않게(헤드리스에서는 오디오 시계가 게임 시간보다 빠르게 흐른다)
  });
  const goto = async (x, z, h = 0) => {
    await page.evaluate(({ x, z, h }) => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
      g.motion.x = x; g.motion.z = z; g.motion.heading = h; g.motion.speed = 0;
      a.cameraQa.snap(); a.cameraQa.noteInput(); g.atmosphere.refresh(g.simTime, x, z); a.vfxQa.settle();
      if (g.currentTerm) g.closeTermCard();
    }, { x, z, h });
    await frames(page, 6);
  };
  const errCount = () => errors.length;

  if (only.includes('A')) {
    const a = await page.evaluate(() => window.__OCEAN_API__.remasterQa.lanterns());
    const toon = await page.evaluate(() => window.__OCEAN_API__.remasterQa.toon());
    result.A = { lanterns: a, toon };
    check('A1 부표 삼각형 ≤ 96 · 부품 2', a.buoy.bodyTriangles + a.buoy.glowTriangles <= 96 && a.buoy.parts === 2, [a.buoy.bodyTriangles, a.buoy.glowTriangles, a.buoy.parts]);
    check('A2 부표 128개 한 번 그리기(인스턴스)', a.buoy.instances === 128, a.buoy.instances);
    check('A3 부표·병은 그림자를 드리우지 않음', !a.buoy.castShadow && !a.bottle.castShadow);
    check('A4 점광원 ≤ 2', a.pointLights <= 2, a.pointLights);
    check('A5 시련 문 한 개 ≤ 200 삼각형', a.gate.triangles.every((t) => t <= 200), a.gate.triangles);
    check('A6 툰 치환: 머티리얼 변환됨', toon.materials > 0 && toon.meshes > 0, toon);
  }

  if (only.includes('B')) {
    const rows = [];
    for (const q of ['low', 'mid', 'high', 'mid']) {
      const before = errCount();
      await page.evaluate((q) => window.__OCEAN_API__.vfxQa.setQuality(q), q);
      await frames(page, 6);
      const row = await page.evaluate((q) => {
        const g = window.__OCEAN_GAME__, p = CONFIG.qualityProfiles[q];
        const water = g.atmosphere.waterMaterial;
        return {
          q, eventRingsProfile: p.eventRings, defineEventRings: water.defines.EVENT_RINGS, slots: g.effects.waterRings.slots,
          uRingsLength: water.uniforms.uRings.value.length, particlesProfile: p.particles, capacity: g.effects.pool.capacity,
          pointLights: window.__OCEAN_API__.remasterQa.lanterns().pointLights, programs: g.renderer.info.programs.length,
        };
      }, q);
      row.newErrors = errCount() - before;
      rows.push(row);
    }
    result.B = rows;
    check('B1 품질별 EVENT_RINGS 정의가 품질표와 같다', rows.every((r) => r.defineEventRings === r.eventRingsProfile), rows.map((r) => [r.q, r.eventRingsProfile, r.defineEventRings]));
    check('B2 고리 은행 칸이 품질표와 같다', rows.every((r) => r.slots === r.eventRingsProfile), rows.map((r) => [r.q, r.slots]));
    check('B3 풀 상한이 품질표와 같다', rows.every((r) => r.capacity === r.particlesProfile), rows.map((r) => [r.q, r.capacity]));
    check('B4 셰이더 배열은 항상 8칸', rows.every((r) => r.uRingsLength === 8));
    check('B5 품질 전환 중 콘솔 오류 0', rows.every((r) => r.newErrors === 0), rows.map((r) => r.newErrors));
    check('B6 점광원 ≤ 2 (모든 품질)', rows.every((r) => r.pointLights <= 2));
  }

  if (only.includes('C')) {
    // 폭풍 해역에서 같은 시간 동안 낸 무드 입자 수: 보통 vs 동작 줄이기
    await goto(195, -205, 0.2);
    const measure = (reduced) => page.evaluate((reduced) => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
      a.vfxQa.setReducedMotion(reduced);
      a.vfxQa.settle();
      const e = g.effects, start = a.remasterQa.music().moodEmitted;
      for (let i = 0; i < 400; i++) e.update(0.05); // 20초
      return { emitted: a.remasterQa.music().moodEmitted - start, capacity: e.pool.capacity, uMotion: e.pool.material.uniforms.uMotion.value, rateWanted: moodParticlePlan('storm', reduced).rate };
    }, reduced);
    const normal = await measure(false), reduced = await measure(true);
    const orb = await page.evaluate(() => {
      const e = window.__OCEAN_GAME__.effects;
      e.showOrb({ x: 0, y: 3, z: 0 }); e.orbUntil = e.time + 1000; e.update(0.016);
      return { scale: e.orb.sprite.scale.x, opacity: +e.orb.material.opacity.toFixed(3) };
    });
    const flick = await page.evaluate(() => { const out = []; for (let i = 0; i < 5; i++) { window.__OCEAN_GAME__.world.shipLantern && out.push(shipLanternFlicker(i * 1.37, true)); } return out; });
    const flash = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, e = g.effects;
      e.flashLimiter.reset(); e.flashes.allowed = 0; e.flashes.suppressed = 0;
      e.lightningStrength = 0; e.trigger('lightning'); e.update(0.016);
      const out = lightningOutputs(e.lightningStrength, true);
      return { strength: e.lightningStrength, flash: +out.flash.toFixed(3), overlay: out.overlay, light: +out.light.toFixed(3) };
    });
    await page.evaluate(() => window.__OCEAN_API__.vfxQa.setReducedMotion(false));
    result.C = { normal, reduced, orb, flick, flash };
    check('C1 동작 줄이기 풀 상한 ≤ 500', reduced.capacity <= 500, reduced.capacity);
    check('C2 무드 입자 양이 보통의 약 40%', Math.abs(reduced.emitted / Math.max(1, normal.emitted) - 0.4) < 0.08, { normal: normal.emitted, reduced: reduced.emitted, ratio: +(reduced.emitted / Math.max(1, normal.emitted)).toFixed(3) });
    check('C3 꽃잎 회전·반딧불 깜박임 시계가 멈춘다(uMotion 0)', reduced.uMotion === 0 && normal.uMotion === 1, [normal.uMotion, reduced.uMotion]);
    check('C4 배 등불 흔들림 고정', flick.every((v) => v === 1), flick);
    check('C5 빛 덩이: 퍼지지 않고(크기 8 고정) 불투명도 ≤ 0.25', orb.scale === 8 && orb.opacity <= 0.25, orb);
    check('C6 동작 줄이기 번개: 섬광 ≤ 0.12 · 화면 덮개 0', flash.flash <= 0.12 + 1e-9 && flash.overlay === 0, flash);
  }

  if (only.includes('D')) {
    const stress = await page.evaluate(() => window.__OCEAN_API__.vfxQa.stress(60));
    const growth = stress.growth;
    check('D1 효과 60회 반복 뒤 자원 증가 0', Object.values(growth).every((v) => v === 0), growth);
    result.D = { growth };
    const flashRun = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, e = g.effects;
      window.__OCEAN_API__.vfxQa.settle();
      e.flashLimiter.reset(); e.flashes.allowed = 0; e.flashes.suppressed = 0;
      for (let i = 0; i < 10; i++) e.trigger('lightning');
      const first = { ...e.flashes };
      const out = lightningOutputs(1, false);
      return { first, maxFlash: +out.flash.toFixed(3), overlay: out.overlay };
    });
    result.D.flash = flashRun;
    check('D2 같은 시각에 10번 번개 → 섬광 3회만 허용', flashRun.first.allowed === 3 && flashRun.first.suppressed === 7, flashRun.first);
    check('D3 섬광 세기 ≤ 0.35 · 화면 덮개 0', flashRun.maxFlash <= 0.35 + 1e-9 && flashRun.overlay === 0, flashRun);
    const pool = await page.evaluate(() => window.__OCEAN_API__.remasterQa.particles());
    check('D4 풀 사용량이 상한 안', pool.active <= pool.capacity, pool);
  }

  if (only.includes('E')) {
    const out = {};
    // 큐 경로(이산): 해역별 한 장씩 넣고 화면 계획을 읽는다
    const cue = (c) => page.evaluate((c) => window.__OCEAN_API__.remasterQa.cue(c), c);
    await goto(195, -205, 0.2);
    const storm = await cue({ region: 2, beat: true, bpm: 120, dynamic: 0.6 });
    out.stormBeat = storm.last;
    check('E1 해역2 강박 → 큰 고리 + 비', storm.last.rain && storm.last.rings.includes('beat'), storm.last.rings);
    const flashCue = await cue({ region: 2, lightning: true });
    check('E2 해역2 엇박 → 하늘 섬광', flashCue.last.flash === true);
    const deep = await cue({ region: 3, dynamic: 1 });
    check('E3 해역3 셈여림(dynamic 1.0) → 수면 발광 1.0', Math.abs(deep.last.glow - 1) < 1e-9, deep.last.glow);
    const dots = await cue({ region: 4, beat: true, gate: 0.2 }), wave = await cue({ region: 4, beat: true, gate: 0.9 });
    check('E4 해역4 gate 0.2 → 점 고리 · 0.9 → 물결', dots.last.rings.includes('dots') && wave.last.rings.includes('wave'), [dots.last.rings, wave.last.rings]);
    const scale = await cue({ region: 5, scaleDegree: 5 });
    check('E5 해역5 계이름 5 전달', scale.last.scaleDegree === 5);
    const chord = await cue({ region: 6, beat: true, chordTones: ['C', 'E', 'G'] });
    check('E6 해역6 화음 구성음 3 → 진주 3 · 세 겹 고리', chord.last.pearls === 3 && chord.last.rings.includes('triple'), [chord.last.pearls, chord.last.rings]);
    const hue = await cue({ region: 7, key: 'G' });
    check('E7 해역7 조성 G → 오로라 색상 π/6', Math.abs(hue.last.auroraHue - Math.PI / 6) < 1e-9, hue.last.auroraHue);
    const da = await cue({ region: 8, bar: 3 });
    check('E8 해역8 다 카포: 4번째 마디는 A', da.last.form === 'A', da.last.form);
    // 연속 경로: 오디오가 잠겨도 latestContext에서 매 프레임 읽는다 — 해역 3에서 수면 발광이 따라온다
    await goto(253, 0, 0);
    await frames(page, 8);
    const live = await page.evaluate(() => { const m = window.__OCEAN_API__.remasterQa.music(); return { live: m.live, atmosphere: m.atmosphere }; });
    out.live = live;
    check('E9 연속 경로가 매 프레임 계획을 만든다', live.live !== null, live.live && { region: live.live.region, glow: live.live.glow });
    await goto(-10, -262, -0.49);
    await frames(page, 6);
    const metronome = await page.evaluate(() => window.__OCEAN_API__.remasterQa.music().live);
    check('E10 해역1 연속 경로: bpm → 메트로놈 주기', metronome && (metronome.metronome === null || (metronome.metronome >= 60 / 180 - 1e-9 && metronome.metronome <= 1.5 + 1e-9)), metronome && metronome.metronome);
    result.E = out;
  }

  if (only.includes('F')) {
    const scene = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, scn = g.world.scene;
      const cylinders = [];
      scn.traverse((o) => { if (o.geometry && o.geometry.type === 'CylinderGeometry' && o.name && /beam|pillar|term/i.test(o.name)) cylinders.push(o.name); });
      return { orb: g.effects.orb.sprite.name, orbBlending: g.effects.orb.material.blending, cylinders };
    });
    result.F = scene;
    check('F1 용어 발견 빛 덩이(스프라이트)가 있다', scene.orb === 'term-light-orb');
    check('F2 용어 발견 원통 빛기둥은 없다', scene.cylinders.length === 0, scene.cylinders);
  }

  check('Z 전체 콘솔 오류·경고 0', errors.length === 0, errors.slice(0, 4));
  const failed = (result.checks || []).filter((c) => !c.ok);
  result.summary = { total: (result.checks || []).length, failed: failed.length };
  fs.writeFileSync(outPath('rm5-check.json'), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result.summary));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();

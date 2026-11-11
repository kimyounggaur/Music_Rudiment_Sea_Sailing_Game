'use strict';
/*
 * GRM4: 시련 4종(항해·듣기·순서 항해·기호 짝맞추기)을 새 카메라로 끝까지 풀고, 이어지는 등대 점등 연출을 확인한다.
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm4-trials.cjs [--only S1,S2,S3] [--w 1280 --h 720]
 *   S1 1번 해역 시련: 보통 동작, 점등 연출을 끝까지(6초) 본다 — 검은 띠(--bars), 표제(data-title), 점등 카메라, k 상승, 끝난 뒤 조타 복귀와 자동 지도 5초
 *   S2 2번 해역 시련: 보통 동작, 연출 중 "건너뛰기" → 즉시 k=1·조타 복귀
 *   S3 3번 해역 시련: 동작 줄이기 — 연출 2초, 검은 띠 이동 없음, 점등 카메라 고정, 표제 1.2초
 * 시련마다 문제 유형이 처음 나올 때 시련 부표(원 위 4개)가 돛에 가려지는지도 잰다.
 */
const fs = require('fs');
const { open, frames, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const only = String(arg('only', 'S1,S2,S3')).split(',').map((s) => s.trim().toUpperCase());
const W = Number(arg('w', '1280')), H = Number(arg('h', '720'));
const jsonPath = outPath('rm4-trials.json');
let results = {};
try { results = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { results = {}; }
const save = () => fs.writeFileSync(jsonPath, JSON.stringify(results, null, 1));

// 한 문제를 푼다(원본 journey-final.cjs의 방식): 키보드 1~4 또는 짝맞추기 끌기/누르기
async function solve(page, onType) {
  const typesSeen = [], log = [];
  let drag = false;
  for (let steps = 0; steps < 40; steps++) {
    const q = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, p = g.currentTrialProblem();
      return p ? { ...p, step: g.trialRuntime.sequenceStep, matched: [...g.trialRuntime.matchedIds], order: g.trialRuntime.order } : null;
    });
    if (!q) break;
    if (!typesSeen.includes(q.type)) { typesSeen.push(q.type); if (onType) await onType(q.type, steps); }
    if (q.type === 'symbol_matching') {
      const target = q.matchPairs.find((p) => !q.matched.includes(p.id));
      if (!target) { await page.waitForTimeout(750); continue; }
      const source = page.locator(`[data-target-id="${target.id}"]`), dest = page.locator(`#trial-choices [data-choice-id="${target.id}"]`);
      if (!drag) {
        await source.scrollIntoViewIfNeeded(); const a = await source.boundingBox();
        await dest.scrollIntoViewIfNeeded(); const b = await dest.boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await page.mouse.up();
        drag = true;
      } else { await source.click(); await dest.click(); }
    } else {
      const correct = q.answerSequence ? q.answerSequence[q.step] : q.answerId;
      await page.keyboard.press(String(q.order.indexOf(correct) + 1));
    }
    log.push(q.type);
    await page.waitForTimeout(900);
  }
  const result = await page.locator('#trial-result').innerText();
  return { typesSeen, steps: log.length, drag, result: result.replace(/\s+/g, ' ').slice(0, 140) };
}

async function runScenario(name, { region, reduced, skipAtMs, shots }) {
  const { browser, page, errors } = await open({ width: W, height: H });
  await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
  await page.click('#start-sailing');
  await page.waitForTimeout(1500);
  await page.evaluate(({ region, reduced }) => {
    const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
    g.audio.setMuted(true);
    a.questQa.prepare(region);
    g.applyReducedMotion(reduced);
    const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
    a.cameraQa.snap();
    g.startRegionTrial(region);
  }, { region, reduced });
  await page.waitForTimeout(900);
  const typeRows = [];
  const solved = await solve(page, async (type) => {
    const row = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, snap = a.cameraQa.snapshot();
      const world = g.world.trialBuoys.group.visible ? g.world.trialBuoys.buoys.filter((b) => b.visible).map((b) => ({ id: b.userData.choiceId, x: b.position.x, z: b.position.z })) : [];
      const occ = world.length ? a.cameraQa.occlusion(80, 90, { points: world }) : null;
      return { mode: snap.mode, fov: snap.fov, worldBuoys: world.length, occlusion: occ ? occ.rows.map((r) => ({ id: r.id, d: r.distance, bearing: r.bearingDeg, blocked: r.blocked, fully: r.fully })) : null };
    });
    typeRows.push({ type, ...row });
    if (shots) await page.screenshot({ path: outPath(`rm_RM4_trial_${type}_${W}x${H}_after.png`) });
  });
  const resultRow = { region, typesSeen: solved.typesSeen, steps: solved.steps, drag: solved.drag, result: solved.result };
  // 결과 → 점등 연출. 표본 수집기를 걸고 첫 버튼(계속)을 누른다.
  await page.evaluate(({ region, ms }) => {
    window.__lhSamples = []; window.__lhPlan = null;
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, root = document.getElementById('lighthouse-event'), spec = a.cameraQa.lighthouse(region);
    const t0 = performance.now();
    window.__lhT0 = t0;
    const f = () => {
      const now = performance.now(), snap = a.cameraQa.snapshot(), c = g.camera.position;
      if (!window.__lhPlan) {
        const ev = g.atmosphere.lightEvents.get(region);
        if (ev) window.__lhPlan = { delay: +(ev.start - g.simTime).toFixed(3), duration: +ev.duration.toFixed(3), from: +ev.from.toFixed(3), sim: +g.simTime.toFixed(3) };
      }
      window.__lhSamples.push({
        sim: +g.simTime.toFixed(3),
        at: Math.round(now - t0), since: g.ux.lighthouseStarted !== undefined ? Math.round(now - g.ux.lighthouseStarted) : null,
        hidden: root.hidden, bars: Number(root.dataset.bars), title: root.dataset.title, mode: snap.mode,
        dist: spec ? +Math.hypot(c.x - spec.x, c.z - spec.z).toFixed(1) : null, y: +c.y.toFixed(1),
        lit: +Number(g.atmosphere.regionLit[region]).toFixed(3), k: +Number(g.atmosphere.k).toFixed(3), mapOpen: Boolean(g.ux.mapOpen),
      });
      if (now - t0 < ms) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }, { region, ms: reduced ? 6500 : 14000 });
  let shotsTaken = [];
  if (skipAtMs) {
    // 소프트웨어 렌더에서는 Playwright 클릭이 프레임을 기다리며 몇 초씩 걸려 6초 연출이 끝나 버린다. 페이지 안에서 눌러 시각을 정확히 맞춘다.
    resultRow.skip = await page.evaluate(async ({ region, skipAtMs }) => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, read = () => ({ lit: +g.atmosphere.regionLit[region].toFixed(3), k: +g.atmosphere.k.toFixed(3), hidden: document.getElementById('lighthouse-event').hidden, mapOpen: Boolean(g.ux.mapOpen), mode: a.cameraQa.snapshot().mode });
      document.querySelector('.result-actions button').click();
      await new Promise((r) => setTimeout(r, skipAtMs));
      const before = read();
      document.getElementById('lighthouse-skip').click();
      await new Promise((r) => setTimeout(r, 300));
      return { before, after: read() };
    }, { region, skipAtMs });
  } else {
    await page.locator('.result-actions button').first().click();
  }
  if (!skipAtMs && shots) {
    // 띠가 내려온 장면(약 1.5초)과 표제가 뜬 장면(약 5초)을 촬영
    await page.waitForFunction(() => (window.__lhSamples || []).some((s) => s.bars > 0.99), null, { timeout: 15000 });
    await page.screenshot({ path: outPath(`rm_RM4_lighthouse_bars_${W}x${H}_after.png`) }); shotsTaken.push('bars');
    await page.waitForFunction(() => (window.__lhSamples || []).some((s) => s.title === 'true'), null, { timeout: 15000 });
    await page.screenshot({ path: outPath(`rm_RM4_lighthouse_title_${W}x${H}_after.png`) }); shotsTaken.push('title');
  }
  await page.waitForTimeout(reduced ? 3500 : 7500);
  const samples = await page.evaluate(() => window.__lhSamples);
  const plan = await page.evaluate(() => window.__lhPlan);
  const after = await page.evaluate((region) => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    return { eventHidden: document.getElementById('lighthouse-event').hidden, mapOpen: Boolean(g.ux.mapOpen), mode: a.cameraQa.snapshot().mode, lit: +g.atmosphere.regionLit[region].toFixed(3), k: +g.atmosphere.k.toFixed(3), lighthouses: a.journeyQa.snapshot().save.progress.lighthousesLit };
  }, region);
  // 시간표 정리
  const ev = samples.filter((s) => s.since !== null && !s.hidden);
  const first = (pred) => { const s = ev.find(pred); return s ? s.since : null; };
  const barsMax = ev.reduce((m, s) => Math.max(m, s.bars), 0);
  const startBars = ev.length ? ev[0].bars : null;
  const lastEv = ev[ev.length - 1];
  const doneRow = samples.find((s) => s.hidden && s.since !== null && ev.length && s.at > ev[0].at + 500);
  const lightRise = { k10: first((s) => s.lit >= 0.1), k50: first((s) => s.lit >= 0.5), k99: first((s) => s.lit >= 0.99) };
  const camRows = ev.filter((s) => s.mode === 'lighthouse');
  const timeline = {
    barsFull: first((s) => s.bars >= 0.99), titleOn: first((s) => s.title === 'true'), startBars, barsMax: +barsMax.toFixed(3), lastEventSince: lastEv ? lastEv.since : null,
    endAt: doneRow ? doneRow.at : null, afterMode: doneRow ? doneRow.mode : null, lightRise, cameraMode: [...new Set(ev.map((s) => s.mode))], lighthouseDistAtEnd: camRows.length ? camRows[camRows.length - 1].dist : null, lighthouseYAtEnd: camRows.length ? camRows[camRows.length - 1].y : null,
    mapOpenedAfterEvent: samples.some((s) => s.hidden && s.mapOpen), mapClosedLater: Boolean(samples.length) && !samples[samples.length - 1].mapOpen,
    evFrames: ev.length,
    // 점등 일정(게임 시간): 연출 시작 때 AtmosphereDirector에 실제로 들어간 값. 실시간 창으로는 느린 렌더에서 곡선 끝을 못 볼 수 있어 일정 자체를 확인한다.
    lightPlan: plan,
    simPerWallRatio: ev.length > 1 && ev[ev.length - 1].at > ev[0].at ? +((ev[ev.length - 1].sim - ev[0].sim) / ((ev[ev.length - 1].at - ev[0].at) / 1000)).toFixed(3) : null,
    maxFrameGapMs: samples.reduce((m, s, i) => (i ? Math.max(m, s.at - samples[i - 1].at) : m), 0),
  };
  const out = { region, reduced, solved: resultRow, types: typeRows, timeline, after, shotsTaken, errors: errors.slice(0, 5) };
  await browser.close();
  return out;
}

(async () => {
  if (only.includes('S1')) {
    const r = await runScenario('S1', { region: 1, reduced: false, shots: true });
    const t = r.timeline, types = r.solved.typesSeen;
    r.checks = {
      allFourTypes: ['navigation', 'listening', 'ordered_navigation', 'symbol_matching'].every((x) => types.includes(x)),
      passed: /통과|성공|완료/.test(r.solved.result) || r.after.lighthouses.includes(1),
      lighthouseLit: r.after.lighthouses.includes(1) && r.after.lit >= 0.99,
      barsDescend: t.barsMax > 0.99 && t.startBars !== null && t.startBars < 0.9,
      titleLate: t.titleOn !== null && t.titleOn >= 4000 && t.titleOn <= 5200,
      cameraLighthouse: t.cameraMode.includes('lighthouse'),
      // 표제(4.2초)까지 보이고 6.0초 뒤엔 보이지 않는다. 느린 렌더에서 프레임 간격이 최대 약 0.7초라 마지막 보이는 표본은 6.7초까지 허용한다.
      endedAroundSix: t.lastEventSince !== null && t.lastEventSince >= 4200 && t.lastEventSince <= 6700,
      lightPlanNormal: !!t.lightPlan && Math.abs(t.lightPlan.duration - 3) < 1e-6 && t.lightPlan.delay <= 1 + 1e-6 && t.lightPlan.delay >= 0.7,
      backToSteer: t.afterMode === 'steer' && r.after.eventHidden,
      autoMap: t.mapOpenedAfterEvent === true,
      worldBuoysNotFullyHidden: r.types.every((x) => !x.occlusion || x.occlusion.every((o) => !o.fully)),
      noErrors: r.errors.length === 0,
    };
    r.ok = Object.values(r.checks).every(Boolean);
    results.S1 = r; console.log('S1', JSON.stringify(r.checks), JSON.stringify({ timeline: r.timeline, after: r.after, types: r.types })); save();
  }
  if (only.includes('S2')) {
    const r = await runScenario('S2', { region: 2, reduced: false, skipAtMs: 1600 });
    r.checks = {
      allFourTypes: ['navigation', 'listening', 'ordered_navigation', 'symbol_matching'].every((x) => r.solved.typesSeen.includes(x)),
      skipFinishesLights: r.solved.skip && r.solved.skip.after.lit >= 0.99 && r.solved.skip.after.hidden === true,
      lightsWereRising: r.solved.skip && r.solved.skip.before.lit < 0.99,
      mapAfterSkip: r.solved.skip && r.solved.skip.after.mapOpen === true,
      backToSteer: r.solved.skip && r.solved.skip.after.mode === 'steer' && r.after.eventHidden,
      noErrors: r.errors.length === 0,
    };
    r.ok = Object.values(r.checks).every(Boolean);
    results.S2 = r; console.log('S2', JSON.stringify(r.checks), JSON.stringify({ skip: r.solved.skip, after: r.after, timeline: r.timeline })); save();
  }
  if (only.includes('S3')) {
    const r = await runScenario('S3', { region: 3, reduced: true });
    const t = r.timeline;
    r.checks = {
      allFourTypes: ['navigation', 'listening', 'ordered_navigation', 'symbol_matching'].every((x) => r.solved.typesSeen.includes(x)),
      barsStaticFull: t.startBars !== null && t.startBars >= 0.99,
      titleAt1200: t.titleOn !== null && t.titleOn >= 1100 && t.titleOn <= 1900,
      endedAroundTwo: t.lastEventSince !== null && t.lastEventSince >= 1200 && t.lastEventSince <= 2700,
      cameraFixed: t.cameraMode.includes('lighthouse') && Math.abs(t.lighthouseDistAtEnd - 45) < 1.5 && Math.abs(t.lighthouseYAtEnd - 24) < 0.6,
      lightPlanReduced: !!t.lightPlan && Math.abs(t.lightPlan.duration - 1) < 1e-6 && t.lightPlan.delay <= 0.2 + 1e-6 && t.lightPlan.delay >= 0,
      litAfterEvent: r.after.lit >= 0.99,
      backToSteer: r.after.mode === 'steer' && r.after.eventHidden,
      noErrors: r.errors.length === 0,
    };
    r.ok = Object.values(r.checks).every(Boolean);
    results.S3 = r; console.log('S3', JSON.stringify(r.checks), JSON.stringify({ timeline: r.timeline, after: r.after })); save();
  }
  console.log('DONE', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.ok]))));
})();

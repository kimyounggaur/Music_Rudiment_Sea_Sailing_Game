'use strict';
/*
 * RM8 장시간 안정성 시험 — 설계서 9장 RM8 #4.
 *   30분(기본) 연속 항해하면서 도감 50회, 메뉴 50회, 시련 20회, 화면 회전 20회를 한다(기존 절차와 같다).
 *   일정 간격으로 자원 수를 재서, 렌더 타깃·셰이더 프로그램·지오메트리·텍스처·리스너·DOM 노드가 늘지 않는지 본다.
 *   헤드리스 SwiftShader라 프레임 속도는 의미가 없다. 이 시험은 "개수가 늘지 않는가"만 본다.
 *
 *   워밍업 투어(--tour 1, 기본): 재기 전에 해역 9곳의 랜드마크 근경·원경 자리로 한 번씩 순간이동해 화면에 그리고, 시련 부표를 한 번 띄운다.
 *     랜드마크 부품·시련 부표 표지(스프라이트)는 "처음 화면에 그려질 때" 렌더러에 한 번 올라가는 유한한 자원이다. 배가 원을 도는 동안 몇십 분 뒤에야
 *     처음 보이면 그때 개수가 늘어 누수처럼 보인다(처음 돌린 30분에서 지오메트리 +7·텍스처 +1·프로그램 +1이 그렇게 잡혔고, 장면 쪽 개수는 늘지 않았다).
 *     투어가 올린 양은 결과 JSON(tour)에 그대로 적고, 그 뒤 30분의 증가가 0이어야 통과한다. 누수라면 투어 뒤에도 계속 는다.
 *   활동에 따라 오르내리는 개수(오디오 소스·인터벌·UI 타이머·카운트업)는 끝 표본과 워밍업 표본의 차이가 우연에 좌우되므로 바닥값(구간 최솟값)이 오르는지로 본다.
 *   오디오 타임아웃은 바닥값으로 보지 않는다(RM9에서 바꿈). 대기 중 개수가 음악 문구에 따라 1~23을 오가서(문구 사이엔 1, 문구 중엔 4~23) 바닥값은 "그 구간에 쉬는 순간이 있었는가"를 잰다.
 *     RM9의 첫 30분은 앞 구간 표본 9개 중 7개가 쉬는 순간(1)이고 뒤 구간은 한 번도 쉬지 않아(최솟값 4) 바닥이 1→4로 올라 실패했다. 그 결과는 rm9-endurance-run1-floors.json 에 그대로 있다.
 *     누수를 직접 보려고 **오래 남은 타임아웃**을 센다: 소유 타임아웃은 예약 시각에 실행되며 스스로 사라지므로, 예약 시각을 15초 넘기고도 남아 있다면(설치 전부터 있던 것은 60초) 실행되지 못한 것이다.
 *     모든 표본에서 그 수가 0이어야 통과한다. 바닥값은 참고로 결과 JSON(floors)에 남는다.
 *
 * 사용: BASE_URL=http://127.0.0.1:8766 node rm8-endurance.cjs [--minutes 30] [--out output/playwright/rm8-endurance.json] [--query "?qa=1"]
 *   --minutes 2 로 짧게 점검할 수 있다. 결과 JSON과 요약을 쓰고, 증가가 있으면 종료 코드 1.
 */
const fs = require('fs');
const path = require('path');
const { open, frames, teleport, outPath } = require('./lib.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; };
const MINUTES = Number(arg('minutes', 30));
const SAMPLE_MS = Number(arg('sample', 60000));
const QUERY = arg('query', '?qa=1');
const OUT = arg('out', path.join('output', 'playwright', 'rm8-endurance.json'));
const TOUR = arg('tour', '1') === '1';
// 랜드마크 근경(겨냥점에서 바깥으로 95 m)·원경(200 m) 자리. 값은 rm6-landmark.cjs의 촬영 지점 표와 같다.
const CENTERS = [[0, -430], [0, -260], [203, -162], [253, 58], [113, 234], [-113, 234], [-253, 58], [-203, -162], [0, 0]];
const AIM = { 1: [5, -35], 2: [-1, 0], 3: [1, -1], 4: [-3.5, 4.4], 5: [-1.5, -9], 6: [0, 0], 7: [0, 0], 8: [0, 12.9] };
const OUT_DIR = { 1: [-0.8, -0.6], 8: [0.434, -0.901] };
function tourSpot(region, dist) {
  if (region === 0) return dist < 100 ? { x: 0, z: -370, h: 0 } : { x: 0, z: -262, h: Math.PI }; // 항구(rm6-landmark.cjs의 close·farN)
  const c = CENTERS[region], a = AIM[region] || [0, 0], len = Math.hypot(c[0], c[1]);
  const d = OUT_DIR[region] || (len > 1 ? [c[0] / len, c[1] / len] : [0, -1]);
  return { x: c[0] + a[0] + d[0] * dist, z: c[1] + a[1] + d[1] * dist, h: Math.atan2(-d[0], -d[1]) };
}
const WARMUP_MS = Math.min(180000, MINUTES * 60000 * 0.15); // 처음 15%(최대 3분)는 워밍업: 지연 생성되는 자원을 센 뒤부터 증가를 본다

// 오디오 타임아웃 감사(QA 전용): 오디오 엔진의 ownTimeout을 감싸 만든 시각을 적어 두고, 예약 시각을 한참 넘겨 남아 있는 것을 센다.
const AUDIT_INSTALL = () => {
  const g = window.__OCEAN_GAME__, audio = g.audio, a = { created: new Map(), pre: new Map() };
  const t0 = performance.now();
  for (const [id] of audio.ownedTimeouts) a.pre.set(id, t0);
  const orig = audio.ownTimeout.bind(audio);
  audio.ownTimeout = (callback, delay, label) => {
    const id = orig(callback, delay, label);
    a.created.set(id, { at: performance.now(), delay: Math.max(0, delay) });
    return id;
  };
  a.measure = () => {
    const now = performance.now();
    for (const id of [...a.created.keys()]) if (!audio.ownedTimeouts.has(id)) a.created.delete(id);
    for (const id of [...a.pre.keys()]) if (!audio.ownedTimeouts.has(id)) a.pre.delete(id);
    let overdue = 0, maxLate = 0, pending = 0;
    for (const [id] of audio.ownedTimeouts) {
      pending++;
      const c = a.created.get(id), p = a.pre.get(id);
      const late = c ? now - c.at - c.delay : p !== undefined ? now - p : 0; // 예약 시각을 넘긴 시간(설치 전부터 있던 것은 설치 뒤 경과)
      maxLate = Math.max(maxLate, late);
      if (late > (c ? 15000 : 60000)) overdue++;
    }
    return { overdue, maxLate: Math.round(maxLate), pending };
  };
  window.__RM9_AUDIT__ = a;
};

const SNAP = () => {
  const g = window.__OCEAN_GAME__, s = g.stabilitySnapshot('sample'), p = g.pipeline ? g.pipeline.snapshot() : null;
  const au = window.__RM9_AUDIT__ ? window.__RM9_AUDIT__.measure() : null;
  return {
    at: Date.now(), mode: s.mode, frame: s.frame,
    objects: s.resources.objects, geometries: s.resources.rendererGeometries, textures: s.resources.rendererTextures, programs: s.resources.rendererPrograms,
    sceneGeometries: s.resources.geometries, sceneMaterials: s.resources.materials, sceneTextures: s.resources.textures,
    targets: p ? p.targetCount : null, targetsCreated: p ? p.counters.created : null, targetsDisposed: p ? p.counters.disposed : null,
    pipelineFailed: p ? p.failed : null, plan: p && p.plan ? p.plan.fx + '/' + p.plan.reflect + '/' + p.plan.post : null,
    listeners: s.app.listeners, domNodes: s.app.domNodes, canvases: s.app.canvases, uiTimers: s.app.uiTimers, activeTimers: s.app.activeTimers, countUps: s.app.countUps,
    audioSources: s.audio.activeSources, audioTimeouts: s.audio.timeouts, audioIntervals: s.audio.intervals,
    audioOverdue: au ? au.overdue : null, audioMaxLateMs: au ? au.maxLate : null,
    particles: s.effects.particles, heap: s.memory.usedJSHeapSize,
    fpsAvg: s.performance && s.performance.averageFps, uiAvgMs: g.ux && g.ux.uiSamples ? g.ux.uiTotal / g.ux.uiSamples : null,
  };
};

(async () => {
  const { browser, page, errors } = await open({ query: QUERY, width: 1440, height: 900 });
  let t0 = Date.now();
  const targetMs = MINUTES * 60000;
  const samples = [], cycles = { codex: 0, menu: 0, trial: 0, rotation: 0 };
  let tour = null;
  try {
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.click('#start-sailing');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
      a.questQa.prepare(1); g.audio.setMuted(true);
      const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
    });
    if (TOUR) {
      const counts = () => page.evaluate(() => { const i = window.__OCEAN_GAME__.renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs.length }; });
      const home = await page.evaluate(() => { const g = window.__OCEAN_GAME__; return { x: g.motion.x, z: g.motion.z, h: g.motion.heading }; });
      const before = await counts(), stops = [];
      for (let region = 0; region < 9; region++) {
        for (const [kind, dist] of [['근경', 95], ['원경', 200]]) {
          await teleport(page, tourSpot(region, dist), { settle: 6 });
          // 랜드마크 모델은 거리에 따라 늦게 불러온다: 불러올 때까지(최대 20초) 기다렸다가 몇 프레임 더 그린다
          const ready = await page.waitForFunction((r) => { const e = window.__OCEAN_GAME__.remaster.landmarks.entries.find((x) => x.spec.region === r); return !e || Boolean(e.error) || (e.far.status === 'ready' && (e.near.status === 'ready' || e.near.status === 'failed')); }, region, { timeout: 20000 }).then(() => true, () => false);
          await frames(page, 6);
          stops.push({ region, kind, ready, ...(await counts()) });
        }
      }
      // 시련 부표(스프라이트 표지 포함)를 한 번 화면에 그린다
      await teleport(page, home, { settle: 6 });
      await page.evaluate(() => window.__OCEAN_GAME__.startRegionTrial(1));
      await frames(page, 6);
      await page.evaluate(() => window.__OCEAN_GAME__.exitTrial());
      await frames(page, 6);
      await page.evaluate(() => { const g = window.__OCEAN_GAME__; if (window.__OCEAN_API__.cameraQa) window.__OCEAN_API__.cameraQa.snap(); g.keys.clear(); });
      await teleport(page, home, { settle: 8 });
      const after = await counts();
      tour = { before, after, added: { geometries: after.geometries - before.geometries, textures: after.textures - before.textures, programs: after.programs - before.programs }, stops };
      console.log('투어(랜드마크 9곳 × 근·원경 + 시련 부표)가 올린 렌더러 자원', JSON.stringify(tour.added), '(전', JSON.stringify(before), '→ 후', JSON.stringify(after) + ')');
      t0 = Date.now(); // 재는 30분은 투어가 끝난 뒤부터
    }
    await page.evaluate(() => {
      const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
      g.setStabilityBaseline('rm8-endurance'); g.startEndurance(); g.keys.add('w'); g.keys.add('d');
      window.__RM8__ = { errors: [] };
      window.addEventListener('error', (e) => window.__RM8__.errors.push(e.message));
      window.addEventListener('unhandledrejection', (e) => window.__RM8__.errors.push(String(e.reason)));
    });
    await page.evaluate(AUDIT_INSTALL);
    samples.push({ label: 'start', ...(await page.evaluate(SNAP)) });
    let nextSample = Date.now() + SAMPLE_MS, rotations = 0;
    const sizes = [{ width: 844, height: 390 }, { width: 1440, height: 900 }];
    while (Date.now() - t0 < targetMs) {
      // 한 바퀴: 항해 중일 때만 도감·메뉴(·시련) 한 번씩. 위의 목표 횟수를 다 채우면 항해만 계속한다.
      const did = await page.evaluate(({ doCodex, doMenu, doTrial }) => {
        const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__, mode = g.stabilitySnapshot().mode;
        if (mode === 'TERM_POPUP') g.closeTermCard();
        if (mode === 'DIALOG') g.closeKeeperDialogue();
        if (g.stabilitySnapshot().mode !== 'SAILING') return { skipped: mode };
        g.keys.clear();
        const out = {};
        if (doCodex) { g.openCodex(); const t = a.TERMS.find((term) => term.region === 1); g.showCodexDetail(t); g.closeCodex(); out.codex = 1; }
        if (doMenu) { g.openPause(); g.showMenuTab('settings'); g.showMenuTab('controls'); g.closePause(); out.menu = 1; }
        if (doTrial) { g.startRegionTrial(1); g.exitTrial(); out.trial = 1; }
        g.keys.add('w'); g.keys.add('d');
        return out;
      }, { doCodex: cycles.codex < 50, doMenu: cycles.menu < 50, doTrial: cycles.trial < 20 });
      if (did.codex) cycles.codex++;
      if (did.menu) cycles.menu++;
      if (did.trial) cycles.trial++;
      // 화면 회전 20회: 작업 사이사이에 뷰포트를 번갈아 바꾼다
      if (cycles.rotation < 20 && (did.codex || did.menu)) { await page.setViewportSize(sizes[rotations++ % 2]); cycles.rotation++; }
      if (Date.now() >= nextSample) { samples.push({ label: 'min' + ((Date.now() - t0) / 60000).toFixed(1), ...(await page.evaluate(SNAP)) }); nextSample += SAMPLE_MS; console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}분]`, JSON.stringify(cycles), 'obj', samples[samples.length - 1].objects, 'geo', samples[samples.length - 1].geometries, 'prog', samples[samples.length - 1].programs, 'targets', samples[samples.length - 1].targets); }
      await page.waitForTimeout(Math.max(1200, Math.floor(targetMs / 120)));
    }
    await page.evaluate(() => window.__OCEAN_GAME__.keys.clear());
    samples.push({ label: 'end', ...(await page.evaluate(SNAP)) });
    const delta = await page.evaluate(() => { const g = window.__OCEAN_GAME__; const d = g.stabilityDelta(); return d.delta; });
    const pageErrors = await page.evaluate(() => window.__RM8__.errors);
    // 판정: 워밍업 뒤 첫 표본과 마지막 표본을 비교한다. 늘면 위반(힙은 참고만).
    const warm = samples.find((s) => s.at - t0 >= WARMUP_MS) || samples[0], last = samples[samples.length - 1];
    const keys = ['geometries', 'textures', 'programs', 'targets', 'listeners', 'canvases', 'uiTimers', 'countUps', 'audioSources', 'audioTimeouts', 'audioIntervals'];
    // 활동에 따라 오르내리는 개수(오디오 소스·타임아웃·UI 타이머·카운트업)는 두 시점의 차이가 우연(그 순간 소리가 나고 있었는가)에 좌우된다.
    // 첫 30분 시험에서 오디오 소스가 3~37 사이를 오갔고 끝 표본이 우연히 낮아 통과처럼 보였다. 그래서 이 개수들은 "바닥값"(구간 최솟값)이 오르는지로 본다:
    // 워밍업 뒤 표본을 셋으로 나눠 앞 구간의 최솟값과 뒤 구간의 최솟값을 비교한다(누수라면 바닥이 오른다). 나머지(지오메트리·텍스처·프로그램·렌더 타깃·리스너·캔버스)는 끝-워밍업을 그대로 본다.
    const ACTIVITY = ['audioSources', 'audioTimeouts', 'audioIntervals', 'uiTimers', 'countUps'];
    const afterWarm = samples.filter((sm) => sm.at - t0 >= WARMUP_MS && sm.label !== 'start');
    const third = Math.max(1, Math.floor(afterWarm.length / 3)), early = afterWarm.slice(0, third), late = afterWarm.slice(-third);
    const floorOf = (list, k) => Math.min(...list.map((sm) => sm[k] ?? 0));
    const growth = {}, growthEndVsWarm = {}, floors = {};
    const overdueMax = Math.max(0, ...samples.map((sm) => sm.audioOverdue ?? 0)), maxLateMs = Math.max(0, ...samples.map((sm) => sm.audioMaxLateMs ?? 0));
    for (const k of keys) {
      growthEndVsWarm[k] = (last[k] ?? 0) - (warm[k] ?? 0);
      if (ACTIVITY.includes(k)) { floors[k] = { early: floorOf(early, k), late: floorOf(late, k), samplesPerThird: third }; growth[k] = floors[k].late - floors[k].early; }
      else growth[k] = growthEndVsWarm[k];
      if (k === 'audioTimeouts') { growth.audioTimeoutsOverdue = overdueMax; delete growth[k]; } // 바닥값 대신 오래 남은 타임아웃 수(위 머리말)
    }
    const legacyFloorBad = Object.entries(floors).filter(([, v]) => v.late - v.early > 0).map(([k, v]) => `${k} +${v.late - v.early}`);
    const soft = { objects: last.objects - warm.objects, domNodes: last.domNodes - warm.domNodes, heapMB: warm.heap && last.heap ? Math.round((last.heap - warm.heap) / 1048576 * 10) / 10 : null, targetsCreatedMinusDisposed: last.targetsCreated - last.targetsDisposed };
    const bad = Object.entries(growth).filter(([, v]) => v > 0).map(([k, v]) => `${k} +${v}`);
    if (soft.domNodes > 40) bad.push(`domNodes +${soft.domNodes}`);
    const result = { minutes: MINUTES, elapsedMs: Date.now() - t0, criterion: 'overdue-timeouts', cycles, warmupAt: warm.label, tour, growth, growthEndVsWarm, floors, legacyFloorBad, audioMaxLateMs: maxLateMs, soft, bad, errors: errors.concat(pageErrors), delta, samples };
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
    console.log('주기', JSON.stringify(cycles), '경과(분)', (result.elapsedMs / 60000).toFixed(1));
    console.log('증가(워밍업 뒤 → 끝; 오디오·타이머류는 바닥값 앞 구간 → 뒤 구간)', JSON.stringify(growth), '참고', JSON.stringify(soft));
    console.log('오디오 타임아웃: 오래 남은 것 최대', overdueMax, '개 · 예약 시각을 넘긴 시간 최대', maxLateMs, 'ms · 구간 바닥값 방식(참고)의 판정:', legacyFloorBad.length ? legacyFloorBad.join(', ') : '증가 없음');
    console.log('끝-워밍업 차(참고)', JSON.stringify(growthEndVsWarm), '바닥값', JSON.stringify(floors));
    console.log('오류', JSON.stringify(result.errors.slice(0, 4)));
    const ok = !bad.length && !result.errors.length && cycles.codex >= Math.min(50, MINUTES >= 10 ? 50 : 1) && last.pipelineFailed !== true;
    console.log(ok ? 'ENDURANCE PASS' : 'ENDURANCE FAIL ' + bad.join(', '));
    await browser.close();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('ENDURANCE ERROR', String(e && e.stack || e).slice(0, 800));
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e), cycles, samples, errors }, null, 1));
    await browser.close();
    process.exit(2);
  }
})();

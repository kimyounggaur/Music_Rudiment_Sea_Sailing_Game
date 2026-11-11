'use strict';
/*
 * RM8 장시간 안정성 시험 — 설계서 9장 RM8 #4.
 *   30분(기본) 연속 항해하면서 도감 50회, 메뉴 50회, 시련 20회, 화면 회전 20회를 한다(기존 절차와 같다).
 *   일정 간격으로 자원 수를 재서, 렌더 타깃·셰이더 프로그램·지오메트리·텍스처·리스너·DOM 노드가 늘지 않는지 본다.
 *   헤드리스 SwiftShader라 프레임 속도는 의미가 없다. 이 시험은 "개수가 늘지 않는가"만 본다.
 *
 * 사용: BASE_URL=http://127.0.0.1:8766 node rm8-endurance.cjs [--minutes 30] [--out output/playwright/rm8-endurance.json] [--query "?qa=1"]
 *   --minutes 2 로 짧게 점검할 수 있다. 결과 JSON과 요약을 쓰고, 증가가 있으면 종료 코드 1.
 */
const fs = require('fs');
const path = require('path');
const { open, outPath } = require('./lib.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; };
const MINUTES = Number(arg('minutes', 30));
const SAMPLE_MS = Number(arg('sample', 60000));
const QUERY = arg('query', '?qa=1');
const OUT = arg('out', path.join('output', 'playwright', 'rm8-endurance.json'));
const WARMUP_MS = Math.min(180000, MINUTES * 60000 * 0.15); // 처음 15%(최대 3분)는 워밍업: 지연 생성되는 자원을 센 뒤부터 증가를 본다

const SNAP = () => {
  const g = window.__OCEAN_GAME__, s = g.stabilitySnapshot('sample'), p = g.pipeline ? g.pipeline.snapshot() : null;
  return {
    at: Date.now(), mode: s.mode, frame: s.frame,
    objects: s.resources.objects, geometries: s.resources.rendererGeometries, textures: s.resources.rendererTextures, programs: s.resources.rendererPrograms,
    sceneGeometries: s.resources.geometries, sceneMaterials: s.resources.materials, sceneTextures: s.resources.textures,
    targets: p ? p.targetCount : null, targetsCreated: p ? p.counters.created : null, targetsDisposed: p ? p.counters.disposed : null,
    pipelineFailed: p ? p.failed : null, plan: p && p.plan ? p.plan.fx + '/' + p.plan.reflect + '/' + p.plan.post : null,
    listeners: s.app.listeners, domNodes: s.app.domNodes, canvases: s.app.canvases, uiTimers: s.app.uiTimers, activeTimers: s.app.activeTimers, countUps: s.app.countUps,
    audioSources: s.audio.activeSources, audioTimeouts: s.audio.timeouts, audioIntervals: s.audio.intervals,
    particles: s.effects.particles, heap: s.memory.usedJSHeapSize,
    fpsAvg: s.performance && s.performance.averageFps, uiAvgMs: g.ux && g.ux.uiSamples ? g.ux.uiTotal / g.ux.uiSamples : null,
  };
};

(async () => {
  const { browser, page, errors } = await open({ query: QUERY, width: 1440, height: 900 });
  const t0 = Date.now(), targetMs = MINUTES * 60000;
  const samples = [], cycles = { codex: 0, menu: 0, trial: 0, rotation: 0 };
  try {
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.click('#start-sailing');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
      a.questQa.prepare(1); g.audio.setMuted(true);
      const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
      g.setStabilityBaseline('rm8-endurance'); g.startEndurance(); g.keys.add('w'); g.keys.add('d');
      window.__RM8__ = { errors: [] };
      window.addEventListener('error', (e) => window.__RM8__.errors.push(e.message));
      window.addEventListener('unhandledrejection', (e) => window.__RM8__.errors.push(String(e.reason)));
    });
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
    const growth = {};
    for (const k of keys) growth[k] = (last[k] ?? 0) - (warm[k] ?? 0);
    const soft = { objects: last.objects - warm.objects, domNodes: last.domNodes - warm.domNodes, heapMB: warm.heap && last.heap ? Math.round((last.heap - warm.heap) / 1048576 * 10) / 10 : null, targetsCreatedMinusDisposed: last.targetsCreated - last.targetsDisposed };
    const bad = Object.entries(growth).filter(([, v]) => v > 0).map(([k, v]) => `${k} +${v}`);
    if (soft.domNodes > 40) bad.push(`domNodes +${soft.domNodes}`);
    const result = { minutes: MINUTES, elapsedMs: Date.now() - t0, cycles, warmupAt: warm.label, growth, soft, bad, errors: errors.concat(pageErrors), delta, samples };
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
    console.log('주기', JSON.stringify(cycles), '경과(분)', (result.elapsedMs / 60000).toFixed(1));
    console.log('증가(워밍업 뒤 → 끝)', JSON.stringify(growth), '참고', JSON.stringify(soft));
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

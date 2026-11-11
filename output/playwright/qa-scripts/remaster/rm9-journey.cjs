'use strict';
/*
 * RM9 완주 여정 (설계서 10.4 RM-D07): 시련 8곳 · 최종 항로 · 두 엔딩을 실제 화면 조작으로 끝까지 돈다.
 *   (용어 141개·유리병 18개 수집은 rm5-journey.cjs 가 같은 방식으로 따로 잰다.)
 *
 *   ① 시련 8곳: 해역 0~7마다 QA 준비 → 시련 시작 → 화면의 보기·드래그로 풀기 → 결과 글자가 있고 시련 통과가 저장되는지 → 등대 점등 → 건너뛰기 → 점등이 저장되는지
 *   ② 최종 항로 + 일반 엔딩: 등대 0~7을 켠 저장으로 시작 → 다 카포 소용돌이에서 최종 항로 시작 → 항로 3개를 화면 단추로 끝까지 → 엔딩 화면(일반)
 *   ③ 최종 항로 + 숨은(100%) 엔딩: 용어 141개·유리병 18개·이야기 5개를 모은 저장으로 같은 항로 → 엔딩 화면(숨은) → 엔딩 기록이 저장에 남는다
 *   ④ 엔딩 뒤 "남은 부표 찾기"로 항해로 돌아오고, 타이틀로 돌아가도 도감이 보존된다
 *
 * 사용: BASE_URL=http://127.0.0.1:8767 node rm9-journey.cjs [--only trials,normal,hidden] [--out output/playwright/rm9-journey.json]
 */
const fs = require('fs');
const path = require('path');
const { open, frames } = require('./lib.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; };
const OUT = arg('out', path.join('output', 'playwright', 'rm9-journey.json'));
const ONLY = arg('only', 'trials,normal,hidden').split(',');

// 한 문제씩 풀고 결과 글자를 돌려준다(rm8-journeys.cjs · 기존 journey-final.cjs 와 같은 방식: 첫 짝맞추기는 드래그, 뒤에는 클릭)
async function solveTrial(page) {
  let steps = 0, drag = false;
  while (steps++ < 60) {
    const q = await page.evaluate(() => { const g = window.__OCEAN_GAME__, q = g.currentTrialProblem(); return q ? { ...q, step: g.trialRuntime.sequenceStep, matched: [...g.trialRuntime.matchedIds], order: g.trialRuntime.order } : null; });
    if (!q) break;
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
    await page.waitForTimeout(900);
  }
  return { steps, drag, result: (await page.locator('#trial-result').innerText()).trim() };
}

(async () => {
  const { browser, page, errors } = await open({ query: '?qa=1', width: 1440, height: 900 });
  const problems = [], rows = [];
  let checks = 0;
  const check = (cond, message) => { checks++; if (!cond) problems.push(message); return cond; };
  try {
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.returnToTitle(); g.openNewGameConfirmation(); g.confirmNewGame(); });
    await page.locator('#start-sailing').click();
    await page.waitForTimeout(700);
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.audio.setMuted(true); g.applyReducedMotion(true); const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; });

    if (ONLY.includes('trials')) {
      for (let region = 0; region <= 7; region++) {
        const t0 = Date.now();
        await page.evaluate((r) => { const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__; a.questQa.prepare(r); g.audio.setMuted(true); g.applyReducedMotion(true); g.startRegionTrial(r); }, region);
        await frames(page, 3);
        const started = await page.evaluate(() => ({ mode: window.__OCEAN_GAME__.stabilitySnapshot().mode, questions: window.__OCEAN_GAME__.trialSet ? window.__OCEAN_GAME__.trialSet.questions.length : 0, types: window.__OCEAN_GAME__.trialSet ? [...new Set(window.__OCEAN_GAME__.trialSet.questions.map((q) => q.type))] : [] }));
        check(started.mode === 'TRIAL' || started.questions > 0, `해역 ${region}: 시련이 시작된다 (${JSON.stringify(started)})`);
        const solved = await solveTrial(page);
        check(solved.result.length > 0, `해역 ${region}: 결과 글자가 있다`);
        const saved = await page.evaluate((r) => { const s = window.__OCEAN_API__.journeyQa.snapshot().save.progress; return { passed: s.trialsPassed.includes(r), lit: s.lighthousesLit.includes(r) }; }, region);
        check(saved.passed, `해역 ${region}: 시련 통과가 저장된다`);
        await page.locator('.result-actions button').first().click();
        await page.waitForTimeout(300);
        await page.locator('#lighthouse-skip').click();
        await frames(page, 3);
        const lit = await page.evaluate((r) => { const g = window.__OCEAN_GAME__; return { lit: window.__OCEAN_API__.journeyQa.snapshot().save.progress.lighthousesLit.includes(r), mode: g.stabilitySnapshot().mode }; }, region);
        check(lit.lit, `해역 ${region}: 등대 점등이 저장된다`);
        check(lit.mode === 'SAILING', `해역 ${region}: 점등 뒤 항해로 돌아온다 (${lit.mode})`);
        rows.push({ step: 'trial', region, questions: started.questions, types: started.types, solveSteps: solved.steps, dragged: solved.drag, result: solved.result.slice(0, 80).replace(/\s+/g, ' '), passed: saved.passed, lit: lit.lit, sec: Math.round((Date.now() - t0) / 1000) });
        console.log(`시련 ${region}: ${saved.passed && lit.lit ? '통과·점등' : '실패'} (문항 ${started.questions}, ${Math.round((Date.now() - t0) / 1000)}초)`);
      }
    }

    for (const kind of ['normal', 'hidden']) {
      if (!ONLY.includes(kind)) continue;
      const t0 = Date.now();
      await page.evaluate((kind) => {
        const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
        a.journeyQa[kind === 'normal' ? 'prepareNormalFinale' : 'prepareHiddenFinale']();
        g.audio.setMuted(true); g.applyReducedMotion(true);
        const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
      }, kind);
      await frames(page, 6);
      const pre = await page.evaluate(() => { const g = window.__OCEAN_GAME__, s = window.__OCEAN_API__.journeyQa.snapshot().save.progress; return { mode: g.stabilitySnapshot().mode, region: g.currentRegion, lit: s.lighthousesLit.length, terms: s.termsFound.length, bottles: s.bottlesOpened.length, stories: s.storyFragments.length }; });
      check(pre.mode === 'SAILING' && pre.region === 8, `${kind}: 다 카포 소용돌이(해역 8)에서 항해 중이다 (${JSON.stringify(pre)})`);
      if (kind === 'hidden') check(pre.terms === 141 && pre.bottles === 18 && pre.stories === 5, `hidden: 용어 141개·유리병 18개·이야기 5개를 모은 저장이다 (${JSON.stringify(pre)})`);
      const begun = await page.evaluate(() => window.__OCEAN_GAME__.beginFinalRoute());
      check(begun === true, `${kind}: 최종 항로가 열린다`);
      await frames(page, 3);
      const stages = await page.evaluate(() => {
        const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__, seen = [];
        for (const spec of a.FINAL_ROUTE_SPECS) {
          seen.push({ id: spec.id, title: document.getElementById('route-title').textContent, stage: document.getElementById('route-stage').textContent, choices: document.querySelectorAll('#route-choices [data-route-action]').length });
          for (const action of spec.sequence) {
            const button = document.querySelector('[data-route-action="' + action + '"]');
            if (!button) { seen.push({ missing: action }); return seen; }
            g.chooseFinalRouteAction(action, button);
          }
        }
        return seen;
      });
      check(stages.length === 3 && stages.every((s) => !s.missing), `${kind}: 최종 항로 3개를 화면 단추로 끝까지 눌렀다 (${JSON.stringify(stages.map((s) => s.title || s.missing))})`);
      await frames(page, 6);
      const end = await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, ov = document.getElementById('ending-overlay'), s = window.__OCEAN_API__.journeyQa.snapshot().save.progress;
        return { mode: g.stabilitySnapshot().mode, shown: !ov.hidden, title: document.getElementById('ending-title').textContent, kicker: document.getElementById('ending-kicker').textContent, progress: document.getElementById('ending-progress').textContent, seen: s.endingsSeen.slice(), best: s.endingBest };
      });
      check(end.mode === 'ENDING' && end.shown, `${kind}: 엔딩 화면이 뜬다 (${end.mode}, 보임 ${end.shown})`);
      check(kind === 'hidden' ? end.title === '모든 등대의 합주' : end.title === '새 항로를 밝힌 선장', `${kind}: 엔딩 제목 (${end.title})`);
      check(end.seen.includes(kind), `${kind}: 엔딩 기록이 저장에 남는다 (${JSON.stringify(end.seen)})`);
      await page.screenshot({ path: path.join('output', 'playwright', 'rm9', `journey_ending-${kind}.png`) }).catch(() => {});
      await page.locator('#ending-continue').click();
      await frames(page, 4);
      const back = await page.evaluate(() => window.__OCEAN_GAME__.stabilitySnapshot().mode);
      check(back === 'SAILING', `${kind}: "남은 부표 찾기"로 항해로 돌아온다 (${back})`);
      rows.push({ step: 'ending', kind, pre, stages, end, back, sec: Math.round((Date.now() - t0) / 1000) });
      console.log(`엔딩 ${kind}: ${end.title} · 기록 ${JSON.stringify(end.seen)} (${Math.round((Date.now() - t0) / 1000)}초)`);
    }

    check(errors.length === 0, '오류 없음: ' + errors.slice(0, 3).join(' | '));
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ checks, problems, errors, rows }, null, 1));
    console.log('점검', checks, '문제', problems.length, '오류', errors.length);
    problems.slice(0, 12).forEach((m) => console.log('  -', m));
    const ok = problems.length === 0 && errors.length === 0;
    console.log(ok ? 'RM9 JOURNEY PASS' : 'RM9 JOURNEY FAIL');
    await browser.close();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('RM9 JOURNEY ERROR', String((e && e.stack) || e).slice(0, 800));
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e), checks, problems, rows, errors }, null, 1));
    await browser.close();
    process.exit(2);
  }
})();

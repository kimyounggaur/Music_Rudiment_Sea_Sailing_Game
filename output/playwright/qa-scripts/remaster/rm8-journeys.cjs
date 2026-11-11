'use strict';
/*
 * RM8 핵심 여정 × 접근성 조건 (설계서 9장 RM8 #5): 동작 줄이기 · 무음 · 글자 배율 1.3 · 그레이스케일 각각으로 같은 여정을 끝까지 돈다.
 *   여정(기존 journey-final.cjs와 같은 흐름): 새 게임 → 항해 안내 → 용어 발견·도감 → 항구 수호자 대화 → 시련(드래그 짝 맞추기 포함) → 등대 점등 → 해역 3 시련 → 등대 점등.
 *   조건마다 확인하는 것: 오류 0 · 시련 2개 통과·등대 2개 점등 · 조건별 상태(동작 줄이기: 움직이는 CSS 애니메이션 · 글자 배율: 안전영역·가로 넘침 · 그레이스케일: 색이 아닌 단서(글자·아이콘)가 있는 피드백).
 *   마지막으로 조건마다 항해 화면·시련 화면을 한 장씩 찍는다(output/playwright/rm8/journey_<조건>_*.png).
 *
 * 사용: BASE_URL=http://127.0.0.1:8767 node rm8-journeys.cjs [--only reduced,muted,scale13,scale13-phone,gray] [--out output/playwright/rm8-journeys.json]
 */
const fs = require('fs');
const path = require('path');
const { open, frames, outPath } = require('./lib.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; };
const OUT = arg('out', path.join('output', 'playwright', 'rm8-journeys.json'));
const ONLY = arg('only', 'reduced,muted,scale13,scale13-phone,gray').split(',');

const CONDITIONS = {
  reduced: { size: [1440, 900], touch: false, setup: async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.evaluate(() => window.__OCEAN_GAME__.applyReducedMotion(true));
  } },
  muted: { size: [1440, 900], touch: false, setup: async (page) => { await page.evaluate(() => window.__OCEAN_GAME__.audio.setMuted(true)); } },
  scale13: { size: [1440, 900], touch: false, setup: async (page) => { await setScale(page); } },
  'scale13-phone': { size: [390, 844], touch: true, setup: async (page) => { await setScale(page); } },
  gray: { size: [1440, 900], touch: false, setup: async (page) => { await page.evaluate(() => { document.documentElement.style.filter = 'grayscale(1)'; }); } },
};

async function setScale(page) {
  await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.openPause(); g.showMenuTab('settings'); });
  await page.evaluate(() => document.querySelector('[data-text-scale="1.3"]').click());
  await page.evaluate(() => window.__OCEAN_GAME__.closePause());
}

// 기존 journey-final.cjs의 시련 풀이: 한 문제씩 풀고 결과 글자를 돌려준다(첫 시련에서는 드래그로, 그 뒤에는 클릭으로 짝을 맞춘다)
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
  const result = await page.locator('#trial-result').innerText();
  return { steps, drag, passed: result.includes('등대를 밝힐 준비가 됐어요'), result };
}

// 결과 화면의 첫 단추("등대 점등하기")를 눌러 점등 장면을 열고 건너뛴다. 막히면 그때의 상태를 남기고 멈춘다.
//  - 점등 기록(lighthousesLit)이 먼저 남고 장면이 뜬다. 장면은 6초(동작 줄이기 2초) 뒤 저절로 끝난다.
//  - 헤드리스는 프레임이 2~4fps라 Playwright의 클릭 대기("요소가 안정될 때까지")가 장면 길이보다 길어질 수 있다. 처음 돌렸을 때
//    "#lighthouse-skip is not visible"로 시간 초과한 원인이다(단추가 보이는 사이에 장면이 저절로 끝났다). 그래서 기록을 기다린 뒤 DOM 단추를 직접 누른다.
async function lightLighthouse(page, label, trial, region, problems) {
  const where = () => page.evaluate((region) => ({ mode: window.__OCEAN_GAME__.stabilitySnapshot().mode, lit: window.__OCEAN_API__.journeyQa.snapshot().save.progress.lighthousesLit, wanted: region }), region);
  if (!trial.passed) {
    problems.push(label + ': 시련을 통과하지 못했다 ' + JSON.stringify(await where()));
    throw new Error(label + ' 시련 미통과');
  }
  await page.locator('.result-actions button').first().click();
  try {
    await page.waitForFunction((region) => window.__OCEAN_API__.journeyQa.snapshot().save.progress.lighthousesLit.includes(region), region, { timeout: 30000 });
    await page.evaluate(() => { if (window.__OCEAN_GAME__.stabilitySnapshot().mode === 'LIGHTHOUSE_EVENT') document.getElementById('lighthouse-skip').click(); });
    await page.waitForFunction(() => window.__OCEAN_GAME__.stabilitySnapshot().mode === 'SAILING', null, { timeout: 30000 });
  } catch (e) {
    problems.push(label + ': 등대 점등 장면을 지나지 못했다 ' + JSON.stringify(await where()));
    throw e;
  }
}

async function runCondition(name) {
  const cond = CONDITIONS[name];
  const { browser, page, errors } = await open({ query: '?qa=1', width: cond.size[0], height: cond.size[1], touch: cond.touch });
  const problems = [], info = { name, checks: 0 };
  const check = (ok, message) => { info.checks++; if (!ok) problems.push(message); return ok; };
  try {
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.returnToTitle(); g.openNewGameConfirmation(); g.confirmNewGame(); });
    await page.locator('#start-sailing').click();
    await page.waitForTimeout(700);
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.audio.setMuted(true); const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; });
    await cond.setup(page);
    await frames(page, 4);

    // 항해 안내: 목표 글자가 단계마다 바뀐다
    const stage = [];
    const objective = async () => stage.push(await page.locator('#objective-title').textContent());
    // 헤드리스 렌더는 프레임이 느려(2~4fps) 게임 시간이 실제 시계의 몇 %로만 흐른다. 고정 시간(1.8초·0.6초)만 누르면 안내 1단계(2칸 이동)·2단계(방향 0.12rad)의 기준을 못 채운다.
    // 그래서 "목표 글자가 다음 단계로 바뀔 때까지"(최대 120초) 키를 누르고 있다가 뗀다. 사람이 키를 누르고 있는 것과 같은 입력이다.
    const holdUntilNextObjective = async (key, stepNo, maxMs = 120000) => {
      const t0 = Date.now();
      let moved = false;
      await page.keyboard.down(key);
      try {
        while (Date.now() - t0 < maxMs) {
          const title = (await page.locator('#objective-title').textContent()) || '';
          if (!title.startsWith(stepNo + '/6')) { moved = true; break; } // "✓ n/6 · 완료했어요"이거나 다음 단계
          await page.waitForTimeout(300);
        }
      } finally { await page.keyboard.up(key); }
      // 완료 표시가 걷히고 다음 단계 글자가 뜰 때까지(최대 20초)
      for (let i = 0; i < 80; i++) {
        const title = (await page.locator('#objective-title').textContent()) || '';
        if (title.startsWith((stepNo + 1) + '/6') || title.startsWith('✓') === false && !title.startsWith(stepNo + '/6')) break;
        await page.waitForTimeout(250);
      }
      return { key, stepNo, moved, ms: Date.now() - t0 };
    };
    await objective();
    info.tutorialHolds = [];
    info.tutorialHolds.push(await holdUntilNextObjective('w', 1)); await objective();
    info.tutorialHolds.push(await holdUntilNextObjective('d', 2)); await objective();
    check(info.tutorialHolds.every((h) => h.moved), '항해 안내 1·2단계를 키 입력만으로 넘겼다 (' + JSON.stringify(info.tutorialHolds) + ')');
    info.tutorial = stage;
    check(new Set(stage).size >= 2, '항해 안내 목표가 단계마다 바뀐다 (' + JSON.stringify(stage) + ')');

    // 항해 중 조건 상태 한 장
    await page.screenshot({ path: outPath('rm8', `journey_${name}_sailing.png`) });
    const sailingState = await page.evaluate(() => {
      const a = window.__OCEAN_API__, html = document.documentElement;
      return { hud: html.dataset.hud, reduced: html.dataset.reducedMotion || null, scale: html.dataset.textScale || null, center: a.measureCenterSafeZone().violations, overflow: html.scrollWidth > innerWidth, contrast: a.measureContrast().violations.length, touch: a.measureTouchTargets().below44.length, copy: a.auditUiCopy().length,
        animations: document.getAnimations().filter((x) => x.playState === 'running').map((x) => (x.animationName || x.transitionProperty || x.constructor.name) + '@' + ((x.effect && x.effect.target && (x.effect.target.id || x.effect.target.className)) || '')).slice(0, 12) };
    });
    info.sailing = sailingState;

    // 용어 발견 → 듣기 → 도감
    const moveToTerm = (id) => page.evaluate((id) => { const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__, spawn = a.contentQa.term(id).spawn; g.motion.speed = 0; g.motion.x = spawn.x; g.motion.z = spawn.z; g.currentRegion = 0; g.checkTermDiscovery(1); }, id);
    await moveToTerm('r0_staff');
    await page.locator('#term-listen').click();
    await page.screenshot({ path: outPath('rm8', `journey_${name}_term.png`) });
    await page.keyboard.press('Escape');
    await page.keyboard.press('b'); await page.keyboard.press('Escape');
    await objective();
    const ids = await page.evaluate(() => window.__OCEAN_API__.TERMS.filter((t) => t.region === 0 && t.rarity !== 'rare' && t.id !== 'r0_staff').map((t) => t.id));
    for (const id of ids) { await moveToTerm(id); await page.waitForTimeout(40); await page.keyboard.press('Escape'); }

    // 항구 수호자 대화 → 시련(드래그) → 등대
    await page.evaluate(() => window.__OCEAN_GAME__.openKeeperDialogue(0));
    info.harborDialogue = (await page.locator('#dialogue-overlay').innerText()).slice(0, 200);
    await page.locator('#dialogue-start').click();
    if (!cond.touch) await page.setViewportSize({ width: 1440, height: 900 });
    const harbor = await solveTrial(page);
    info.harbor = harbor;
    await page.screenshot({ path: outPath('rm8', `journey_${name}_trial-result.png`) });
    // 그레이스케일 등 색에 기대지 않는 단서: 결과 화면에 글자가 있다
    check(harbor.result.trim().length > 0, '시련 결과 글자가 있다');
    await lightLighthouse(page, '항구 시련', harbor, 0, problems);

    // 해역 3 시련
    await page.evaluate(() => { window.__OCEAN_API__.questQa.prepare(3); window.__OCEAN_GAME__.audio.setMuted(true); window.__OCEAN_GAME__.startRegionTrial(3); });
    const silence = await solveTrial(page);
    info.silence = silence;
    await lightLighthouse(page, '해역 3 시련', silence, 3, problems);

    // 조건별 마무리 확인
    // 음소거는 게임 설정(저장)에 있다. 오디오 엔진 객체에는 muted 속성이 없다(처음에 그 속성을 읽어 점검이 늘 거짓이었다).
    const post = await page.evaluate(() => { const s = window.__OCEAN_API__.journeyQa.snapshot(), html = document.documentElement; return { trials: s.save.progress.trialsPassed, lights: s.save.progress.lighthousesLit, terms: s.save.progress.termsFound.length, mode: window.__OCEAN_GAME__.stabilitySnapshot().mode, reduced: html.dataset.reducedMotion || null, scale: html.dataset.textScale || null, muted: s.save.settings.muted === true, filter: html.style.filter }; });
    info.post = post;
    check(post.trials.includes(0) && post.trials.includes(3), '시련 2개 통과 (' + JSON.stringify(post.trials) + ')');
    check(post.lights.includes(0) && post.lights.includes(3), '등대 2개 점등 (' + JSON.stringify(post.lights) + ')');
    check(post.terms >= 1, '용어를 발견했다 (' + post.terms + ')');
    check(post.mode === 'SAILING', '여정이 끝나면 항해 상태 (' + post.mode + ')');
    check(post.muted, '무음 상태가 유지된다');
    await frames(page, 4);
    await page.screenshot({ path: outPath('rm8', `journey_${name}_end.png`) });
    if (name === 'reduced') {
      check(post.reduced === 'true', '동작 줄이기가 켜져 있다 (' + post.reduced + ')');
      check(sailingState.animations.length === 0, '동작 줄이기: 항해 중 움직이는 CSS 애니메이션 0 (' + JSON.stringify(sailingState.animations) + ')');
    }
    if (name.startsWith('scale13')) {
      check(post.scale === '1.3', '글자 배율 1.3 (' + post.scale + ')');
      check(sailingState.center.length === 0, '배율 1.3 중앙 안전영역 위반 0 (' + JSON.stringify(sailingState.center) + ')');
      check(!sailingState.overflow, '배율 1.3 가로 넘침 없음');
      check(sailingState.copy === 0, '배율 1.3 금지 문구 0');
    }
    if (name === 'gray') {
      check(post.filter.includes('grayscale'), '그레이스케일 필터가 끝까지 유지된다');
      check(sailingState.contrast === 0, '대비 위반 0(색과 무관한 휘도 기준)');
    }
    check(sailingState.touch === 0 || cond.touch === false, '터치 목표 44px 미만 0 (' + sailingState.touch + ')');
    const realErrors = errors.slice();
    check(realErrors.length === 0, '오류 없음: ' + realErrors.slice(0, 3).join(' | '));
    info.errors = realErrors;
  } catch (e) {
    problems.push('예외: ' + String((e && e.stack) || e).slice(0, 400));
  }
  await browser.close();
  info.problems = problems;
  return info;
}

(async () => {
  const results = [];
  for (const name of ONLY) {
    if (!CONDITIONS[name]) { console.log('알 수 없는 조건', name); continue; }
    const t0 = Date.now();
    const r = await runCondition(name);
    results.push(r);
    console.log(`[${name}] ${r.problems.length ? '문제 ' + r.problems.length : '통과'} (${Math.round((Date.now() - t0) / 1000)}초)`, r.post ? `시련 ${JSON.stringify(r.post.trials)} 등대 ${JSON.stringify(r.post.lights)} 용어 ${r.post.terms}` : '');
    r.problems.slice(0, 8).forEach((m) => console.log('   -', m));
  }
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const bad = results.filter((r) => r.problems.length);
  console.log(bad.length ? 'JOURNEYS FAIL ' + bad.map((r) => r.name).join(',') : 'JOURNEYS PASS');
  process.exit(bad.length ? 1 : 0);
})();

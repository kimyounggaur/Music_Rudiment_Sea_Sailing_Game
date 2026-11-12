'use strict';
/*
 * RM8 자동 화면 효과 조정 실측 (설계서 5.11·9장 RM8).
 *   ① 일반 QA 주소(?qa=1)에서는 자동 조정이 꺼져 있다(측정을 흔들지 않는다).
 *   ② ?qa=1&autofx=1 에서는 켜진다: 가짜 느린 프레임(fxQa.feed)으로 결정적으로 → lite → off 한 단계씩 낮추고, 알림은 한 번, 저장된 설정(fx)은 그대로 "auto".
 *   ③ 설정 화면 문구("화면 효과를 가볍게 낮춰 두었어요"), 직접 고른 값(full)은 덮어쓰지 않음, 품질을 바꾸면 기록을 지움.
 *   ④ 진짜 프레임: 헤드리스 SwiftShader가 목표보다 느리므로, 작은 화면에서 실제로 신호가 나는지 관찰한다(참고용. 프레임이 250ms를 넘으면 '멈춤'으로 보고 재지 않는다).
 *   프레임 속도 자체의 실제 기기 측정은 NOT_RUN이다.
 *
 * 사용: BASE_URL=http://127.0.0.1:8767 node rm8-autofx.cjs [--out output/playwright/rm8-autofx.json] [--real 45]
 */
const fs = require('fs');
const path = require('path');
const { open, frames } = require('./lib.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; };
const OUT = arg('out', path.join('output', 'playwright', 'rm8-autofx.json'));
const REAL_SECONDS = Number(arg('real', 45));

const AUTO = () => { const s = window.__OCEAN_API__.fxQa.snapshot(); return { enabled: s.auto.enabled, cap: s.auto.cap, steps: s.auto.steps, signals: s.auto.signals, meanMs: s.auto.meanMs, notified: s.auto.notified, plan: s.plan ? s.plan.fx + '/' + s.plan.reflect + '/' + s.plan.post : null, failed: s.failed }; };
const PREP = () => {
  const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
  a.questQa.prepare(1); g.audio.setMuted(true);
  const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
  window.__TOASTS__ = [];
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { if (n.textContent) window.__TOASTS__.push(n.textContent.trim()); }))).observe(document.getElementById('game-toast'), { childList: true });
};

(async () => {
  const problems = [], rows = {};
  let checks = 0; const check = (cond, message) => { checks++; if (!cond) problems.push(message); return cond; };
  let session = null;
  try {
    // ① 일반 QA 주소
    session = await open({ query: '?qa=1', width: 480, height: 300 });
    let { browser, page, errors } = session;
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.click('#start-sailing');
    await page.waitForTimeout(1200);
    await page.evaluate(PREP);
    await frames(page, 4);
    rows.qaDefault = await page.evaluate(AUTO);
    check(rows.qaDefault.enabled === false, '?qa=1 에서는 자동 조정이 꺼져 있어야 한다');
    await browser.close();

    // ② ?autofx=1
    session = await open({ query: '?qa=1&autofx=1', width: 480, height: 300 });
    ({ browser, page, errors } = session);
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.click('#start-sailing');
    await page.waitForTimeout(1200);
    await page.evaluate(PREP);
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyQualityProfile('high', false); g.applyFx('auto', false); });
    await frames(page, 4);
    // 결정적 시험을 위해 진짜 프레임은 재지 않고 가짜 프레임(fxQa.feed)만 잰다(manual)
    await page.evaluate(() => window.__OCEAN_API__.fxQa.setAutoEnabled(true, true));
    rows.start = await page.evaluate(AUTO);
    check(rows.start.enabled === true && rows.start.cap === null, '시작: 켜짐·낮춘 기록 없음');
    check(rows.start.plan && rows.start.plan.startsWith('auto/planar/full'), '시작 계획은 auto/planar/full (' + rows.start.plan + ')');

    // 목표 안(60fps): 신호 없음
    const fine = await page.evaluate(() => window.__OCEAN_API__.fxQa.feed(16.7, 40));
    check(fine.signals === 0 && fine.cap === null, '60fps 가짜 프레임 40초: 신호 없음 (' + JSON.stringify(fine) + ')');
    // 느림(25ms = 40fps = 1.3배 초과): 6초 뒤 첫 신호 → lite
    const slow1 = await page.evaluate(() => window.__OCEAN_API__.fxQa.feed(25, 7));
    await frames(page, 4);
    rows.afterStep1 = await page.evaluate(AUTO);
    check(slow1.signals === 1 && rows.afterStep1.cap === 'lite', '첫 단계: lite (' + JSON.stringify(slow1) + ')');
    check(rows.afterStep1.plan && rows.afterStep1.plan.startsWith('lite/sky/composite'), '계획이 lite로 바뀐다 (' + rows.afterStep1.plan + ')');
    check(rows.afterStep1.notified === true, '알림 표시');
    const toasts1 = await page.evaluate(() => window.__TOASTS__.slice());
    check(toasts1.filter((t) => t.includes('화면 효과를 가볍게 바꿨어요')).length === 1, '알림은 정확히 한 번 (' + JSON.stringify(toasts1) + ')');
    // 둘째 단계: off
    const slow2 = await page.evaluate(() => window.__OCEAN_API__.fxQa.feed(25, 12));
    await frames(page, 4);
    rows.afterStep2 = await page.evaluate(AUTO);
    check(rows.afterStep2.cap === 'off' && rows.afterStep2.steps === 2, '둘째 단계: off (' + JSON.stringify(slow2) + ')');
    check(rows.afterStep2.plan && rows.afterStep2.plan.startsWith('off/sky/none'), '계획이 off로 (' + rows.afterStep2.plan + ')');
    const toasts2 = await page.evaluate(() => window.__TOASTS__.slice());
    check(toasts2.filter((t) => t.includes('화면 효과를 가볍게 바꿨어요')).length === 1, '둘째 단계에서도 알림은 한 번뿐 (' + JSON.stringify(toasts2) + ')');
    // 더 내릴 곳이 없으면 멈춘다
    const slow3 = await page.evaluate(() => window.__OCEAN_API__.fxQa.feed(25, 25));
    const after3 = await page.evaluate(AUTO);
    check(after3.steps === 2 && after3.cap === 'off', '더 내릴 곳이 없으면 멈춘다 (' + JSON.stringify(slow3) + ')');
    // 렌더가 계속 도는지(오류 없이)
    const f0 = await page.evaluate(() => window.__OCEAN_API__.fxQa.snapshot().frames);
    await frames(page, 6);
    const f1 = await page.evaluate(() => window.__OCEAN_API__.fxQa.snapshot().frames);
    check(f1 > f0, '낮춘 뒤에도 프레임이 돈다');

    // ③ 설정 화면 문구와 저장값
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.openPause(); g.showMenuTab('settings'); });
    await frames(page, 3);
    const live = await page.evaluate(() => ({ text: document.getElementById('visual-live').textContent, auto: document.querySelector('[data-fx="auto"]').getAttribute('aria-pressed'), full: document.querySelector('[data-fx="full"]').getAttribute('aria-pressed') }));
    rows.settings = live;
    check(live.text.includes('가볍게 낮춰 두었어요'), '설정 화면에 낮춰 둔 사실이 보인다 (' + live.text + ')');
    check(live.auto === 'true' && live.full === 'false', '저장된 선택은 그대로 auto (낮춘 것은 저장하지 않는다)');
    // ③-b 직접 full을 고르면 덮어쓰지 않는다
    await page.click('[data-fx="full"]');
    await frames(page, 4);
    const pickedFull = await page.evaluate(AUTO);
    check(pickedFull.cap === null && pickedFull.plan && pickedFull.plan.startsWith('full/planar/full'), 'full을 직접 고르면 낮춘 기록을 지우고 full로 돌아간다 (' + JSON.stringify(pickedFull) + ')');
    const forced = await page.evaluate(() => window.__OCEAN_API__.fxQa.feed(25, 40));
    const stillFull = await page.evaluate(AUTO);
    check(forced.signals === 0 && stillFull.cap === null && stillFull.plan.startsWith('full/'), '직접 고른 full은 아무리 느려도 덮어쓰지 않는다 (' + JSON.stringify(forced) + ')');
    const liveFull = await page.evaluate(() => document.getElementById('visual-live').textContent);
    check(!liveFull.includes('가볍게 낮춰 두었어요'), 'full에서는 낮춰 두었다는 문구가 없다');
    // ③-c auto로 되돌리면 다시 잰다
    await page.click('[data-fx="auto"]');
    await frames(page, 4);
    const backAuto = await page.evaluate(AUTO);
    check(backAuto.cap === null && backAuto.plan.startsWith('auto/'), 'auto로 되돌리면 처음부터 다시 잰다 (' + backAuto.plan + ')');
    const again = await page.evaluate(() => window.__OCEAN_API__.fxQa.feed(25, 8));
    check(again.signals === 1 && again.cap === 'lite', 'auto에서 다시 느리면 다시 낮춘다 (' + JSON.stringify(again) + ')');
    const toasts3 = await page.evaluate(() => window.__TOASTS__.slice());
    check(toasts3.filter((t) => t.includes('화면 효과를 가볍게 바꿨어요')).length === 1, '접속 중 알림은 계속 한 번뿐 (' + JSON.stringify(toasts3) + ')');
    // ③-d 품질을 바꾸면 기록을 지운다(진짜 프레임이 지운다: manual을 끈다)
    await page.evaluate(() => window.__OCEAN_API__.fxQa.setAutoEnabled(true, false));
    await page.evaluate(() => { window.__OCEAN_GAME__.applyQualityProfile('mid', false); });
    await frames(page, 4);
    const qSwitch = await page.evaluate(AUTO);
    check(qSwitch.cap === null && qSwitch.plan.startsWith('auto/planar/full'), '품질을 바꾸면 낮춘 기록을 지운다 (' + JSON.stringify(qSwitch) + ')');
    await page.evaluate(() => window.__OCEAN_GAME__.closePause());

    // ④ 진짜 프레임 관찰(참고): 작은 화면에서 신호가 나는지
    await page.setViewportSize({ width: 320, height: 200 });
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyQualityProfile('high', false); g.applyFx('auto', false); window.__OCEAN_API__.fxQa.resetAuto(); });
    const t0 = Date.now();
    let real = null;
    while (Date.now() - t0 < REAL_SECONDS * 1000) {
      await page.waitForTimeout(3000);
      real = await page.evaluate(AUTO);
      if (real.cap) break;
    }
    rows.real = { ...real, waitedSec: Math.round((Date.now() - t0) / 1000) };
    // 진짜 프레임은 환경에 달려 있어(헤드리스) 합격 기준이 아니다. 신호가 났으면 그 사실을, 안 났으면 평균 프레임 시간을 기록한다.
    console.log('진짜 프레임(참고):', JSON.stringify(rows.real));

    const realErrors = errors.slice();
    check(realErrors.length === 0, '오류 없음: ' + realErrors.slice(0, 3).join(' | '));
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ checks, problems, errors: realErrors, rows }, null, 1));
    console.log('문제', problems.length);
    problems.slice(0, 14).forEach((p) => console.log('  -', p));
    console.log(problems.length === 0 ? 'AUTOFX PASS' : 'AUTOFX FAIL');
    await browser.close();
    process.exit(problems.length === 0 ? 0 : 1);
  } catch (e) {
    console.log('AUTOFX ERROR', String((e && e.stack) || e).slice(0, 800));
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e), problems, rows }, null, 1));
    if (session && session.browser) await session.browser.close();
    process.exit(2);
  }
})();

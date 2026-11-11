'use strict';
/*
 * RM8 설정 새 항목 3개(화면 효과·조용한 화면·감상 카메라) 저장 왕복 실측 (설계서 O-45의 화면 쪽 짝, 9장 RM8).
 *   진짜 저장소(localStorage)를 쓰려고 ?qa=1 없이 일반 주소로 연다(QA 주소는 저장을 메모리로 돌린다).
 *   설정 화면의 단추를 눌러 → 저장된 값(localStorage) 확인 → 새로고침 → 다시 열어 단추 상태·HUD 동작이 그대로인지 본다.
 *
 * 사용: BASE_URL=http://127.0.0.1:8767 node rm8-settings.cjs [--out output/playwright/rm8-settings.json]
 */
const fs = require('fs');
const path = require('path');
const { open } = require('./lib.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; };
const OUT = arg('out', path.join('output', 'playwright', 'rm8-settings.json'));
const KEY = 'lesson_designer_ocean_v1';

const READ_SAVE = (key) => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw).settings : null; } catch (e) { return { error: String(e) }; } };
const READ_UI = () => ({
  fx: [...document.querySelectorAll('[data-fx]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.fx),
  quiet: document.getElementById('hud-quiet-toggle').getAttribute('aria-pressed'),
  quietText: document.getElementById('hud-quiet-toggle').textContent.trim(),
  scenic: document.getElementById('scenic-cam-toggle').getAttribute('aria-pressed'),
  scenicText: document.getElementById('scenic-cam-toggle').textContent.trim(),
  live: document.getElementById('visual-live').textContent.trim(),
});

async function startAndOpenSettings(page) {
  await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
  await page.click('#start-sailing');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(300);
}

(async () => {
  // 일반 주소(?qa 없음). 합격 판정에 쓰는 것은 화면과 저장소뿐이다.
  const { browser, page, errors } = await open({ query: '', width: 900, height: 700 });
  const problems = [], rows = [];
  const check = (cond, message) => { if (!cond) problems.push(message); return cond; };
  try {
    await startAndOpenSettings(page);
    const fresh = await page.evaluate(READ_UI);
    rows.push({ step: 'fresh', ui: fresh });
    check(fresh.fx.join() === 'auto' && fresh.quiet === 'true' && fresh.scenic === 'true', '처음 값: auto · 조용한 화면 켬 · 감상 카메라 켬 (' + JSON.stringify(fresh) + ')');

    // 효과 단추 넷을 차례로: 누르고 → 저장 확인 → 새로고침 → 그대로인지
    for (const fx of ['lite', 'off', 'full', 'auto']) {
      await page.click(`[data-fx="${fx}"]`);
      await page.waitForTimeout(250);
      const ui1 = await page.evaluate(READ_UI);
      await page.waitForTimeout(400);
      const saved = await page.evaluate(READ_SAVE, KEY);
      check(ui1.fx.join() === fx, `${fx}: 누른 직후 단추 상태 (${ui1.fx.join()})`);
      check(saved && saved.fx === fx, `${fx}: 저장된 값 (${JSON.stringify(saved && saved.fx)})`);
      await page.reload({ waitUntil: 'load' });
      await startAndOpenSettings(page);
      const ui2 = await page.evaluate(READ_UI);
      check(ui2.fx.join() === fx, `${fx}: 새로고침 뒤 단추 상태 (${ui2.fx.join()})`);
      rows.push({ step: 'fx ' + fx, saved: saved && saved.fx, after: ui2.fx });
    }

    // 조용한 화면: 끄기 → 저장 → 새로고침 → 항해 중 안내가 늘 떠 있는가(8초 기다려도 awake). 다시 켜면 잠잠으로 가라앉는가.
    await page.click('#hud-quiet-toggle');
    await page.waitForTimeout(500);
    let saved = await page.evaluate(READ_SAVE, KEY);
    check(saved && saved.hudQuiet === false, '조용한 화면 끄기가 저장된다 (' + JSON.stringify(saved && saved.hudQuiet) + ')');
    await page.reload({ waitUntil: 'load' });
    await startAndOpenSettings(page);
    let ui = await page.evaluate(READ_UI);
    check(ui.quiet === 'false' && /항상/.test(ui.quietText), '새로고침 뒤 조용한 화면 꺼짐 표시 (' + ui.quiet + ' / ' + ui.quietText + ')');
    await page.keyboard.press('Escape'); // 메뉴 닫기
    await page.waitForTimeout(9000);
    const hudOff = await page.evaluate(() => document.documentElement.dataset.hud);
    rows.push({ step: 'quiet off → hud after 9s', hud: hudOff });
    check(hudOff === 'awake', '조용한 화면을 끄면 9초 뒤에도 안내가 떠 있다 (data-hud=' + hudOff + ')');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.click('[data-tab="settings"]');
    await page.click('#hud-quiet-toggle');
    await page.waitForTimeout(400);
    saved = await page.evaluate(READ_SAVE, KEY);
    check(saved && saved.hudQuiet === true, '조용한 화면 다시 켜기가 저장된다');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(9000);
    const hudOn = await page.evaluate(() => document.documentElement.dataset.hud);
    rows.push({ step: 'quiet on → hud after 9s', hud: hudOn });
    check(hudOn === 'quiet', '조용한 화면을 켜면 9초 뒤 안내가 가라앉는다 (data-hud=' + hudOn + ')');

    // 감상 카메라: 끄기 → 저장 → 새로고침 → 꺼짐 표시
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.click('[data-tab="settings"]');
    await page.click('#scenic-cam-toggle');
    await page.waitForTimeout(500);
    saved = await page.evaluate(READ_SAVE, KEY);
    check(saved && saved.scenicCam === false, '감상 카메라 끄기가 저장된다 (' + JSON.stringify(saved && saved.scenicCam) + ')');
    await page.reload({ waitUntil: 'load' });
    await startAndOpenSettings(page);
    ui = await page.evaluate(READ_UI);
    check(ui.scenic === 'false' && /가만히/.test(ui.scenicText), '새로고침 뒤 감상 카메라 꺼짐 표시 (' + ui.scenic + ' / ' + ui.scenicText + ')');
    rows.push({ step: 'scenic off after reload', ui });

    // 세 값을 한꺼번에 바꾼 상태에서 저장 데이터 전체가 멀쩡한가(다른 설정이 그대로인가)
    await page.click('[data-fx="lite"]');
    await page.waitForTimeout(500);
    const all = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    check(all.version === 1 && all.settings.fx === 'lite' && all.settings.hudQuiet === true && all.settings.scenicCam === false, '세 값이 함께 저장된다 (' + JSON.stringify({ fx: all.settings.fx, hudQuiet: all.settings.hudQuiet, scenicCam: all.settings.scenicCam }) + ')');
    check(typeof all.settings.volBgm === 'number' && typeof all.settings.textScale === 'number' && typeof all.settings.quality === 'string', '다른 설정 필드가 그대로 있다');
    rows.push({ step: 'final settings', settings: all.settings });

    const realErrors = errors.slice();
    check(realErrors.length === 0, '오류 없음: ' + realErrors.slice(0, 3).join(' | '));
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ problems, errors: realErrors, rows }, null, 1));
    console.log('문제', problems.length, '오류', realErrors.length);
    problems.slice(0, 12).forEach((m) => console.log('  -', m));
    console.log(problems.length === 0 ? 'SETTINGS PASS' : 'SETTINGS FAIL');
    await browser.close();
    process.exit(problems.length === 0 ? 0 : 1);
  } catch (e) {
    console.log('SETTINGS ERROR', String((e && e.stack) || e).slice(0, 800));
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e), problems, rows, errors }, null, 1));
    await browser.close();
    process.exit(2);
  }
})();

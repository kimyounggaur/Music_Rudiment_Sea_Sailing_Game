'use strict';
/*
 * RM8 WebGL 컨텍스트 손실·복구 실측 (설계서 5.13절·9장 RM8).
 *   WEBGL_lose_context 확장으로 실제 손실을 일으키고 → 손실 중 상태 → 복구 → 복구 뒤 상태를 품질 3단계 × 효과 단계마다 잰다.
 *   확인하는 것: 손실 중 낡은 렌더 타깃 핸들을 버렸는가(타깃 0개), 안내 화면이 뜨는가, 프레임 루프가 멈췄는가,
 *   복구 뒤 계획대로 타깃을 새로 만들었는가(개수가 손실 전과 같은가), 프레임이 다시 도는가, 오류가 없는가, 여러 번 되풀이해도 자원이 늘지 않는가.
 *   헤드리스 SwiftShader에서 돈다. 실제 기기의 손실(GPU 재설정 등)은 NOT_RUN으로 남긴다.
 *
 *   손실·복구는 phase8Qa.loseContext/restoreContext(RM3 이전부터 있던 QA 함수)로 일으킨다. 이 함수들은 확장(WEBGL_lose_context)을 접속 때 한 번 받아 두고 쓴다.
 *   손실된 컨텍스트에서는 getExtension()이 null을 돌려주므로(현재 Chromium), 매번 getExtension을 부르는 fxQa.restoreContext는 복구를 일으키지 못한다
 *   (RM8 빌드에 있던 fxQa.loseContext·restoreContext는 이 때문에 동작하지 않았고 RM9 빌드에서 지웠다. 이 시험은 처음부터 phase8Qa 쪽만 쓴다.)
 *
 * 사용: BASE_URL=http://127.0.0.1:8767 node rm8-context.cjs [--out output/playwright/rm8-context.json] [--cycles 2]
 */
const fs = require('fs');
const path = require('path');
const { open, frames } = require('./lib.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; };
const OUT = arg('out', path.join('output', 'playwright', 'rm8-context.json'));
const CYCLES = Number(arg('cycles', 2));
const COMBOS = [['high', 'full'], ['high', 'lite'], ['mid', 'full'], ['mid', 'off'], ['low', 'full'], ['low', 'off']];
// 컨텍스트 손실이 부르는 정상 로그(three·브라우저)는 오류로 세지 않는다
// three r128은 복구 때 새 모듈을 만들고, 복구 이전에 만든 객체(그림자 맵 등)에 붙은 옛 dispose 처리기는 그대로 남는다. 복구 뒤 설정을 바꿔 그 객체를 지우면
// 옛 처리기가 옛 컨텍스트의 핸들을 지우려다 Chromium이 "delete*: object does not belong to this context" 경고(deleteTexture·deleteFramebuffer·deleteVertexArray 등)를 낸다(새 처리기는 새 핸들을 정상으로 지운다). 무해한 경고다.
const EXPECTED = /context lost|context restored|CONTEXT_LOST|WebGL: context|lose_context|loseContext|restoreContext|INVALID_OPERATION: delete\w*: object does not belong to this context/i;

const SNAP = () => {
  const g = window.__OCEAN_GAME__, s = g.pipeline.snapshot(), info = g.renderer.info;
  return {
    plan: s.plan ? s.plan.quality + '/' + s.plan.fx + '/' + s.plan.reflect + '/' + s.plan.post : null,
    targets: s.targetCount, lost: s.lost, failed: s.failed, restored: s.counters.restored || 0, lostCount: s.counters.lost || 0,
    created: s.counters.created, disposed: s.counters.disposed, frames: s.frames,
    mode: g.stabilitySnapshot().mode, contextLost: g.contextLost, raf: Boolean(g.raf),
    overlay: document.getElementById('system-overlay').classList.contains('active'),
    geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : null,
    glLost: g.renderer.getContext().isContextLost(),
  };
};

(async () => {
  const { browser, page, errors } = await open({ query: '?qa=1', width: 640, height: 400 });
  const rows = [], problems = [];
  let checks = 0; const check = (cond, message) => { checks++; if (!cond) problems.push(message); return cond; };
  try {
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.click('#start-sailing');
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__; a.questQa.prepare(1); g.audio.setMuted(true); const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; });
    await frames(page, 6);
    for (const [quality, fx] of COMBOS) {
      await page.evaluate(({ quality, fx }) => { const g = window.__OCEAN_GAME__; g.applyQualityProfile(quality, false); g.applyFx(fx, false); }, { quality, fx });
      await frames(page, 8);
      const base = await page.evaluate(SNAP);
      check(!base.lost && !base.failed, `${quality}/${fx}: 시작 상태가 정상이어야 한다`);
      let last = base;
      for (let c = 1; c <= CYCLES; c++) {
        const tag = `${quality}/${fx}#${c}`;
        const lostOk = await page.evaluate(() => window.__OCEAN_API__.phase8Qa.loseContext());
        await page.waitForTimeout(700);
        const during = await page.evaluate(SNAP);
        const f0 = during.frames;
        await page.waitForTimeout(1200);
        const during2 = await page.evaluate(SNAP);
        check(lostOk === true, `${tag}: WEBGL_lose_context 확장을 쓸 수 있어야 한다`);
        check(during.lost === true && during.contextLost === true && during.glLost === true, `${tag}: 손실 중 lost 표시`);
        check(during.targets === 0, `${tag}: 손실 중 렌더 타깃 0개 (${during.targets})`);
        check(during.overlay === true, `${tag}: 손실 중 안내 화면`);
        check(during.raf === false, `${tag}: 손실 중 프레임 루프 정지`);
        check(during2.frames === f0, `${tag}: 손실 중 프레임이 늘지 않는다 (${f0} → ${during2.frames})`);
        await page.evaluate(() => window.__OCEAN_API__.phase8Qa.restoreContext());
        await page.waitForTimeout(1500);
        await frames(page, 8);
        const after = await page.evaluate(SNAP);
        check(after.lost === false && after.contextLost === false && after.glLost === false, `${tag}: 복구 표시`);
        check(after.restored === base.restored + c, `${tag}: 복구 횟수 ${base.restored + c} (${after.restored}; 파이프라인 계수는 조합이 바뀌어도 누적된다)`);
        check(after.targets === base.targets, `${tag}: 복구 뒤 타깃 수 ${base.targets} (${after.targets})`);
        check(after.plan === base.plan, `${tag}: 복구 뒤 계획이 같다 (${base.plan} → ${after.plan})`);
        check(after.overlay === false && after.raf === true, `${tag}: 안내 화면이 닫히고 루프가 돈다`);
        check(after.frames > during2.frames, `${tag}: 프레임이 다시 돈다 (${during2.frames} → ${after.frames})`);
        check(after.mode === 'SAILING', `${tag}: 항해 상태 유지 (${after.mode})`);
        check(!after.failed, `${tag}: 파이프라인이 꺼지지 않았다`);
        rows.push({ tag, lostOk, base, during, during2, after });
        last = after;
      }
      // 되풀이해도 자원이 늘지 않아야 한다: 두 번째 복구 뒤와 첫 번째 복구 뒤를 비교한다(품질·효과 조합 안에서)
      const mine = rows.filter((r) => r.tag.startsWith(`${quality}/${fx}#`));
      if (mine.length >= 2) {
        const a = mine[0].after, b = mine[mine.length - 1].after;
        check(b.programs <= a.programs + 1, `${quality}/${fx}: 셰이더 프로그램이 늘지 않는다 (${a.programs} → ${b.programs})`);
        check(b.targets === a.targets, `${quality}/${fx}: 타깃 수가 늘지 않는다 (${a.targets} → ${b.targets})`);
      }
      void last;
    }
    // 손실 중 설정 화면을 열고 품질을 바꿔도 터지지 않는다(복구 뒤 새 설정대로 만든다)
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyQualityProfile('mid', false); g.applyFx('full', false); });
    await frames(page, 6);
    await page.evaluate(() => window.__OCEAN_API__.phase8Qa.loseContext());
    await page.waitForTimeout(600);
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyQualityProfile('low', false); });
    const whileLost = await page.evaluate(SNAP);
    check(whileLost.targets === 0, '손실 중 품질을 바꿔도 타깃을 만들지 않는다 (' + whileLost.targets + ')');
    await page.evaluate(() => window.__OCEAN_API__.phase8Qa.restoreContext());
    await page.waitForTimeout(1500);
    await frames(page, 6);
    const afterSwitch = await page.evaluate(SNAP);
    check(afterSwitch.plan && afterSwitch.plan.startsWith('low/'), '복구 뒤 바뀐 설정(low)대로 만든다 (' + afterSwitch.plan + ')');
    check(afterSwitch.targets === 0, 'low는 추가 타깃이 없다 (' + afterSwitch.targets + ')');
    rows.push({ tag: 'switch-while-lost', whileLost, afterSwitch });

    const realErrors = errors.filter((e) => !EXPECTED.test(e));
    const result = { checks, cycles: CYCLES, combos: COMBOS.length, problems, errors: realErrors, ignoredLogs: errors.length - realErrors.length, rows };
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
    rows.forEach((r) => { if (r.after) console.log(r.tag.padEnd(14), 'plan', r.after.plan, 'targets', r.base.targets, '→ 손실', r.during.targets, '→ 복구', r.after.targets, 'programs', r.after.programs, 'frames', r.after.frames); });
    console.log('문제', problems.length, '오류', realErrors.length, '(무시한 정상 로그', result.ignoredLogs + ')');
    problems.slice(0, 12).forEach((p) => console.log('  -', p));
    realErrors.slice(0, 4).forEach((e) => console.log('  !', e.slice(0, 200)));
    const ok = problems.length === 0 && realErrors.length === 0;
    console.log(ok ? 'CONTEXT PASS' : 'CONTEXT FAIL');
    await browser.close();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('CONTEXT ERROR', String((e && e.stack) || e).slice(0, 800));
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e), problems, rows, errors }, null, 1));
    await browser.close();
    process.exit(2);
  }
})();

'use strict';
/*
 * 접속 시점 시작 가능 여부 전수 측정 (RM8).
 *   게임은 접속할 때마다 자체 검사(bootPhaseZero → runAllTests)를 돌리고, 통과해야 "항해 시작" 단추를 켠다.
 *   배치(창 크기·글자 배율)에 따라 결과가 달라지는 검사가 이 관문에 걸리면 작은 화면에서 게임이 시작되지 않는다.
 *   RM7 빌드는 O-40(중앙 안전영역) 하나 때문에 화면 29곳 가운데 13곳(가로 폰·작은 창)에서 단추가 꺼진 채로 남았다.
 *   RM7 UI 행렬은 기본 크기(1440×900)로 접속한 뒤 창 크기를 바꿔서 이 경로를 한 번도 거치지 않았다.
 *   이 스크립트는 화면마다 "새로 접속"해서 확인한다(창 크기를 바꾸지 않는다).
 *
 * 사용(예):
 *   BASE_URL=http://127.0.0.1:8767 node boot-sweep.cjs                          기본: 화면 29종, 터치 없음
 *   node boot-sweep.cjs 844x390,1024x600 0,1 결과.json                          화면 · 터치(0/1, 둘 다 가능) · 결과 파일(선택)
 *   TEXT_SCALE=1.3 node boot-sweep.cjs                                          저장된 글자 배율 1.3으로 접속(① 실제 주소에서만 적용된다. ② ?qa=1은 메모리 저장소라 배율 1로 열린다)
 * 한 화면마다 두 번 접속한다: ① 실제 주소(검사 인자 없음) — "항해 시작"이 켜지는가 ② ?qa=1 — 실패한 검사의 이름
 * 통과 조건: ①·② 모두 단추가 켜지고, 실패한 검사는 모두 화면 배치 검사(O-38~O-41)이며, 콘솔 오류가 없다.
 * 배치 검사 실패는 시작을 막지 않지만 결과 파일에 화면별로 남긴다(알려진 한계 목록이 된다).
 */
const fs = require('fs');
const { open } = require('./lib.cjs');

const DEFAULT = ['280x653', '320x480', '320x568', '360x360', '360x640', '360x800', '375x667', '390x844', '412x915', '480x320', '568x320', '600x400', '640x360', '640x400',
  '700x500', '740x360', '768x1024', '800x600', '844x390', '900x500', '1024x600', '1024x768', '1180x820', '1280x720', '1280x800', '1366x657', '1440x900', '1920x1080', '2560x1440'].join(',');
const SIZES = (process.argv[2] || DEFAULT).split(',').map((s) => s.split('x').map(Number));
const TOUCHES = (process.argv[3] || '0').split(',').map((s) => s === '1');
const OUT = process.argv[4] || '';
const TEXT_SCALE = process.env.TEXT_SCALE ? Number(process.env.TEXT_SCALE) : 0;
const LAYOUT_IDS = ['O-38', 'O-39', 'O-40', 'O-41'];
const isLayout = (name) => LAYOUT_IDS.some((id) => String(name).startsWith(id + ' '));

async function startEnabled(page, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const state = await page.evaluate(() => { const b = document.getElementById('start-sailing'); return b ? !b.disabled : null; }).catch(() => null);
    if (state) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

(async () => {
  const rows = [];
  for (const touch of TOUCHES) {
    for (const [W, H] of SIZES) {
      const row = { W, H, touch, textScale: TEXT_SCALE || 1 };
      // ① 실제 주소. 글자 배율을 지정했으면 접속 전에 설정 저장값(localStorage)에 넣어 둔다(?qa=1은 메모리 저장소라 이 값을 읽지 않는다).
      const seed = TEXT_SCALE ? async (page) => page.addInitScript(([key, scale]) => { try { localStorage.setItem(key, JSON.stringify({ version: 1, settings: { textScale: scale } })); } catch (e) { /* 저장소가 막혀도 시험은 이어 간다 */ } }, ['lesson_designer_ocean_v1', TEXT_SCALE]) : null;
      const first = await open({ query: '', width: W, height: H, touch, before: seed });
      row.productionStarts = await startEnabled(first.page, 40000);
      row.productionStatus = await first.page.evaluate(() => { const s = document.getElementById('phase-status'); return s ? s.textContent : null; }).catch(() => null);
      row.productionErrors = first.errors.slice(0, 5);
      // ② ?qa=1 : 검사 결과
      await first.page.goto((process.env.BASE_URL || 'http://127.0.0.1:8765') + '/?qa=1', { waitUntil: 'load' });
      row.qaStarts = await startEnabled(first.page, 40000);
      const results = await first.page.evaluate(() => (window.__OCEAN_TEST_RESULTS__ ? window.__OCEAN_TEST_RESULTS__.suites.flatMap((s) => s.tests.filter((t) => !t.ok).map((t) => ({ name: t.name, error: String(t.error).slice(0, 160) }))) : null)).catch(() => null);
      row.failed = results || [];
      row.layoutFailed = row.failed.filter((f) => isLayout(f.name)).map((f) => f.name.split(' ')[0] + ' ' + f.error);
      row.otherFailed = row.failed.filter((f) => !isLayout(f.name)).map((f) => f.name + ' ' + f.error);
      row.errors = first.errors.slice(0, 5);
      row.ok = row.productionStarts && row.qaStarts && results !== null && row.otherFailed.length === 0 && row.errors.length === 0 && row.productionErrors.length === 0;
      rows.push(row);
      console.log(`${touch ? '터치  ' : '비터치'} ${String(W + 'x' + H).padEnd(10)} 실제 주소 ${row.productionStarts ? '시작됨' : '✗ 시작 안 됨'} · ?qa=1 ${row.qaStarts ? '시작됨' : '✗ 시작 안 됨'} · 배치 검사 실패 ${row.layoutFailed.length}${row.layoutFailed.length ? ' (' + row.layoutFailed.join(' | ').slice(0, 90) + ')' : ''}${row.otherFailed.length ? ' · ✗ 다른 검사 실패 ' + row.otherFailed.join(' | ') : ''}${row.errors.length || row.productionErrors.length ? ' · ✗ 콘솔 오류 ' + (row.errors.concat(row.productionErrors)).join(' | ') : ''}`);
      await first.browser.close();
    }
  }
  const bad = rows.filter((r) => !r.ok), layoutCells = rows.filter((r) => r.layoutFailed.length);
  console.log(bad.length ? `BOOT SWEEP FAIL: ${bad.length}/${rows.length}곳에서 시작 안 됨·다른 검사 실패·콘솔 오류` : `BOOT SWEEP PASS: ${rows.length}/${rows.length}곳 모두 시작됨 (배치 검사 실패 ${layoutCells.length}곳은 시작을 막지 않음: ${layoutCells.map((r) => r.W + 'x' + r.H).join(', ') || '없음'})`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ rows, pass: bad.length === 0, layoutFailCells: layoutCells.map((r) => r.W + 'x' + r.H) }, null, 1));
  process.exit(bad.length ? 1 : 0);
})();

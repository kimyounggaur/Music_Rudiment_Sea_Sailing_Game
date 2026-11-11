'use strict';
/*
 * 저장 상태별 시작 가능 여부 측정 (RM8).
 *   실제 주소에서는 접속 때의 자체 검사가 플레이어의 진짜 저장(localStorage)을 놓고 돈다(?qa=1은 메모리 저장소라 기본 저장으로만 돈다).
 *   저장 내용 때문에 검사가 하나라도 어긋나면 게임이 시작되지 않으므로, 여러 저장 상태로 새로 접속해 "항해 시작/이어하기"가 켜지는지 본다.
 *   boot-sweep.cjs가 화면 크기를 바꿔 가며 보는 것을 이 스크립트는 저장 내용을 바꿔 가며 본다.
 *
 * 사용(예):
 *   BASE_URL=http://127.0.0.1:8767 node boot-saves.cjs                      기본: 저장 상태 6종 × 화면 3종
 *   node boot-saves.cjs 1440x900,844x390 결과.json                          화면 · 결과 파일(선택)
 * 저장 상태: fresh(저장 없음) · late(모든 용어·등대·시련 완료) · settings-max(글자 1.3·품질 low·효과 lite·조용한 화면 끔·감상 카메라 끔) ·
 *          settings-off(품질 high·효과 off) · corrupt(깨진 글자) · future(지원하지 않는 버전)
 * 통과 조건: 모든 칸에서 단추가 켜지고, 콘솔 오류(pageerror 포함)가 없다.
 *   저장 형식은 ?qa=1에서 questQa.prepare()가 돌려주는 저장 모양(기본 저장)에서 가져온다. 게임이 모르는 값은 접속 때 정리된다.
 */
const fs = require('fs');
const { open } = require('./lib.cjs');

const SIZES = (process.argv[2] || '1440x900,844x390,375x667').split(',').map((s) => s.split('x').map(Number));
const OUT = process.argv[3] || '';
const SAVE_KEY = 'lesson_designer_ocean_v1';

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
  // 저장 모양을 얻는다: ?qa=1의 메모리 저장소에서 기본 저장을 받아 온다(진짜 저장소는 건드리지 않는다).
  const probe = await open({ query: '?qa=1', width: 1280, height: 720 });
  await startEnabled(probe.page, 40000);
  const shape = await probe.page.evaluate(() => {
    const a = window.__OCEAN_API__;
    return { base: JSON.parse(JSON.stringify(a.questQa.prepare(0).save)), termIds: a.TERMS.map((t) => t.id) };
  });
  await probe.browser.close();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  const late = clone(shape.base);
  late.progress.tutorialDone = true; late.progress.lighthousesLit = all; late.progress.trialsPassed = all;
  late.progress.termsFound = shape.termIds; late.progress.codexSeen = shape.termIds;
  const settingsMax = clone(shape.base); Object.assign(settingsMax.settings, { textScale: 1.3, quality: 'low', fx: 'lite', hudQuiet: false, scenicCam: false });
  const settingsOff = clone(shape.base); Object.assign(settingsOff.settings, { quality: 'high', fx: 'off', textScale: 1.15 });
  const SAVES = [
    ['fresh', null],
    ['late', JSON.stringify(late)],
    ['settings-max', JSON.stringify(settingsMax)],
    ['settings-off', JSON.stringify(settingsOff)],
    ['corrupt', '{이건 json이 아니다'],
    ['future', JSON.stringify({ version: 2, settings: {} })],
  ];
  const rows = [];
  for (const [name, raw] of SAVES) {
    for (const [W, H] of SIZES) {
      const seed = raw === null ? null : async (page) => page.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (e) { /* 저장소가 막혀도 시험은 이어 간다 */ } }, [SAVE_KEY, raw]);
      const { browser, page, errors } = await open({ query: '', width: W, height: H, before: seed });
      const starts = await startEnabled(page, 40000);
      const info = await page.evaluate(() => ({
        status: (document.getElementById('phase-status') || {}).textContent || null,
        startText: (document.getElementById('start-sailing') || {}).textContent || null,
        progress: (document.getElementById('title-progress') || {}).textContent || null,
        banner: (() => { const b = document.getElementById('storage-banner'); return b && !b.hidden ? b.textContent.trim().slice(0, 60) : null; })(),
      })).catch(() => ({}));
      const row = { save: name, W, H, starts, ...info, errors: errors.slice(0, 5), ok: starts && errors.length === 0 };
      rows.push(row);
      console.log(`${name.padEnd(13)} ${String(W + 'x' + H).padEnd(9)} ${starts ? '시작됨' : '✗ 시작 안 됨'} · 단추 "${info.startText}" · ${info.progress ? '진행 "' + info.progress + '"' : '진행 줄 없음'}${info.banner ? ' · 알림 "' + info.banner + '"' : ''}${errors.length ? ' · ✗ 오류 ' + errors.join(' | ').slice(0, 200) : ''}`);
      await browser.close();
    }
  }
  const bad = rows.filter((r) => !r.ok);
  console.log(bad.length ? `BOOT SAVES FAIL: ${bad.length}/${rows.length}칸` : `BOOT SAVES PASS: ${rows.length}/${rows.length}칸 모두 시작됨`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ rows, pass: bad.length === 0 }, null, 1));
  process.exit(bad.length ? 1 : 0);
})();

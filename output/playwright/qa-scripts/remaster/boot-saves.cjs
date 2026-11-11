'use strict';
/*
 * 저장 상태별 시작 가능 여부와 "저장이 실제로 읽혔는지" 측정 (RM8).
 *   실제 주소에서는 접속 때의 자체 검사가 플레이어의 진짜 저장(localStorage)을 놓고 돈다(?qa=1은 메모리 저장소라 기본 저장으로만 돈다).
 *   boot-sweep.cjs가 화면 크기를 바꿔 가며 보는 것을 이 스크립트는 저장 내용을 바꿔 가며 본다.
 *
 * 왜 "시작 단추가 켜졌나"만으로는 모자란가(RM8에서 겪은 일):
 *   RM0~RM7 빌드는 저장이 있으면 접속 때마다 그 저장을 지웠다(sanitizeSave가 아직 선언되지 않은 상수를 읽어 예외 → loadSave가 예외를
 *   "깨진 저장"으로 보고 키를 지우고 새 항해로 시작). 시작 단추는 그래도 켜지므로 이 스크립트의 첫 판("단추가 켜지고 콘솔 오류 없음")은
 *   저장이 전부 지워지는 동안에도 18/18을 냈다. 그래서 이제는 저장마다 "읽힌 결과"를 기대값과 맞춰 본다.
 *
 * 한 칸의 순서(저장 상태 × 화면 크기):
 *   ① 저장을 localStorage에 한 번만 심고(addInitScript + sessionStorage 표식: 재접속 때 다시 덮어쓰지 않는다) 새로 접속한다.
 *      같은 init 스크립트가 #storage-banner·#game-toast의 변화를 접속 내내 기록한다(복구 안내는 배너로 떴다가 게임이 만들어질 때 토스트로 바뀐다).
 *   ② 시작 단추가 켜지기를 기다린 뒤 읽는다 — 저장 키가 남아 있나·복구 안내가 떴나·단추 글자("항해 시작"/"이어하기")·진행 줄(도감 N/141 · 등대 M/7)·
 *      이어하기 때 새 항해 단추·설정이 화면에 반영됐나(글자 배율 data-text-scale, 품질 select, 효과 aria-pressed, 조용한 화면·감상 카메라 토글).
 *   ③ (왕복) 설정 단추를 게임의 단추 경로로 누르고 pagehide를 일으켜 게임이 직접 저장을 쓰게 한 뒤(suspendLifecycle → persist → sanitizeSave),
 *      그 저장을 읽고, 같은 저장소로 다시 접속해 ②와 같은 항목을 다시 읽는다. 게임이 쓴 저장을 게임이 다시 읽을 수 있는지가 실제 플레이어의 두 번째 접속이다.
 *
 * 사용(예):
 *   BASE_URL=http://127.0.0.1:8767 node boot-saves.cjs                      기본: 저장 상태 8종 × 화면 3종
 *   node boot-saves.cjs 1440x900,844x390 결과.json                          화면 · 결과 파일(선택)
 * 저장 상태:
 *   fresh(저장 없음; 설정 두 개를 눌러 왕복) · late(모든 용어·등대·시련 완료) · settings-max(글자 1.3·품질 low·효과 lite·조용한 화면 끔·감상 카메라 끔; 효과를 off로 눌러 왕복) ·
 *   settings-off(품질 high·효과 off·글자 1.15) · partial(version 1에 설정 두 개뿐) · unversioned(version 없는 옛 모양) ·
 *   corrupt(깨진 글자 → 복구 안내) · future(지원하지 않는 버전 → 복구 안내)
 * 통과 조건(칸마다): 시작 단추가 켜지고, 콘솔 오류(pageerror 포함)가 없고, 위 기대값이 첫 접속과 재접속 모두에서 맞는다.
 *   저장 형식은 ?qa=1에서 questQa.prepare()가 돌려주는 저장 모양(기본 저장)에서 가져온다. 게임이 모르는 값은 접속 때 정리된다.
 */
const fs = require('fs');
const { open } = require('./lib.cjs');

const SIZES = (process.argv[2] || '1440x900,844x390,375x667').split(',').map((s) => s.split('x').map(Number));
const OUT = process.argv[3] || '';
const SAVE_KEY = 'lesson_designer_ocean_v1';
const NOTICE = '이전 저장 기록을 안전한 새 항해로 복구했습니다.';
const RECOVERED_TOAST = '저장 기록을 읽지 못해'; // 게임이 만들어질 때 배너를 토스트로 바꾸며 띄우는 문구의 일부
const WRONG_TOAST = '이번 접속에서만'; // 저장소를 못 쓸 때의 말: 복구한 경우에는 사실과 다르다

async function startEnabled(page, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const state = await page.evaluate(() => { const b = document.getElementById('start-sailing'); return b ? !b.disabled : null; }).catch(() => null);
    if (state) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

// 화면에 반영된 것과 저장소에 남은 것, 접속 내내 기록한 배너·토스트 변화를 한 번에 읽는다
const observe = (page) => page.evaluate((KEY) => {
  const q = (id) => document.getElementById(id);
  const shown = (n) => !!n && !n.hidden && !n.closest('[hidden]');
  const text = (n) => (n ? n.textContent.trim() : null);
  const pressed = (id) => { const n = q(id); return n ? n.getAttribute('aria-pressed') : null; };
  let raw = null, parsed = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
  try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
  const fx = document.querySelector('[data-fx][aria-pressed="true"]');
  const banner = q('storage-banner');
  const notes = Array.isArray(window.__bootNotes) ? window.__bootNotes.slice() : [];
  return {
    startText: text(q('start-sailing')),
    newGameShown: shown(q('new-game-button')),
    progressShown: shown(q('title-progress')),
    progress: shown(q('title-progress')) ? text(q('title-progress')) : null,
    banner: shown(banner) ? text(banner) : null,
    bannerNotes: notes.filter((n) => n.id === 'storage-banner' && !n.hidden).map((n) => n.text.slice(0, 80)),
    toastNotes: notes.filter((n) => n.id === 'game-toast').map((n) => n.text),
    stored: raw === null ? null : {
      chars: raw.length,
      parsable: parsed !== null,
      version: parsed ? (parsed.version === undefined ? null : parsed.version) : null,
      terms: parsed && parsed.progress && Array.isArray(parsed.progress.termsFound) ? parsed.progress.termsFound.length : 0,
      lit: parsed && parsed.progress && Array.isArray(parsed.progress.lighthousesLit) ? parsed.progress.lighthousesLit.filter((id) => id > 0).length : 0,
      settings: parsed && parsed.settings ? { textScale: parsed.settings.textScale, quality: parsed.settings.quality, fx: parsed.settings.fx, hudQuiet: parsed.settings.hudQuiet, scenicCam: parsed.settings.scenicCam } : null,
    },
    ui: {
      textScale: document.documentElement.dataset.textScale || null,
      quality: q('visual-quality') ? q('visual-quality').value : null,
      fx: fx ? fx.dataset.fx : null,
      hudQuiet: pressed('hud-quiet-toggle'),
      scenicCam: pressed('scenic-cam-toggle'),
    },
  };
}, SAVE_KEY);

// 설정 단추를 게임의 단추 경로로 누른 뒤 pagehide로 게임이 직접 저장을 쓰게 한다
const changeAndPersist = (page, change) => page.evaluate((c) => {
  if (c.fx) { const b = document.querySelector('[data-fx="' + c.fx + '"]'); if (b) b.click(); }
  if (c.textScale) { const b = document.querySelector('button[data-text-scale="' + c.textScale + '"]'); if (b) b.click(); }
  window.dispatchEvent(new Event('pagehide'));
}, change);

// 기대값과 관찰을 맞춰 어긋난 것을 글로 돌려준다. spec.kind: fresh-then-kept(저장 없이 시작) · kept(저장이 읽혀야 함) · recovered(읽지 못해 복구해야 함)
function judge(spec, obs, expectSettings, second) {
  const why = [];
  if (spec.kind === 'recovered') {
    if (second) {
      // 재접속: 이제 정상 새 항해여야 한다
      if (obs.bannerNotes.length) why.push('복구 안내가 다시 떴다: ' + obs.bannerNotes[0]);
      if (obs.toastNotes.some((t) => t.includes(RECOVERED_TOAST))) why.push('복구 토스트가 다시 떴다');
      if (obs.startText !== '항해 시작') why.push('단추 글자 "' + obs.startText + '"(기대 "항해 시작")');
      return why;
    }
    if (!obs.bannerNotes.some((t) => t.startsWith(NOTICE))) why.push('복구 안내 배너가 뜨지 않았다(배너 기록 ' + JSON.stringify(obs.bannerNotes) + ')');
    if (!obs.toastNotes.some((t) => t.includes(RECOVERED_TOAST))) why.push('복구 토스트가 없다(토스트 기록 ' + JSON.stringify(obs.toastNotes) + ')');
    if (obs.toastNotes.some((t) => t.includes(WRONG_TOAST))) why.push('사실과 다른 토스트: ' + obs.toastNotes.find((t) => t.includes(WRONG_TOAST)));
    if (obs.stored && obs.stored.terms) why.push('깨진 저장이 그대로 남았다');
    if (obs.startText !== '항해 시작') why.push('단추 글자 "' + obs.startText + '"(기대 "항해 시작")');
    return why;
  }
  // 복구할 일이 없는 저장: 복구 안내·토스트가 없어야 한다
  if (obs.bannerNotes.length) why.push('복구 안내가 떴다: ' + obs.bannerNotes[0]);
  if (obs.toastNotes.some((t) => t.includes(RECOVERED_TOAST) || t.includes(WRONG_TOAST))) why.push('저장 관련 토스트가 떴다: ' + obs.toastNotes.find((t) => t.includes(RECOVERED_TOAST) || t.includes(WRONG_TOAST)));
  if (spec.kind === 'fresh-then-kept') {
    if (obs.startText !== '항해 시작') why.push('단추 글자 "' + obs.startText + '"(기대 "항해 시작")');
    if (obs.progressShown) why.push('진행 줄이 보인다: ' + obs.progress);
    if (obs.newGameShown) why.push('새 항해 단추가 보인다');
    if (second && !obs.stored) why.push('게임이 쓴 저장이 사라졌다(키 없음)');
  }
  if (spec.kind === 'kept') {
    if (!obs.stored) why.push('저장이 지워졌다(키 없음)');
    else {
      if (!obs.stored.parsable) why.push('저장을 읽을 수 없다');
      if (obs.stored.version !== null && obs.stored.version !== 1) why.push('저장 version ' + obs.stored.version);
      if (obs.stored.terms !== spec.terms) why.push('저장의 용어 ' + obs.stored.terms + '개(기대 ' + spec.terms + ')');
      if (obs.stored.lit !== spec.lit) why.push('저장의 등대 ' + obs.stored.lit + '개(기대 ' + spec.lit + ')');
    }
    const wantStart = spec.saved ? '이어하기' : '항해 시작';
    if (obs.startText !== wantStart) why.push('단추 글자 "' + obs.startText + '"(기대 "' + wantStart + '")');
    if (spec.saved) {
      if (!obs.newGameShown) why.push('이어하기인데 새 항해 단추가 없다');
      const re = new RegExp(' · 도감 ' + spec.terms + '/141 · 등대 ' + spec.lit + '/7$');
      if (!obs.progress || !re.test(obs.progress)) why.push('진행 줄 ' + JSON.stringify(obs.progress) + '(기대 …도감 ' + spec.terms + '/141 · 등대 ' + spec.lit + '/7)');
    } else {
      if (obs.progressShown) why.push('진행 줄이 보인다: ' + obs.progress);
      if (obs.newGameShown) why.push('새 항해 단추가 보인다');
    }
  }
  if (expectSettings) {
    const want = expectSettings, ui = obs.ui, st = obs.stored && obs.stored.settings;
    if ('textScale' in want && ui.textScale !== String(want.textScale)) why.push('글자 배율 화면 ' + ui.textScale + '(기대 ' + want.textScale + ')');
    if ('quality' in want && ui.quality !== want.quality) why.push('품질 화면 ' + ui.quality + '(기대 ' + want.quality + ')');
    if ('fx' in want && ui.fx !== want.fx) why.push('효과 화면 ' + ui.fx + '(기대 ' + want.fx + ')');
    if ('hudQuiet' in want && ui.hudQuiet !== String(want.hudQuiet)) why.push('조용한 화면 ' + ui.hudQuiet + '(기대 ' + want.hudQuiet + ')');
    if ('scenicCam' in want && ui.scenicCam !== String(want.scenicCam)) why.push('감상 카메라 ' + ui.scenicCam + '(기대 ' + want.scenicCam + ')');
    if (!st) why.push('저장에 설정이 없다');
    else for (const k of Object.keys(want)) if (st[k] !== want[k]) why.push('저장의 ' + k + ' ' + st[k] + '(기대 ' + want[k] + ')');
  }
  return why;
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
  const partial = { version: 1, settings: { textScale: 1.15, fx: 'full' } };
  const unversioned = { settings: { quality: 'low', textScale: 1.3 } };
  const savedOf = (s) => (s.progress && s.progress.termsFound ? s.progress.termsFound.length : 0) > 0 || ((s.stats && s.stats.playTimeSec) || 0) > 1 || (s.progress && s.progress.endingsSeen ? s.progress.endingsSeen.length : 0) > 0;
  const countsOf = (s) => ({ terms: s.progress && s.progress.termsFound ? s.progress.termsFound.length : 0, lit: s.progress && s.progress.lighthousesLit ? s.progress.lighthousesLit.filter((id) => id > 0).length : 0 });
  const kept = (name, save, settings, change, afterChange) => ({ name, kind: 'kept', raw: JSON.stringify(save), saved: savedOf(save), ...countsOf(save), settings, change, afterChange });
  const SPECS = [
    { name: 'fresh', kind: 'fresh-then-kept', raw: null, saved: false, change: { fx: 'lite', textScale: 1.3 }, afterChange: { fx: 'lite', textScale: 1.3 } },
    kept('late', late, null, null, null),
    kept('settings-max', settingsMax, { textScale: 1.3, quality: 'low', fx: 'lite', hudQuiet: false, scenicCam: false }, { fx: 'off' }, { textScale: 1.3, quality: 'low', fx: 'off', hudQuiet: false, scenicCam: false }),
    kept('settings-off', settingsOff, { quality: 'high', fx: 'off', textScale: 1.15 }, null, null),
    kept('partial', partial, { textScale: 1.15, fx: 'full' }, null, null),
    kept('unversioned', unversioned, { quality: 'low', textScale: 1.3 }, null, null),
    { name: 'corrupt', kind: 'recovered', raw: '{이건 json이 아니다' },
    { name: 'future', kind: 'recovered', raw: JSON.stringify({ version: 2, settings: {} }) },
  ];
  const rows = [];
  for (const spec of SPECS) {
    for (const [W, H] of SIZES) {
      // 접속 내내 배너·토스트의 변화를 기록하고(복구 안내가 어떻게 보였는지), 저장은 한 번만 심는다
      const before = async (page) => page.addInitScript(([key, value]) => {
        window.__bootNotes = [];
        try {
          const obs = new MutationObserver((list) => {
            for (const m of list) {
              const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
              const host = el && el.closest ? el.closest('#game-toast, #storage-banner') : null;
              if (host) window.__bootNotes.push({ id: host.id, text: host.textContent.trim().slice(0, 160), hidden: host.hidden });
            }
          });
          obs.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
        } catch (e) { /* 기록이 안 되면 그 항목만 비게 된다 */ }
        if (value !== null) {
          try { if (!sessionStorage.getItem('__boot_saves_seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('__boot_saves_seeded', '1'); } } catch (e) { /* 저장소가 막혀도 시험은 이어 간다 */ }
        }
      }, [SAVE_KEY, spec.raw]);
      const { browser, page, errors } = await open({ query: '', width: W, height: H, before });
      const starts = await startEnabled(page, 40000);
      const first = await observe(page).catch(() => null);
      const whyFirst = first ? judge(spec, first, spec.settings || null, false) : ['읽지 못했다'];
      // 왕복: 설정을 누르고(있으면) 게임이 직접 저장을 쓰게 한 뒤 읽고, 같은 저장소로 다시 접속해 읽는다
      await changeAndPersist(page, spec.change || {}).catch(() => {});
      const written = await observe(page).catch(() => null);
      await page.reload({ waitUntil: 'load' });
      const starts2 = await startEnabled(page, 40000);
      const second = await observe(page).catch(() => null);
      const whySecond = second ? judge(spec, second, spec.afterChange || spec.settings || null, true) : ['재접속에서 읽지 못했다'];
      // 게임이 직접 쓴 저장도 내용이 줄지 않았나(sanitize 왕복)
      const whyWritten = [];
      if (spec.kind === 'kept') {
        if (!written || !written.stored) whyWritten.push('pagehide 뒤 저장이 없다');
        else {
          if (written.stored.version !== 1) whyWritten.push('게임이 쓴 저장 version ' + written.stored.version);
          if (written.stored.terms !== spec.terms) whyWritten.push('게임이 쓴 저장의 용어 ' + written.stored.terms + '개(기대 ' + spec.terms + ')');
          if (written.stored.lit !== spec.lit) whyWritten.push('게임이 쓴 저장의 등대 ' + written.stored.lit + '개(기대 ' + spec.lit + ')');
        }
      }
      const why = [...whyFirst.map((w) => '첫 접속: ' + w), ...whyWritten.map((w) => '게임이 쓴 뒤: ' + w), ...whySecond.map((w) => '재접속: ' + w)];
      if (!starts) why.unshift('첫 접속에서 시작 단추가 켜지지 않았다');
      if (!starts2) why.push('재접속에서 시작 단추가 켜지지 않았다');
      if (errors.length) why.push('콘솔 오류 ' + errors.length + '건: ' + errors.slice(0, 2).join(' | ').slice(0, 200));
      const row = { save: spec.name, kind: spec.kind, W, H, starts, starts2, first, written: written && written.stored, second, why, errors: errors.slice(0, 5), ok: why.length === 0 };
      rows.push(row);
      const f = first || {};
      console.log(`${spec.name.padEnd(13)} ${String(W + 'x' + H).padEnd(9)} ${starts ? '시작됨' : '✗ 시작 안 됨'} · 단추 "${f.startText}" · ${f.progress ? '진행 "' + f.progress + '"' : '진행 줄 없음'} · 저장 ${f.stored ? f.stored.chars + '자(용어 ' + f.stored.terms + ')' : '없음'}${f.bannerNotes && f.bannerNotes.length ? ' · 배너 "' + f.bannerNotes[0].slice(0, 24) + '…"' : ''}${f.toastNotes && f.toastNotes.length ? ' · 토스트 "' + f.toastNotes[0] + '"' : ''} · 재접속 "${second ? second.startText : '?'}"${why.length ? '  ✗ ' + why.join(' / ') : ''}`);
      await browser.close();
    }
  }
  const bad = rows.filter((r) => !r.ok);
  console.log(bad.length ? `BOOT SAVES FAIL: ${bad.length}/${rows.length}칸` : `BOOT SAVES PASS: ${rows.length}/${rows.length}칸 — 저장이 읽히고, 설정이 화면에 반영되고, 게임이 쓴 저장을 다시 읽고, 읽지 못한 저장은 알리고 복구한다`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ rows, pass: bad.length === 0, loaded: rows.filter((r) => r.kind === 'kept').every((r) => r.first && r.first.stored && r.second && r.second.stored) }, null, 1));
  process.exit(bad.length ? 1 : 0);
})();

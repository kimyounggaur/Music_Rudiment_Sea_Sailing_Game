'use strict';
/*
 * RM9 불변 항목 (설계서 10.4 RM-D08 · RM-D09, 그리고 "이론 엔진·141개 용어·시련 규칙은 그대로"):
 * 리마스터 전후로 바뀌면 안 되는 것을 처음 게임(baseline)과 지금 게임에서 같은 방법으로 읽어 비교한다.
 *
 *   A. 소스 블록을 글자 그대로 비교: 정적 충돌체 표 함수, 상태 전환표, 세이브 키
 *   B. 실행 중 값을 비교: 용어 141개 데이터와 퀴즈 정의, 부표·유리병 자리(x, z, 해역), 해역 중심·반경, 시련 규칙(고정 시드로 만든 문항 집합), 최종 항로 명세
 *   C. 리마스터 이전 세이브가 그대로 열린다: 처음 게임이 만든 세이브(여러 진행 단계)를 지금 게임의 localStorage 에 넣고 연다.
 *      - 세이브 복구 안내 띠가 뜨지 않고, 진행(progress)·위치·세션이 그대로이며, version 이 1이고, 새 설정 칸(fx·hudQuiet·scenicCam)은 기본값으로 채워진다
 *      - 일반 주소(저장이 실제로 일어나는 경로)에서 설정을 하나 바꿔 저장한 뒤에도 진행이 보존되고 version 이 1이다
 *
 * 사용: BASELINE_URL=http://127.0.0.1:8769 BASE_URL=http://127.0.0.1:8767 node rm9-invariants.cjs
 *        [--baseline-html /home/claude/remaster/baseline/index.html] [--game-html /home/claude/remaster/game/index.html] [--out output/playwright/rm9-invariants.json]
 */
const fs = require('fs');
const path = require('path');
const { open, frames, chromium, GL_ARGS, THREE_JS } = require('./lib.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; };
const OUT = arg('out', path.join('output', 'playwright', 'rm9-invariants.json'));
const BASELINE_HTML = arg('baseline-html', '/home/claude/remaster/baseline/index.html');
const GAME_HTML = arg('game-html', '/home/claude/remaster/game/index.html');
const BASELINE_URL = process.env.BASELINE_URL || 'http://127.0.0.1:8769';
const GAME_URL = process.env.BASE_URL || 'http://127.0.0.1:8765';
const SAVE_KEY = 'lesson_designer_ocean_v1';

const problems = [], report = { A: {}, B: {}, C: {} };
const check = (cond, message) => { if (!cond) problems.push(message); return cond; };

// ---- A. 소스 블록 ----
// 문자열·주석 안의 중괄호는 세지 않고 짝이 맞는 닫는 괄호까지 잘라 낸다
function blockFrom(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  let i = src.indexOf('{', at + marker.length - (marker.endsWith('{') ? 1 : 0));
  if (i < 0) return null;
  const start = at;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) return null; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}
const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();

function sourceBlocks() {
  const base = fs.readFileSync(BASELINE_HTML, 'utf8'), game = fs.readFileSync(GAME_HTML, 'utf8');
  const markers = {
    'makeStaticWorldColliders 함수': 'function makeStaticWorldColliders() {',
    'ALLOWED_TRANSITIONS 표': 'const ALLOWED_TRANSITIONS = Object.freeze({',
  };
  for (const [name, marker] of Object.entries(markers)) {
    const a = blockFrom(base, marker), b = blockFrom(game, marker);
    const ok = Boolean(a) && Boolean(b) && normalize(a) === normalize(b);
    report.A[name] = { found: { baseline: Boolean(a), game: Boolean(b) }, bytes: a ? a.length : 0, identical: ok };
    check(ok, `A. ${name}이 처음 게임과 같아야 한다`);
  }
  const key = (text) => (text.match(/saveKey:\s*"([^"]+)"/) || [])[1] || null;
  report.A.saveKey = { baseline: key(base), game: key(game) };
  check(report.A.saveKey.baseline === SAVE_KEY && report.A.saveKey.game === SAVE_KEY, `A. 세이브 키는 ${SAVE_KEY}`);
}

// ---- B. 실행 중 값 ----
const READ = () => {
  const a = window.__OCEAN_API__;
  const ids = a.TERMS.map((t) => t.id);
  const spawns = ids.map((id) => {
    const s = a.contentQa.term(id).spawn;
    return s ? { id, kind: s.reward ? 'bottle' : 'buoy', region: s.region, x: s.x, z: s.z } : { id, kind: null };
  });
  const audit = a.contentQa.audit();
  return {
    termCount: ids.length,
    terms: JSON.stringify(a.TERMS),
    quiz: JSON.stringify(a.QUIZ_DEFS),
    spawns,
    bottles: a.contentQa.bottles(),
    audit: { terms: audit.terms, buoys: audit.buoys, bottles: audit.bottles, quiz: audit.quiz },
    regions: a.WORLD_REGIONS.map((r) => ({ id: r.id, center: r.center, radius: r.radius })),
    lessons: JSON.stringify(a.REGION_LESSONS),
    trials: Array.from({ length: 8 }, (_, region) => JSON.stringify(a.questQa.generate(region))),
    route: JSON.stringify(a.FINAL_ROUTE_SPECS),
    npc: JSON.stringify(a.NPC_REGISTRY),
  };
};
async function readRuntime(base, label) {
  const session = await open({ query: '?qa=1', width: 640, height: 400, base });
  try {
    await session.page.waitForSelector('#start-sailing:not([disabled])', { timeout: 40000 });
    await session.page.click('#start-sailing');
    await session.page.waitForTimeout(800);
    const data = await session.page.evaluate(READ);
    data.consoleErrors = session.errors.length;
    return data;
  } finally {
    await session.browser.close();
  }
}

function compareRuntime(base, game) {
  const same = (name, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); report.B[name] = ok ? 'identical' : 'DIFFERENT'; check(ok, `B. ${name}이 처음 게임과 같아야 한다`); return ok; };
  report.B.termCount = { baseline: base.termCount, game: game.termCount };
  check(base.termCount === 141 && game.termCount === 141, 'B. 용어는 141개');
  same('용어 데이터(141개 전부)', base.terms, game.terms);
  same('퀴즈 정의', base.quiz, game.quiz);
  const buoys = game.spawns.filter((s) => s.kind === 'buoy').length, bottleTerms = game.spawns.filter((s) => s.kind === 'bottle').length;
  report.B.spawnKinds = { buoys, bottleTerms, none: game.spawns.filter((s) => !s.kind).length };
  check(buoys + bottleTerms === 141, 'B. 모든 용어가 부표 또는 유리병에 놓여 있다');
  same('부표·유리병 자리(용어 141개의 x, z, 해역)', base.spawns, game.spawns);
  same('유리병 18개(id·해역·보상·x·z)', base.bottles, game.bottles);
  check(game.bottles.length === 18, 'B. 유리병은 18개');
  same('콘텐츠 감사표(용어·부표·유리병·퀴즈)', base.audit, game.audit);
  same('해역 중심·반경', base.regions, game.regions);
  same('해역 수업 규칙', base.lessons, game.lessons);
  same('시련 문항 집합(해역 0~7, 기본 시드)', base.trials, game.trials);
  same('최종 항로 명세', base.route, game.route);
  same('NPC 명부', base.npc, game.npc);
}

// ---- C. 리마스터 이전 세이브 ----
async function makeOldSaves() {
  const session = await open({ query: '?qa=1', width: 640, height: 400, base: BASELINE_URL });
  try {
    await session.page.waitForSelector('#start-sailing:not([disabled])', { timeout: 40000 });
    await session.page.click('#start-sailing');
    await session.page.waitForTimeout(800);
    return await session.page.evaluate(() => {
      const a = window.__OCEAN_API__, out = {};
      const snap = () => JSON.parse(JSON.stringify(a.journeyQa.snapshot().save));
      a.questQa.prepare(0); out['항구(처음)'] = snap();
      a.questQa.prepare(1); out['1번 해역 준비'] = snap();
      a.questQa.prepare(4); out['4번 해역 준비'] = snap();
      a.questQa.prepare(7); out['7번 해역 준비'] = snap();
      a.journeyQa.prepareNormalFinale(); out['일반 엔딩 직전'] = snap();
      a.journeyQa.prepareHiddenFinale(); out['히든 엔딩 직전(용어 141·병 18)'] = snap();
      return out;
    });
  } finally {
    await session.browser.close();
  }
}

const NEW_SETTINGS = ['fx', 'hudQuiet', 'scenicCam'];
async function openWithSave(save, query) {
  const browser = await chromium.launch({ args: GL_ARGS });
  const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver Message|GPU stall/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.route('https://cdnjs.cloudflare.com/**', (route) => route.fulfill({ path: THREE_JS, contentType: 'application/javascript' }));
  // 처음 한 번만 심는다(다시 열 때 지금 게임이 쓴 저장을 덮지 않게)
  await context.addInitScript(({ key, raw }) => { if (!sessionStorage.getItem('__seeded__')) { localStorage.setItem(key, raw); sessionStorage.setItem('__seeded__', '1'); } }, { key: SAVE_KEY, raw: JSON.stringify(save) });
  await page.goto(GAME_URL + '/' + query, { waitUntil: 'load' });
  return { browser, page, errors };
}

async function checkOldSaves() {
  const saves = await makeOldSaves();
  report.C.saves = Object.keys(saves).length;
  const rows = [];
  for (const [label, old] of Object.entries(saves)) {
    check(old.version === 1, `C. [${label}] 처음 게임이 만든 세이브의 version 은 1`);
    const { browser, page, errors } = await openWithSave(old, '?qa=1');
    try {
      await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 40000 });
      await page.waitForTimeout(500);
      const loaded = await page.evaluate(() => ({
        save: JSON.parse(JSON.stringify(window.__OCEAN_API__.journeyQa.snapshot().save)),
        banner: !document.getElementById('storage-banner').hidden,
        realUnchanged: window.__OCEAN_API__.journeyQa.snapshot().realStorageUnchanged,
      }));
      const s = loaded.save;
      const row = { label, version: s.version, banner: loaded.banner, newSettings: Object.fromEntries(NEW_SETTINGS.map((k) => [k, s.settings ? s.settings[k] : undefined])) };
      check(s.version === 1, `C. [${label}] 열린 세이브의 version 은 1 (${s.version})`);
      check(loaded.banner === false, `C. [${label}] 복구 안내 띠가 뜨지 않는다(옛 세이브를 손상으로 보지 않는다)`);
      for (const part of ['progress', 'position', 'session']) {
        const same = JSON.stringify(s[part]) === JSON.stringify(old[part]);
        row[part] = same ? 'identical' : 'DIFFERENT';
        check(same, `C. [${label}] ${part}가 그대로 열린다`);
      }
      // 옛 세이브에 있던 설정은 그대로, 새 칸은 기본값
      const oldKeys = Object.keys(old.settings || {});
      const keptSettings = oldKeys.every((k) => JSON.stringify(s.settings[k]) === JSON.stringify(old.settings[k]));
      check(keptSettings, `C. [${label}] 옛 설정 값이 그대로다`);
      check(s.settings.fx === 'auto' && typeof s.settings.hudQuiet === 'boolean' && typeof s.settings.scenicCam === 'boolean', `C. [${label}] 새 설정 칸이 기본값으로 채워진다 (${JSON.stringify(row.newSettings)})`);
      check(errors.length === 0, `C. [${label}] 콘솔 오류 없음 ${errors.slice(0, 2).join(' | ')}`);
      rows.push(row);
    } finally {
      await browser.close();
    }
  }
  report.C.rows = rows;

  // 일반 주소: 저장이 실제로 일어나는 경로. 가장 진행이 많은 세이브로 열어 설정을 바꾸고 저장된 원문을 읽는다.
  const richest = saves['히든 엔딩 직전(용어 141·병 18)'];
  const { browser, page, errors } = await openWithSave(richest, '');
  try {
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 40000 });
    await page.click('#start-sailing');
    await page.waitForTimeout(1500);
    // 메뉴 → 설정 → 화면 효과 '가벼움'
    await page.evaluate(() => { const b = document.getElementById('menu-button'); if (b) b.click(); });
    await page.waitForTimeout(700);
    await page.evaluate(() => { const b = document.querySelector('.menu-tab[data-tab="settings"]'); if (b) b.click(); });
    await page.waitForTimeout(500);
    const clicked = await page.evaluate(() => { const b = document.querySelector('[data-fx="lite"]'); if (!b) return false; b.click(); return true; });
    await frames(page, 4);
    const raw = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
    const stored = raw ? JSON.parse(raw) : null;
    report.C.plain = { clickedFx: clicked, stored: Boolean(stored), version: stored && stored.version, fx: stored && stored.settings && stored.settings.fx };
    check(clicked, 'C. 일반 주소: 메뉴 설정에서 화면 효과 단추를 찾는다');
    check(Boolean(stored) && stored.version === 1, 'C. 일반 주소: 저장된 세이브의 version 은 1');
    check(stored && stored.settings && stored.settings.fx === 'lite', 'C. 일반 주소: 바꾼 설정(fx: lite)이 저장된다');
    check(stored && JSON.stringify(stored.progress.termsFound) === JSON.stringify(richest.progress.termsFound) && JSON.stringify(stored.progress.lighthousesLit) === JSON.stringify(richest.progress.lighthousesLit) && JSON.stringify(stored.progress.bottlesOpened) === JSON.stringify(richest.progress.bottlesOpened), 'C. 일반 주소: 저장 뒤에도 진행(용어·등대·병)이 보존된다');
    check(errors.length === 0, 'C. 일반 주소: 콘솔 오류 없음 ' + errors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
  }
}

(async () => {
  try {
    sourceBlocks();
    const base = await readRuntime(BASELINE_URL, 'baseline');
    const game = await readRuntime(GAME_URL, 'game');
    compareRuntime(base, game);
    check(base.consoleErrors === 0 && game.consoleErrors === 0, 'B. 두 게임 모두 콘솔 오류 없음');
    await checkOldSaves();
  } catch (e) {
    problems.push('실행 오류: ' + String((e && e.stack) || e).slice(0, 600));
  }
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ problems, report }, null, 1));
  console.log(JSON.stringify(report.A));
  console.log(JSON.stringify(report.B));
  console.log(JSON.stringify(report.C));
  problems.slice(0, 20).forEach((m) => console.log('  -', m));
  console.log(problems.length === 0 ? 'INVARIANTS PASS' : 'INVARIANTS FAIL');
  process.exit(problems.length === 0 ? 0 : 1);
})();

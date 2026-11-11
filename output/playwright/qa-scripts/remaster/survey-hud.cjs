'use strict';
/*
 * 항해 HUD 배치 전수 측정 (RM8).
 *   창 크기 × 글자 배율 × 터치 여부마다 항해 HUD(해역 칩·목표 칩·수집 카운터·조작 단추·조이스틱·나침반)를 켜 보고
 *   ① 중앙 안전영역(가운데 60%×55%) 침범 ② HUD끼리 겹침 ③ 화면 밖으로 나감을 잰다.
 *   검사 O-40(잠잠·떠오름 각각 중앙 안전영역 위반 0)과 같은 상태·같은 계측(measureCenterSafeZone)이다.
 *   항해 상태는 속성만 잠깐 바꿔서 만든다(uiHudProbe와 같은 방식). 게임 루프가 속성을 되돌리므로 한 번의 동기 호출 안에서 켜고·재고·되돌린다.
 *   목표 칩의 위치는 "실제 항해처럼"(해역 칩 아래 + 6px로 --m-chip-bottom을 놓은 상태, 게임의 ResizeObserver가 하는 일)로 잰다.
 *   RM8부터 uiHudProbe(O-38~O-41)도 같은 값을 놓으므로 이 측정과 O-40이 같은 상태를 잰다.
 *   참고로 값을 놓지 않은 상태(RM7까지 O-40이 접속 때 보던 어림값)도 함께 재서 결과 파일(asTest)에만 남긴다(위반 판정에는 쓰지 않는다).
 *   RM7 UI 행렬은 터치 에뮬레이션으로 6개 화면만 재서, 터치가 아닌 작은 창(가로 폰 크기의 데스크톱 창, 1024×600 등)을 보지 못했다.
 *
 * 사용(예):
 *   BASE_URL=http://127.0.0.1:8767 node survey-hud.cjs                                  기본: 화면 40종 × 배율 1·1.15·1.3 × 터치 없음·있음
 *   node survey-hud.cjs 844x390,1024x600 1,1.3 0,1 결과.json                              화면 · 배율 · 터치(0/1) · 결과 파일(선택)
 * 환경변수: BASE_URL(기본 게임 폴더 서버), CSS_FILE(이 CSS를 페이지에 덧붙여 후보 규칙을 빌드 없이 시험한다)
 * 종료 코드: 위반이 한 칸이라도 있으면 1.
 */
const fs = require('fs');
const { open } = require('./lib.cjs');

const DEFAULT_VIEWS = [
  // 세로
  '320x568', '360x592', '360x640', '375x667', '375x812', '390x664', '390x844', '412x732', '412x915', '414x622', '768x1024',
  // 가로폰·작은 태블릿·작은 창
  '568x320', '640x360', '667x375', '700x500', '740x360', '800x600', '812x375', '844x390', '896x414', '900x500', '926x428', '932x430',
  '960x540', '1024x600', '1024x768', '1180x820', '1280x720', '1280x800', '1366x657', '1366x768', '1440x900', '1920x1080', '2560x1440',
].join(',');
const VIEWS = (process.argv[2] || DEFAULT_VIEWS).split(',').map((s) => s.split('x').map(Number));
const SCALES = (process.argv[3] || '1,1.15,1.3').split(',').map(Number);
const TOUCHES = (process.argv[4] || '0,1').split(',').map((s) => s === '1');
const OUT = process.argv[5] || '';

const HUD_SELECTORS = ['.region-chip', '.objective-chip', '.collect-counter', '.action-cluster', '.joystick', '.instrument'];

(async () => {
  const rows = [];
  for (const touch of TOUCHES) {
    const { browser, page } = await open({ query: '?qa=1', width: 1280, height: 720, touch });
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyReducedMotion(true); g.audio.setMuted(true); const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; window.__OCEAN_API__.hudQa.noTransition(true); });
    if (process.env.CSS_FILE) {
      const css = fs.readFileSync(process.env.CSS_FILE, 'utf8');
      await page.evaluate((css) => { const s = document.createElement('style'); s.id = 'cand-css'; s.textContent = css; document.head.append(s); }, css);
    }
    for (const [W, H] of VIEWS) {
      await page.setViewportSize({ width: W, height: H });
      for (const scale of SCALES) {
        await page.evaluate((scale) => {
          document.documentElement.style.setProperty('--text-scale', scale);
          document.documentElement.dataset.textScale = String(scale);
        }, scale);
        await page.waitForTimeout(200); // 글자 배율·창 크기 변경이 레이아웃에 반영될 시간
        const probe = async (placed) => page.evaluate(([sels, touch, placed]) => {
          const api = window.__OCEAN_API__, html = document.documentElement, undo = [];
          const setAttr = (name, value) => { const old = html.getAttribute(name); undo.push(() => (old === null ? html.removeAttribute(name) : html.setAttribute(name, old))); html.setAttribute(name, value); };
          const setProp = (node, name, value) => { const old = node[name]; undo.push(() => (node[name] = old)); node[name] = value; };
          const setText = (node, value) => { const old = node.textContent; undo.push(() => (node.textContent = old)); node.textContent = value; };
          const shell = document.getElementById('phase-shell');
          if (shell && shell.classList.contains('test-mode')) { shell.classList.remove('test-mode'); undo.push(() => shell.classList.add('test-mode')); }
          setAttr('data-mode', 'SAILING'); setAttr('data-ui-notransition', 'true'); setAttr('data-hud', 'awake'); setAttr('data-touch', touch ? 'true' : 'false');
          for (const selector of ['.hud', '.minimap-panel', '#control-layer']) { const n = document.querySelector(selector); if (n) setProp(n, 'inert', false); }
          setProp(document.getElementById('objective-chip'), 'hidden', false);
          setText(document.getElementById('objective-title'), '1/6 · 앞으로 나아가세요');
          setText(document.getElementById('objective-hint'), 'W / ↑ · 앞으로');
          setProp(document.querySelector('.minimap-panel'), 'hidden', !(innerWidth >= 900 && innerHeight > 500)); // O-40과 같은 규칙
          if (placed) {
            const region = document.getElementById('region-chip'), old = html.style.getPropertyValue('--m-chip-bottom');
            undo.push(() => (old ? html.style.setProperty('--m-chip-bottom', old) : html.style.removeProperty('--m-chip-bottom')));
            html.style.setProperty('--m-chip-bottom', Math.round(region.getBoundingClientRect().bottom + 6) + 'px');
          } else {
            const old = html.style.getPropertyValue('--m-chip-bottom');
            undo.push(() => (old ? html.style.setProperty('--m-chip-bottom', old) : html.style.removeProperty('--m-chip-bottom')));
            html.style.removeProperty('--m-chip-bottom');
          }
          const shown = (n) => { if (n.hidden || n.closest('[hidden]')) return false; for (let a = n; a && a !== html; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false; } const b = n.getBoundingClientRect(); return b.width > 1 && b.height > 1; };
          const rects = {};
          for (const q of sels) { const n = document.querySelector(q); if (n && shown(n)) { const b = n.getBoundingClientRect(); rects[q] = [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; } }
          const center = api.measureCenterSafeZone();
          const names = Object.keys(rects), overlaps = [];
          for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
            const a = rects[names[i]], b = rects[names[j]];
            const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
            if (w > 2 && h > 2) overlaps.push(names[i].slice(1) + '×' + names[j].slice(1) + ' ' + Math.round(Math.min(w, h)) + 'px');
          }
          const off = names.filter((q) => rects[q][0] < -0.5 || rects[q][1] < -0.5 || rects[q][2] > innerWidth + 0.5 || rects[q][3] > innerHeight + 0.5).map((q) => q.slice(1));
          undo.reverse().forEach((fn) => fn());
          return { rects, center: center.violations, zone: center.zone, overlaps, off, visible: names.length };
        }, [HUD_SELECTORS, touch, placed]);
        const asTest = await probe(false), real = await probe(true);
        const r = { rects: real.rects, center: real.center, zone: real.zone, overlaps: real.overlaps, off: real.off, visible: real.visible, asTest: { center: asTest.center, rects: asTest.rects } };
        const bad = [];
        if (r.visible < 3) bad.push('HUD가 켜지지 않음(측정 무효)'); // 켜지지 않은 채 "위반 0"이 나오는 것을 막는다
        if (r.center.length) bad.push('안전영역: ' + r.center.join('+'));
        if (r.overlaps.length) bad.push('겹침: ' + r.overlaps.join(', '));
        if (r.off.length) bad.push('화면 밖: ' + r.off.join('+'));
        rows.push({ touch, W, H, scale, ...r, bad });
      }
    }
    await browser.close();
  }
  let nbad = 0;
  const kinds = { 안전영역: 0, 겹침: 0, '화면 밖': 0, 'HUD가 켜지지 않음(측정 무효)': 0 };
  for (const r of rows) {
    if (r.bad.length) { nbad++; for (const b of r.bad) kinds[b.split(':')[0]] = (kinds[b.split(':')[0]] || 0) + 1; }
    if (r.bad.length) console.log(`${r.touch ? '터치' : '비터치'} ${String(r.W + 'x' + r.H).padEnd(9)} s${String(r.scale).padEnd(4)} ✗ ${r.bad.join(' · ')}`);
  }
  console.log('종류별 위반 칸', JSON.stringify(kinds));
  console.log(nbad ? 'HUD SURVEY FAIL: 위반 ' + nbad + '칸 / ' + rows.length : 'HUD SURVEY PASS: 위반 0 (' + rows.length + '칸)');
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows));
  process.exit(nbad ? 1 : 0);
})();

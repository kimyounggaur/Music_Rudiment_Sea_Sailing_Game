'use strict';
/*
 * 해역 표제 카드와 지도가 겹치는지 재는 시험 (RM8에서 만들고, RM9에서 플레이어가 직접 지도를 여는 두 순서를 더했다).
 *   처음 가는 해역에 들어서면 표제 카드(가운데 위, 동작 줄이기가 아니면 4.4초)가 뜨고, 지도를 잠깐(5초) 자동으로 보여 준다.
 *   RM7까지는 둘이 같은 프레임에 떠서 폭 약 480px 이하 폰에서 카드 오른쪽 아래와 지도 왼쪽 위가 겹쳤다(375폭 54×40px, 320폭 72×96px).
 *   RM8은 지도를 카드가 걷힌 뒤로 미룬다(rm8a.py 7번). RM9는 플레이어가 직접 여는 두 순서를 닫는다(rm9a.py 4b):
 *     카드가 떠 있는 동안 지도를 열면 카드를 바로 걷고, 지도가 열려 있는 동안 해역에 들어서면 카드를 띄우지 않는다.
 *   이 시험은 해역에 들어서는 순간(게임의 해역 진입 분기를 직접 일으킨다: lastRegion을 비우고 firstVisit을 켠다.
 *   rm7-capture.cjs의 region-banner 장면과 같은 방법)부터 프레임마다 두 요소의 보임·자리를 모은다.
 *
 * 모드(한 칸 = 화면 크기 × 동작 줄이기 끔·켬 안에서 차례로, 같은 페이지):
 *   auto       자동 지도. ① 카드와 지도가 함께 보인 프레임 수 ② 그때 겹친 프레임 수 ③ 지도가 카드보다 먼저 떴는지.
 *   user-open  카드가 또렷이(불투명도 0.9 이상) 보이는 프레임에서 플레이어처럼 나침반 단추를 누른다(DOM click). 누르기 직전에 카드가 보였고, 누른 뒤 카드 프레임 0, 지도가 뜸, 함께 0.
 *   map-first  지도를 먼저 열어 둔 채 해역에 들어선다. 카드는 뜨지 않고, 지도는 계속 열려 있고(도구를 빼앗지 않는다), 함께 0.
 *   RM7 촬영 행렬(rm7-capture.cjs)은 지도를 직접 닫고 재는 장면이 있어 이 상황들을 보지 못했다.
 *
 * 사용(예):
 *   BASE_URL=http://127.0.0.1:8767 node rm8-cardmap.cjs                            기본: 화면 8종 × 동작 줄이기 끔·켬 × 모드 3
 *   node rm8-cardmap.cjs 375x667,320x568 --modes auto,user-open --out 결과.json
 * 통과 조건(칸마다): 항해 중에 시작했고, 모드별 기준(위)을 채우고, 콘솔 오류 없음.
 *   배를 순간이동시키는 방식은 쓰지 않는다: 부표 가까이에 떨어지면 같은 프레임에 용어 카드가 열려 항해 상태가 아니게 되고, 그러면
 *   게임이 지도를 자동으로 열지 않아(항해 중일 때만 연다) 시험이 겹침 없이 통과해 버린다. 시험 중 용어 카드가 열리면 그 프레임마다 닫는다.
 */
const fs = require('fs');
const { open, frames, startSailing } = require('./lib.cjs');

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : ''; };
const OUT = flag('--out');
const MODES = (flag('--modes') || 'auto,user-open,map-first').split(',').filter(Boolean);
const sizeArg = argv.find((a, i) => /^\d+x\d+(,\d+x\d+)*$/.test(a) && argv[i - 1] !== '--out' && argv[i - 1] !== '--modes');
const SIZES = (sizeArg || '320x568,375x667,375x812,390x844,412x915,568x320,844x390,1440x900').split(',').map((s) => s.split('x').map(Number));
const WATCH_MS = { auto: 16000, 'user-open': 9000, 'map-first': 7000 };

// 두 요소의 사각형 겹침(양쪽 2px 넘게 겹칠 때)
const overlaps = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 2 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 2;

async function idleWait(page, { closeMap }) {
  // 앞선 진입의 카드·자동 지도가 끝날 때까지 기다린다(그래야 이번 것만 잰다).
  // closeMap이면 지도가 닫히기까지 기다리고, 8초를 기다려도 열려 있으면(직접 열어 둔 지도) 플레이어처럼 눌러 닫는다.
  for (let i = 0; i < 80; i++) {
    const st = await page.evaluate(({ closeMap, force }) => {
      const g = window.__OCEAN_GAME__;
      if (closeMap && force && g.ux.mapOpen) document.getElementById('compass').click();
      return { card: g.ux.cardStart == null, map: Boolean(g.ux.mapOpen) };
    }, { closeMap, force: i >= 16 });
    if (st.card && (!closeMap || !st.map)) return;
    await page.waitForTimeout(500);
  }
}

async function watchOnce(page, mode) {
  return page.evaluate(({ mode, watch }) => new Promise((resolve) => {
    const g = window.__OCEAN_GAME__;
    const html = document.documentElement;
    const rect = (sel) => {
      const n = document.querySelector(sel);
      if (!n || n.hidden || n.closest('[hidden]')) return null;
      for (let a = n; a && a !== html; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return null;
      }
      const b = n.getBoundingClientRect();
      return b.width > 1 && b.height > 1 ? [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] : null;
    };
    const cardOpacity = () => { const n = document.getElementById('region-banner'); return n && !n.hidden ? Number(getComputedStyle(n).opacity) : 0; };
    const modeAtStart = html.dataset.mode || null;
    const mapOpenAtStart = Boolean(g.ux.mapOpen);
    // 게임의 해역 진입 분기(update의 "lastRegion !== currentRegion")를 일으킨다: 카드를 띄우고 처음 가는 해역이면 지도를 자동으로 연다.
    g.ux.lastRegion = -1;
    g.ux.firstVisit = true;
    const t0 = performance.now(), samples = [];
    let clickedAt = null, clickIndex = -1, cardRectAtClick = null;
    const tick = () => {
      const now = performance.now();
      if (g.currentTerm) g.closeTermCard(); // 부표 가까이에서 열린 용어 카드는 닫는다
      // user-open: 카드가 또렷이(불투명도 0.9 이상) 보이는 프레임에서 플레이어처럼 나침반 단추를 누른다
      if (mode === 'user-open' && clickedAt === null && cardOpacity() >= 0.9) {
        cardRectAtClick = rect('#region-banner'); // 누르기 직전에 카드가 보였는가(표본은 누른 뒤에 찍히므로 따로 적는다)
        document.getElementById('compass').click();
        clickedAt = Math.round(now - t0);
        clickIndex = samples.length;
      }
      samples.push({ t: Math.round(now - t0), mode: html.dataset.mode || null, card: rect('#region-banner'), map: rect('.minimap-panel') });
      if (now - t0 < watch) requestAnimationFrame(tick); else resolve({ samples, modeAtStart, mapOpenAtStart, clickedAt, clickIndex, cardVisibleAtClick: cardRectAtClick !== null });
    };
    requestAnimationFrame(tick);
  }), { mode, watch: WATCH_MS[mode] });
}

(async () => {
  const rows = [];
  for (const reduced of [false, true]) {
    for (const [W, H] of SIZES) {
      const touch = W <= 900;
      const { browser, page, errors } = await open({ width: W, height: H, touch, base: process.env.BASE_URL });
      await startSailing(page);
      await page.evaluate((reduced) => {
        const g = window.__OCEAN_GAME__;
        g.applyReducedMotion(reduced);
        const q = document.getElementById('qa-hud');
        if (q) q.style.display = 'none';
        window.__OCEAN_API__.hudQa.setQuiet(false);
      }, reduced);
      for (const mode of MODES) {
        if (mode === 'map-first') {
          // 지도를 플레이어처럼 먼저 열어 둔다. 자동으로 열려 있던 지도라면 닫았다 다시 열어 직접 연 지도로 만든다
          // (직접 누르면 자동 닫힘이 취소된다: toggleMinimap이 autoMapToken을 올린다).
          await idleWait(page, { closeMap: false });
          await page.evaluate(() => { const c = document.getElementById('compass'); if (window.__OCEAN_GAME__.ux.mapOpen) c.click(); c.click(); });
        } else {
          await idleWait(page, { closeMap: true });
        }
        await frames(page, 3);
        const res = await watchOnce(page, mode);
        const s = res.samples;
        const both = s.filter((x) => x.card && x.map);
        const overlap = both.filter((x) => overlaps(x.card, x.map));
        const cardT = s.filter((x) => x.card).map((x) => x.t), mapT = s.filter((x) => x.map).map((x) => x.t);
        const worst = overlap.reduce((m, x) => { const a = x.card, b = x.map; const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return w * h > m.area ? { area: w * h, w, h } : m; }, { area: 0, w: 0, h: 0 });
        const row = {
          mode, W, H, touch, reduced, samples: s.length, modeAtStart: res.modeAtStart,
          cardFrames: cardT.length, cardFrom: cardT[0] ?? null, cardTo: cardT[cardT.length - 1] ?? null,
          mapFrames: mapT.length, mapFrom: mapT[0] ?? null, mapTo: mapT[mapT.length - 1] ?? null,
          together: both.length, overlapFrames: overlap.length, worstOverlap: worst.area ? worst.w + '×' + worst.h : null,
          mapBeforeCardEnd: mapT.length && cardT.length ? mapT[0] < cardT[cardT.length - 1] : null,
          errors: errors.slice(0, 3),
        };
        if (mode === 'user-open') {
          const before = s.slice(0, Math.max(0, res.clickIndex)), after = res.clickIndex >= 0 ? s.slice(res.clickIndex) : [];
          Object.assign(row, {
            clickedAt: res.clickedAt, cardVisibleAtClick: res.cardVisibleAtClick, cardFramesBeforeClick: before.filter((x) => x.card).length,
            cardFramesAfterClick: after.filter((x) => x.card).length, mapFramesAfterClick: after.filter((x) => x.map).length,
          });
        }
        if (mode === 'map-first') Object.assign(row, { mapOpenAtStart: res.mapOpenAtStart });
        const base = row.modeAtStart === 'SAILING' && row.together === 0 && row.overlapFrames === 0 && row.errors.length === 0;
        if (mode === 'auto') row.ok = base && row.cardFrames >= 3 && row.mapFrames >= 3 && row.mapBeforeCardEnd === false;
        else if (mode === 'user-open') row.ok = base && row.clickedAt !== null && row.cardVisibleAtClick === true && row.cardFramesAfterClick === 0 && row.mapFramesAfterClick >= 3;
        else row.ok = base && row.mapOpenAtStart === true && row.cardFrames === 0 && row.mapFrames >= Math.ceil(row.samples * 0.95);
        rows.push(row);
        const extra = mode === 'user-open' ? ` · 누름 ${row.clickedAt}ms(누르기 직전 카드 ${row.cardVisibleAtClick ? '보임' : '안 보임'}, 누른 뒤 카드 ${row.cardFramesAfterClick}프레임·지도 ${row.mapFramesAfterClick}프레임)` : mode === 'map-first' ? ` · 시작 때 지도 ${row.mapOpenAtStart ? '열림' : '닫힘'}` : '';
        console.log(`${String(W + 'x' + H).padEnd(9)} ${mode.padEnd(9)} 동작줄이기=${reduced ? '켬' : '끔'} 시작 화면=${row.modeAtStart} · 카드 ${row.cardFrames}프레임(${row.cardFrom}~${row.cardTo}ms) · 지도 ${row.mapFrames}/${row.samples}프레임(${row.mapFrom}~${row.mapTo}ms) · 함께 ${row.together} · 겹침 ${row.overlapFrames}${row.worstOverlap ? ' (최대 ' + row.worstOverlap + ')' : ''}${extra}${row.ok ? '' : '  ✗'}`);
      }
      await browser.close();
    }
  }
  const bad = rows.filter((r) => !r.ok);
  const byMode = Object.fromEntries(MODES.map((m) => [m, { cells: rows.filter((r) => r.mode === m).length, ok: rows.filter((r) => r.mode === m && r.ok).length }]));
  console.log(bad.length ? `CARDMAP FAIL: ${bad.length}/${rows.length}칸` : `CARDMAP PASS: ${rows.length}/${rows.length}칸 — 카드와 지도가 함께 뜨지 않는다`, JSON.stringify(byMode));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ rows, modes: MODES, byMode, pass: bad.length === 0, errors: bad.length ? ['cardmap fail ' + bad.length] : [] }, null, 1));
  process.exit(bad.length ? 1 : 0);
})();

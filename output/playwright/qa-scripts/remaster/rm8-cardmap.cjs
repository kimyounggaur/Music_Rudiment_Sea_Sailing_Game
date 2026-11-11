'use strict';
/*
 * 처음 가는 해역의 표제 카드와 자동 지도가 겹치는지 재는 시험 (RM8).
 *   처음 가는 해역에 들어서면 표제 카드(가운데 위, 동작 줄이기가 아니면 4.4초)가 뜨고, 지도를 잠깐(5초) 자동으로 보여 준다.
 *   RM7까지는 둘이 같은 프레임에 떠서 폭 약 480px 이하 폰에서 카드 오른쪽 아래와 지도 왼쪽 위가 겹쳤다(375폭 54×40px, 320폭 72×96px).
 *   RM8은 지도를 카드가 걷힌 뒤로 미룬다(rm8a.py 7번). 이 시험은 처음 가는 해역에 들어서는 순간(게임의 해역 진입 분기를 직접 일으킨다:
 *   lastRegion을 비우고 firstVisit을 켠다. rm7-capture.cjs의 region-banner 장면과 같은 방법)부터 프레임마다 두 요소의 보임·자리를 모아
 *   ① 카드와 지도가 함께 보인 프레임 수 ② 그때 겹친 프레임 수 ③ 지도가 카드보다 먼저 떴는지를 본다.
 *   RM7 촬영 행렬(rm7-capture.cjs)은 지도를 직접 닫고 재는 장면이 있어 이 상황(첫 방문의 자동 지도)을 보지 못했다.
 *
 * 사용(예):
 *   BASE_URL=http://127.0.0.1:8767 node rm8-cardmap.cjs                            기본: 화면 8종 × 동작 줄이기 끔·켬
 *   node rm8-cardmap.cjs 375x667,320x568 --out 결과.json
 * 통과 조건(칸마다): 항해 중에 시작했고, 카드와 지도가 모두 보였으며, 함께 보인 프레임 0, 지도가 카드보다 먼저 뜨지 않음, 콘솔 오류 없음.
 *   배를 순간이동시키는 방식은 쓰지 않는다: 부표 가까이에 떨어지면 같은 프레임에 용어 카드가 열려 항해 상태가 아니게 되고, 그러면
 *   게임이 지도를 자동으로 열지 않아(항해 중일 때만 연다) 시험이 겹침 없이 통과해 버린다. 시험 중 용어 카드가 열리면 그 프레임마다 닫는다.
 */
const fs = require('fs');
const { open, frames, startSailing } = require('./lib.cjs');

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : '';
const sizeArg = argv.find((a, i) => /^\d+x\d+(,\d+x\d+)*$/.test(a) && argv[i - 1] !== '--out');
const SIZES = (sizeArg || '320x568,375x667,375x812,390x844,412x915,568x320,844x390,1440x900').split(',').map((s) => s.split('x').map(Number));
const WATCH_MS = 16000;

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
      // 앞선 해역 진입의 카드·자동 지도가 끝날 때까지 기다린다(그래야 이번 해역의 것만 잰다)
      for (let i = 0; i < 60; i++) {
        const idle = await page.evaluate(() => { const g = window.__OCEAN_GAME__; return g.ux.cardStart == null && !g.ux.mapOpen; });
        if (idle) break;
        await page.waitForTimeout(500);
      }
      await frames(page, 3);
      const res = await page.evaluate(({ watch }) => new Promise((resolve) => {
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
        const modeAtStart = html.dataset.mode || null;
        // 게임의 해역 진입 분기(update의 "lastRegion !== currentRegion")를 일으킨다: 카드를 띄우고 처음 가는 해역이면 지도를 자동으로 연다.
        g.ux.lastRegion = -1;
        g.ux.firstVisit = true;
        const t0 = performance.now(), samples = [];
        const tick = () => {
          const now = performance.now();
          if (g.currentTerm) g.closeTermCard(); // 부표 가까이에서 열린 용어 카드는 닫는다
          samples.push({ t: Math.round(now - t0), mode: html.dataset.mode || null, card: rect('#region-banner'), map: rect('.minimap-panel') });
          if (now - t0 < watch) requestAnimationFrame(tick); else resolve({ samples, modeAtStart });
        };
        requestAnimationFrame(tick);
      }), { watch: WATCH_MS });
      const s = res.samples;
      const both = s.filter((x) => x.card && x.map);
      const overlap = both.filter((x) => {
        const a = x.card, b = x.map;
        return Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 2 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 2;
      });
      const cardT = s.filter((x) => x.card).map((x) => x.t), mapT = s.filter((x) => x.map).map((x) => x.t);
      const worst = overlap.reduce((m, x) => { const a = x.card, b = x.map; const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return w * h > m.area ? { area: w * h, w, h } : m; }, { area: 0, w: 0, h: 0 });
      const row = {
        W, H, touch, reduced, samples: s.length, modeAtStart: res.modeAtStart,
        cardFrames: cardT.length, cardFrom: cardT[0] ?? null, cardTo: cardT[cardT.length - 1] ?? null,
        mapFrames: mapT.length, mapFrom: mapT[0] ?? null, mapTo: mapT[mapT.length - 1] ?? null,
        together: both.length, overlapFrames: overlap.length, worstOverlap: worst.area ? worst.w + '×' + worst.h : null,
        mapBeforeCardEnd: mapT.length && cardT.length ? mapT[0] < cardT[cardT.length - 1] : null,
        errors: errors.slice(0, 3),
      };
      row.ok = row.modeAtStart === 'SAILING' && row.cardFrames >= 3 && row.mapFrames >= 3 && row.together === 0 && row.overlapFrames === 0 && row.mapBeforeCardEnd === false && row.errors.length === 0;
      rows.push(row);
      console.log(`${String(W + 'x' + H).padEnd(9)} 동작줄이기=${reduced ? '켬' : '끔'} 시작 화면=${row.modeAtStart} · 카드 ${row.cardFrames}프레임(${row.cardFrom}~${row.cardTo}ms) · 지도 ${row.mapFrames}프레임(${row.mapFrom}~${row.mapTo}ms) · 함께 ${row.together} · 겹침 ${row.overlapFrames}${row.worstOverlap ? ' (최대 ' + row.worstOverlap + ')' : ''}${row.ok ? '' : '  ✗'}`);
      await browser.close();
    }
  }
  const bad = rows.filter((r) => !r.ok);
  console.log(bad.length ? `CARDMAP FAIL: ${bad.length}/${rows.length}칸` : `CARDMAP PASS: ${rows.length}/${rows.length}칸 — 카드와 지도가 함께 뜨지 않는다`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ rows, pass: bad.length === 0, errors: bad.length ? ['cardmap fail ' + bad.length] : [] }, null, 1));
  process.exit(bad.length ? 1 : 0);
})();

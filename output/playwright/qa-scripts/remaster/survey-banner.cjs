'use strict';
/*
 * 시련 안내 띠(#trial-banner) 넘침 전수 측정 (RM7).
 *   8개 해역 × 5문 = 문항 40개를 차례로 그려 보고, 화면 × 글자 배율마다 안내 띠가 스크롤되는지(scrollHeight - clientHeight > 2)를 잰다.
 *   기호 짝맞추기는 안내 띠가 아니라 패널로 그려지므로 같이 돈다(넘침 없음이 정상).
 *
 * 사용(예):
 *   BASE_URL=http://127.0.0.1:8766 node survey-banner.cjs                                  기본: 화면 7종 × 배율 1·1.15·1.3 × 해역 8개
 *   node survey-banner.cjs 320x568,844x390 1,1.3 0,3 결과.json                              화면 · 배율 · 해역 · 결과 파일(선택)
 * 환경변수: BASE_URL(기본 게임 폴더 서버), CSS_FILE(이 CSS를 페이지에 덧붙여 후보 규칙을 빌드 없이 시험한다)
 * 출력: 칸(화면·배율)마다 한 줄 — n(문항 수) · bad(넘친 수) · maxOver(최대 넘친 px) · 종류별 · 가장 나쁜 문항 · 겹침(띠 안의 칸끼리 2px 넘게 파고든 문항 수와 최대 px, RM8에서 더함)
 */
const fs = require('fs');
const { open } = require('./lib.cjs');

const VIEWS = (process.argv[2] || '320x568,360x640,375x812,390x844,844x390,768x1024,1440x900').split(',').map((s) => s.split('x').map(Number));
const SCALES = (process.argv[3] || '1,1.15,1.3').split(',').map(Number);
const REGIONS = (process.argv[4] || '0,1,2,3,4,5,6,7').split(',').map(Number);
const OUT = process.argv[5] || '';

(async () => {
  const { browser, page } = await open({ query: '?qa=1', width: 1280, height: 720 });
  await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
  await page.click('#start-sailing');
  await page.waitForTimeout(1200);
  const rows = [];
  if (process.env.CSS_FILE) {
    const css = fs.readFileSync(process.env.CSS_FILE, 'utf8');
    await page.evaluate((css) => { const s = document.createElement('style'); s.id = 'cand-css'; s.textContent = css; document.head.append(s); }, css);
  }
  for (const region of REGIONS) {
    const ok = await page.evaluate((r) => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
      try {
        g.applyReducedMotion(true); g.audio.setMuted(true); a.hudQa.setQuiet(false); a.hudQa.noTransition(true);
        document.getElementById('qa-hud').style.display = 'none';
        a.questQa.prepare(r); g.applyReducedMotion(true); a.hudQa.setQuiet(false);
        g.startRegionTrial(r);
        return !!g.trialSet;
      } catch (e) { return String(e); }
    }, region);
    if (ok !== true) { console.log('region', region, 'skip', ok); continue; }
    for (const [W, H] of VIEWS) {
      await page.setViewportSize({ width: W, height: H });
      for (const scale of SCALES) {
        const res = await page.evaluate((scale) => {
          document.documentElement.style.setProperty('--text-scale', scale);
          document.documentElement.dataset.textScale = String(scale);
          const g = window.__OCEAN_GAME__, out = [], qs = g.trialSet.questions;
          for (let i = 0; i < qs.length; i++) {
            g.trialSession.index = i; g.resetTrialRuntime(); g.renderTrialProblem();
            const b = document.getElementById('trial-banner');
            if (!b || b.hidden || getComputedStyle(b).display === 'none') { out.push({ i, type: qs[i].type, skip: true }); continue; }
            const cs = getComputedStyle(b), br = b.getBoundingClientRect();
            let bottom = 0;
            for (const c of b.children) {
              const r = c.getBoundingClientRect(), s = getComputedStyle(c);
              if (r.height && s.display !== 'none') bottom = Math.max(bottom, r.bottom + (parseFloat(s.marginBottom) || 0));
            }
            // 보이는 자식끼리의 겹침: 글자 칸(문장·보조 문구·진행 안내)과 장식 파형이 서로 파고드는 가장 큰 높이(px)
            const kids = [];
            for (const c of b.children) {
              const s = getComputedStyle(c), r = c.getBoundingClientRect();
              if (c.hidden || s.display === 'none' || s.visibility === 'hidden' || r.width < 2 || r.height < 2) continue;
              kids.push({ id: c.id || c.className, r });
            }
            let ovl = 0, ovlPair = '';
            for (let a = 0; a < kids.length; a++) for (let z = a + 1; z < kids.length; z++) {
              const w = Math.min(kids[a].r.right, kids[z].r.right) - Math.max(kids[a].r.left, kids[z].r.left);
              const h = Math.min(kids[a].r.bottom, kids[z].r.bottom) - Math.max(kids[a].r.top, kids[z].r.top);
              if (w > 2 && h > 2 && h > ovl) { ovl = Math.round(h); ovlPair = kids[a].id + ' × ' + kids[z].id; }
            }
            out.push({
              i, type: qs[i].type, ovl, ovlPair, over: b.scrollHeight - b.clientHeight, h: Math.round(br.height), maxH: cs.maxHeight,
              need: Math.round(bottom - br.top + parseFloat(cs.paddingBottom)),
              plen: (document.getElementById('trial-prompt').textContent || '').length,
              flen: (document.getElementById('trial-fallback').textContent || '').length,
            });
          }
          return out;
        }, scale);
        for (const r of res) rows.push({ region, W, H, scale, ...r });
      }
    }
  }
  const sum = {};
  for (const r of rows) {
    if (r.skip) continue;
    const k = r.W + 'x' + r.H + ' s' + r.scale;
    const s = (sum[k] = sum[k] || { n: 0, bad: 0, maxOver: 0, worst: null, byType: {}, ovlBad: 0, maxOvl: 0, worstOvl: null });
    s.n++;
    if (r.over > 2) { s.bad++; s.byType[r.type] = (s.byType[r.type] || 0) + 1; }
    if (r.ovl > 2) { s.ovlBad++; if (r.ovl > s.maxOvl) { s.maxOvl = r.ovl; s.worstOvl = { region: r.region, i: r.i, type: r.type, pair: r.ovlPair, plen: r.plen, flen: r.flen }; } }
    if (r.over > s.maxOver) { s.maxOver = r.over; s.worst = { region: r.region, i: r.i, type: r.type, need: r.need, h: r.h, plen: r.plen, flen: r.flen }; }
  }
  let bad = 0, ovlBad = 0;
  for (const k of Object.keys(sum)) {
    bad += sum[k].bad; ovlBad += sum[k].ovlBad;
    console.log(k.padEnd(14), 'n=' + sum[k].n, 'bad=' + sum[k].bad, 'maxOver=' + sum[k].maxOver, JSON.stringify(sum[k].byType), sum[k].worst ? JSON.stringify(sum[k].worst) : '',
      sum[k].ovlBad ? ' | 겹침 ' + sum[k].ovlBad + '칸 최대 ' + sum[k].maxOvl + 'px ' + JSON.stringify(sum[k].worstOvl) : '');
  }
  const fail = bad + ovlBad;
  console.log(fail ? 'SURVEY FAIL: 넘친 칸 ' + bad + ' · 겹친 칸 ' + ovlBad : 'SURVEY PASS: 넘침·겹침 0건 (' + rows.filter((r) => !r.skip).length + '칸)');
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

'use strict';
/*
 * RM9 네트워크 감사 (설계서 10.4 RM-D02): 외부 origin 요청 1건, 문서 안의 절대 주소 문자열 1건.
 *   일반 주소, ?qa=1, ?test=1 세 가지로 열어 페이지가 보낸 모든 요청의 origin을 센다.
 *   three(r128) CDN 요청 1건만 바깥으로 나가야 한다(lib.cjs가 그 요청을 로컬 파일로 대신 답한다 — 요청 자체는 기록된다).
 *   문서 안 문자열은 두 곳에서 센다: 서버가 준 원본 index.html(1건이어야 한다), 그리고 로드·항해 시작 뒤의 documentElement.outerHTML.
 *   실행 중의 문서에는 게임이 동적으로 끼운 script 요소 때문에 주소 문자열이 더 나타난다(three CDN 주소가 script src로 한 번 더, GLTFLoader를 불러오는
 *   같은 출처 절대 주소 1건). 원본 V9도 똑같이 3건이다(대조: BASE_URL을 원본 폴더로 돌려 본다). 그래서 실행 중 문서는 "건수 1"이 아니라
 *   "모든 문자열이 three CDN 주소이거나 같은 출처 주소이고 3건 이하"로 본다. ?test=1은 THREE를 부르기 전에 검사를 돌려 외부 요청이 0건이다.
 *
 * 사용: BASE_URL=http://127.0.0.1:8767 node rm9-network.cjs [--out output/playwright/rm9-network.json]
 */
const fs = require('fs');
const path = require('path');
const { open, frames } = require('./lib.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; };
const OUT = arg('out', path.join('output', 'playwright', 'rm9-network.json'));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const BASE_ORIGIN = new URL(BASE).origin;
const ABS = /https?:\/\//g;

(async () => {
  const problems = [], rows = [];
  const check = (cond, message) => { if (!cond) problems.push(message); return cond; };

  // 서버가 내주는 원본 문서에서 센다
  const raw = await (await fetch(BASE + '/index.html')).text();
  const rawCount = (raw.match(ABS) || []).length;
  check(rawCount === 1, '원본 index.html 의 절대 주소 문자열이 1건이어야 한다 (' + rawCount + '건)');
  const rawLine = raw.split('\n').find((line) => /https?:\/\//.test(line));
  rows.push({ step: 'raw index.html', absoluteStrings: rawCount, line: rawLine ? rawLine.trim().slice(0, 160) : null });

  for (const query of ['', '?qa=1', '?test=1']) {
    const seen = [];
    const { browser, page, errors } = await open({
      query, width: 900, height: 600,
      before: async (pg) => { pg.on('request', (r) => seen.push({ url: r.url(), type: r.resourceType() })); },
    });
    try {
      if (query !== '?test=1') {
        await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 40000 });
        await page.click('#start-sailing');
        await page.waitForTimeout(2500);
        await frames(page, 6);
      } else {
        await page.waitForTimeout(6000);
      }
      const domUrls = await page.evaluate(() => (document.documentElement.outerHTML.match(/https?:\/\/[^\s"'<>)]+/g) || []));
      const inDom = domUrls.length;
      const CDN = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js$/;
      const domKinds = { cdn: domUrls.filter((u) => CDN.test(u)).length, sameOrigin: domUrls.filter((u) => u.startsWith(BASE_ORIGIN)).length };
      domKinds.other = inDom - domKinds.cdn - domKinds.sameOrigin;
      const origins = {};
      for (const r of seen) {
        if (r.url.startsWith('data:') || r.url.startsWith('blob:')) continue;
        const o = new URL(r.url).origin;
        (origins[o] = origins[o] || []).push(r.url.replace(o, '').slice(0, 80));
      }
      const external = Object.keys(origins).filter((o) => o !== BASE_ORIGIN);
      const label = query || '(일반)';
      rows.push({ step: label, requests: seen.length, origins: Object.fromEntries(Object.entries(origins).map(([o, list]) => [o, list.length])), external, domAbsoluteStrings: inDom, domKinds, errors: errors.length });
      // 일반·?qa=1은 three CDN 요청이 정확히 1건, ?test=1은 THREE를 부르기 전에 검사를 돌므로 0건(있다면 CDN 1건뿐)
      const wantExternal = query === '?test=1' ? external.length <= 1 : external.length === 1;
      check(wantExternal, label + ': 외부 origin 이 ' + (query === '?test=1' ? '1개 이하' : '1개') + '여야 한다 (' + external.join(', ') + ')');
      if (external.length === 1) check(/cdnjs\.cloudflare\.com$/.test(new URL(external[0]).host) && origins[external[0]].length === 1, label + ': 외부 요청은 CDN three 1건이어야 한다 (' + JSON.stringify(origins[external[0]]) + ')');
      if (query === '?test=1') check(inDom === 1, label + ': 검사 주소의 문서 안 절대 주소 문자열이 1건이어야 한다 (' + inDom + '건)');
      else check(domKinds.other === 0 && inDom <= 3, label + ': 실행 중 문서의 주소 문자열은 three CDN 또는 같은 출처뿐이고 3건 이하여야 한다 (' + JSON.stringify(domKinds) + ')');
      check(errors.length === 0, label + ': 콘솔 오류 없음 ' + errors.slice(0, 2).join(' | '));
    } finally {
      await browser.close();
    }
  }

  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ problems, rows }, null, 1));
  rows.forEach((r) => console.log(JSON.stringify(r)));
  problems.slice(0, 12).forEach((m) => console.log('  -', m));
  console.log(problems.length === 0 ? 'NETWORK PASS' : 'NETWORK FAIL');
  process.exit(problems.length === 0 ? 0 : 1);
})().catch((e) => { console.log('NETWORK ERROR', String((e && e.stack) || e).slice(0, 800)); process.exit(2); });

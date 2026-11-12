'use strict';
// 전체 검사(?test=1)를 돌리고 스위트별 집계와 실패 목록(실제값·기대값 포함)을 출력한다.
const { open } = require('./lib.cjs');
(async () => {
  const { browser, page, errors } = await open({ query: '?test=1' });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const res = window.__OCEAN_API__.runAllTests();
    const out = { totals: res.totals, suites: res.suites.map((s) => ({ name: s.name, kind: s.kind, pass: s.pass, fail: s.fail })), fails: [] };
    res.suites.forEach((s) => s.tests.filter((t) => !t.ok).forEach((t) => out.fails.push({ suite: s.name, name: t.name, error: t.error, actual: t.actual, expected: t.expected })));
    return out;
  });
  let total = 0, pass = 0;
  for (const [k, v] of Object.entries(r.totals)) { total += v.pass + v.fail; pass += v.pass; console.log(k.padEnd(14), `${v.pass}/${v.pass + v.fail}`); }
  console.log(`TOTAL ${pass}/${total}`);
  if (process.env.SHOW_SUITES) r.suites.forEach((s) => console.log('  ', s.kind.padEnd(13), `${s.pass}/${s.pass + s.fail}`, s.name));
  if (r.fails.length) console.log('FAILS', JSON.stringify(r.fails, null, 1));
  console.log('console errors', JSON.stringify(errors.slice(0, 6)));
  await browser.close();
  process.exit(pass === total && !errors.length ? 0 : 1);
})();

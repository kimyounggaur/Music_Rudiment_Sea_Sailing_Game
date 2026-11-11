'use strict';
/*
 * 오디오·화면 동기 오차(audioVisualSync) 비교: 같은 조건에서 두 빌드를 재서 새 빌드가 나빠지지 않았는지 본다.
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm5-sync.cjs --file index.html [--seconds 40] [--region 2]
 * (헤드리스 소프트웨어 렌더라 절대 값은 실기기보다 크다. 같은 환경의 두 빌드 비교용이다.)
 */
const { chromium, GL_ARGS, THREE_JS, BASE_URL, frames } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const file = arg('file', 'index.html'), seconds = Number(arg('seconds', '40')), region = Number(arg('region', '2'));
(async () => {
  const browser = await chromium.launch({ args: GL_ARGS });
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://cdnjs.cloudflare.com/**', (route) => route.fulfill({ path: THREE_JS, contentType: 'application/javascript' }));
  await page.goto(`${BASE_URL}/${file}?qa=1`, { waitUntil: 'load' });
  await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
  await page.click('#start-sailing');
  await page.waitForTimeout(1500);
  const START = { 0: [0, -430, 0.57], 1: [-10, -262, -0.49], 2: [195, -205, 0.2], 5: [-96, 172, 0.25] }[region];
  await page.evaluate(({ START }) => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    g.audio.setMuted(true);
    a.questQa.prepare(1);
    g.motion.x = START[0]; g.motion.z = START[1]; g.motion.heading = START[2]; g.motion.speed = 0;
    if (g.atmosphere) g.atmosphere.refresh(g.simTime, START[0], START[1]);
    const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
  }, { START });
  const t0 = Date.now(), rows = [];
  while (Date.now() - t0 < seconds * 1000) {
    await page.waitForTimeout(5000);
    rows.push(await page.evaluate(() => { const g = window.__OCEAN_GAME__, s = g.audio.stats ? g.audio.stats() : {}; return { ctx: g.audio.context ? g.audio.context.state : 'none', sync: { ...g.audioVisualSync }, desired: s.desiredState, sim: +g.simTime.toFixed(2) }; }));
  }
  const last = rows[rows.length - 1];
  console.log(JSON.stringify({ file, region, seconds, last, errors: errors.slice(0, 3) }));
  await browser.close();
})();

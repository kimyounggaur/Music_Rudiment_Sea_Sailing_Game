'use strict';
/*
 * GRM5 톤 원인 분리: 폭풍(해역 2)·오로라(해역 7)의 화면 값(밝기·채도)을 조건별로 잰다. 두 빌드(--file)를 같은 조건에서 비교한다.
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm5-tone.cjs --file index.html|index.pre-rm5.html [--w 1440 --h 900]
 */
const { chromium, GL_ARGS, THREE_JS, BASE_URL, frames, POINTS } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const file = arg('file', 'index.html'), W = Number(arg('w', '1440')), H = Number(arg('h', '900'));
const only = String(arg('only', 'storm,aurora')).split(',');
(async () => {
  const browser = await chromium.launch({ args: GL_ARGS });
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://cdnjs.cloudflare.com/**', (route) => route.fulfill({ path: THREE_JS, contentType: 'application/javascript' }));
  await page.goto(`${BASE_URL}/${file}?qa=1`, { waitUntil: 'load' });
  await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
  await page.click('#start-sailing');
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    g.audio.setMuted(true); a.questQa.prepare(1); g.qaLightOuterLighthouses();
    if (g.remaster && g.remaster.start) await g.remaster.start();
    a.vfxQa.setTimeOfDay(0.25);
    const st = document.createElement('style'); st.textContent = '#qa-hud,.hud,#control-layer,.minimap-panel,#world-labels,#objective-chip,#help-strip,#game-toast,#caption-strip,#region-banner,#remaster-region-art,.collect-counter,.action-cluster,#effect-cue{display:none!important}'; document.head.appendChild(st);
  });
  const go = async (p) => {
    await page.evaluate(({ p }) => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
      g.motion.x = p.x; g.motion.z = p.z; g.motion.heading = p.h; g.motion.speed = 0; g.cameraDrag.yaw = 0; g.cameraDrag.pitch = 0.34;
      if (a.cameraQa) { a.cameraQa.snap(); a.cameraQa.noteInput(); }
      g.atmosphere.refresh(g.simTime, p.x, p.z);
      if (a.remasterQa.setLit) a.remasterQa.setLit(1);
      a.vfxQa.settle();
      if (g.currentTerm) g.closeTermCard();
    }, { p });
    await frames(page, 8);
  };
  const tone = () => page.evaluate(() => window.__OCEAN_API__.remasterQa.tone());
  const out = { file, W, H };
  if (only.includes('storm')) {
    // 폭풍: (a) 소리 진행 멈춤(큐·번개 없음), (b) 소리 진행 중
    const storm = POINTS[2];
    await page.evaluate(() => window.__OCEAN_API__.audioQa.stop());
    await go(storm);
    out.stormQuiet = await tone();
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.effects.lightningStrength = 0; });
    out.stormQuiet2 = await tone();
    await page.evaluate(() => window.__OCEAN_API__.audioQa.resume());
    await frames(page, 6);
    const samples = [];
    for (let i = 0; i < 4; i++) { await frames(page, 3); samples.push(await tone()); }
    out.stormBeats = samples;
    const fl = await page.evaluate(() => { const g = window.__OCEAN_GAME__; return { strength: +g.effects.lightningStrength.toFixed(2), flashes: g.effects.flashes ? { ...g.effects.flashes } : null, overlay: document.getElementById('lightning-flash') ? document.getElementById('lightning-flash').style.opacity : null }; });
    out.stormFlashState = fl;
  }
  if (only.includes('aurora')) {
    // 오로라: 소리 멈춤 + 색상 고정. 새 빌드는 오로라 색상을 조성에서 읽으므로 0~11 스윕, 옛 빌드는 한 값
    const aur = POINTS[7];
    await page.evaluate(() => window.__OCEAN_API__.audioQa.stop());
    await go(aur);
    out.auroraBase = await tone();
    const hasHue = await page.evaluate(() => Boolean(window.__OCEAN_GAME__.atmosphere && window.__OCEAN_GAME__.atmosphere.setMusic));
    if (hasHue) {
      const sweep = [];
      for (let i = 0; i < 12; i++) {
        await page.evaluate((i) => {
          const g = window.__OCEAN_GAME__;
          g.effects.followMusicContext = () => null; // 연속 경로가 값을 덮지 않게(촬영 전용)
          g.atmosphere.music.hue = g.atmosphere.music.hueGoal = (i * Math.PI) / 6; // 평활 없이 바로 맞춘다
        }, i);
        await frames(page, 6);
        sweep.push({ hue: i, ...(await tone()) });
      }
      out.auroraSweep = sweep;
      out.auroraNow = await page.evaluate(() => window.__OCEAN_GAME__.atmosphere.snapshot().music);
    }
  }
  console.log(JSON.stringify({ ...out, errors: errors.slice(0, 3) }, null, 1));
  await browser.close();
})();

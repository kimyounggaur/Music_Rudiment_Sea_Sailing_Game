'use strict';
/*
 * RM3: 반사·후처리 추가 비용 비교(참고용).
 *   node perf-rm3.cjs [--w 640 --h 360 --frames 60]
 * 같은 지점(0번 항구)·같은 해상도에서 프레임 간격을 잰다. 조합: 옛 경로 mid / 새 경로 mid(off·lite·full) / low(auto) / high(full).
 * 주의: 헤드리스 소프트웨어 렌더(SwiftShader)라 픽셀 셰이더 비용이 CPU 시간으로 그대로 나온다. 실제 GPU 프레임 속도가 아니며 합격 판정에 쓰지 않는다.
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const W = Number(arg('w', '640')), H = Number(arg('h', '360')), N = Number(arg('frames', '60'));
const CASES = [
  { path: 'legacy', quality: 'mid', fx: 'auto' },
  { path: 'remaster', quality: 'mid', fx: 'off' },
  { path: 'remaster', quality: 'mid', fx: 'lite' },
  { path: 'remaster', quality: 'mid', fx: 'full' },
  { path: 'remaster', quality: 'low', fx: 'auto' },
  { path: 'remaster', quality: 'high', fx: 'full' },
];
(async () => {
  const rows = [];
  for (const c of CASES) {
    const { browser, page, errors } = await open({ width: W, height: H, query: c.path === 'legacy' ? '?qa=1&legacy=1' : '?qa=1' });
    await startSailing(page);
    await page.evaluate(({ q, fx, legacy }) => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
      g.audio.setMuted(true); g.applyQualityProfile(q, false);
      if (!legacy) a.remasterQa.setFx(fx);
      const hud = document.getElementById('qa-hud'); if (hud) hud.style.display = 'none';
    }, { q: c.quality, fx: c.fx, legacy: c.path === 'legacy' });
    await teleport(page, POINTS[0], { settle: 24 });
    const result = await page.evaluate(async (N) => {
      const g = window.__OCEAN_GAME__, times = [];
      let last = performance.now();
      await new Promise((res) => { let n = 0; const f = () => { const now = performance.now(); times.push(now - last); last = now; if (++n >= N) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      times.shift(); times.sort((a, b) => a - b);
      const mean = times.reduce((a, b) => a + b, 0) / times.length, s = g.renderStats.snapshot();
      return { meanMs: +mean.toFixed(1), p50Ms: +times[Math.floor(times.length * 0.5)].toFixed(1), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(1), calls: { shadow: s.shadow.calls, reflection: s.reflection.calls, main: s.main.calls, post: s.post.calls }, tris: s.total.triangles, programs: g.renderer.info.programs.length };
    }, N);
    rows.push({ ...c, ...result, errors: errors.length });
    console.log(JSON.stringify(rows[rows.length - 1]));
    await browser.close();
  }
  fs.writeFileSync(outPath('rm3-perf.json'), JSON.stringify({ note: 'SwiftShader software rendering; not real GPU frame rate', size: [W, H], frames: N, rows }, null, 1));
})();

'use strict';
/*
 * RM2: 수면 교체 전후의 비용 비교(참고용).
 *   node perf-water.cjs [--w 640 --h 360 --frames 80] [--qualities low,mid,high]
 * - 옛 경로(?legacy=1)와 새 경로를 같은 지점·같은 해상도에서 돌려 프레임 간격을 잰다.
 * - computeVertexNormals 호출 수·시간(자바스크립트 쪽 비용)도 센다.
 * 주의: 헤드리스 소프트웨어 렌더(SwiftShader)라 픽셀 셰이더 비용이 CPU 시간으로 그대로 나온다.
 *       실제 GPU 프레임 속도가 아니며 합격 판정에 쓰지 않는다.
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const W = Number(arg('w', '640')), H = Number(arg('h', '360')), N = Number(arg('frames', '80'));
const qualities = arg('qualities', 'low,mid,high').split(',');
(async () => {
  const rows = [];
  for (const legacy of [true, false]) {
    for (const quality of qualities) {
      const { browser, page, errors } = await open({ width: W, height: H, query: legacy ? '?qa=1&legacy=1' : '?qa=1' });
      await startSailing(page);
      await page.evaluate((q) => { const g = window.__OCEAN_GAME__; g.audio.setMuted(true); g.applyQualityProfile(q, false); const hud = document.getElementById('qa-hud'); if (hud) hud.style.display = 'none'; }, quality);
      await teleport(page, POINTS[0], { settle: 24 });
      const result = await page.evaluate(async (N) => {
        const g = window.__OCEAN_GAME__, geom = () => g.world.ocean.geometry;
        let calls = 0, spent = 0;
        const wrap = (geometry) => { if (geometry.__wrapped) return; const orig = geometry.computeVertexNormals.bind(geometry); geometry.computeVertexNormals = () => { const t = performance.now(); orig(); spent += performance.now() - t; calls++; }; geometry.__wrapped = true; };
        wrap(geom());
        const times = [];
        let last = performance.now();
        await new Promise((res) => { let n = 0; const f = () => { const now = performance.now(); times.push(now - last); last = now; wrap(geom()); if (++n >= N) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
        times.shift();
        times.sort((a, b) => a - b);
        const mean = times.reduce((a, b) => a + b, 0) / times.length;
        const r = g.renderer.info;
        return { meanMs: +mean.toFixed(1), p50Ms: +times[Math.floor(times.length * 0.5)].toFixed(1), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(1), normalsCalls: calls, normalsMsPerFrame: +(spent / times.length).toFixed(3), drawCalls: r.render.calls, programs: r.programs.length, oceanSegments: g.world.ocean.userData.segments };
      }, N);
      rows.push({ path: legacy ? 'legacy' : 'remaster', quality, ...result, errors: errors.length });
      console.log(JSON.stringify(rows[rows.length - 1]));
      await browser.close();
    }
  }
  fs.writeFileSync(outPath('rm2-perf-water.json'), JSON.stringify({ note: 'SwiftShader software rendering; not real GPU frame rate', size: [W, H], frames: N, rows }, null, 1));
})();

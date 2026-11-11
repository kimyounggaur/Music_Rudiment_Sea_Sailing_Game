'use strict';
/*
 * RM1 해역 경계 연속성 검사.
 *  1) 해석: 이웃한 해역 중심을 잇는 직선을 1 단위 간격으로 따라가며(스냅) 안개·하늘·주광·k의 단계별 변화를 잰다.
 *  2) 화면: 직선의 경계 구간에서 10개 지점을 이어 캡처하고 하늘 띠 평균색의 프레임 간 변화를 잰다.
 *   node continuity.cjs [--shots 1] [--pairs 0-1,1-2,...]
 */
const fs = require('fs');
const path = require('path');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const shots = arg('shots', '1') === '1';
const pairs = arg('pairs', '0-1,1-2,2-3,3-4,4-5,5-6,6-7,7-1,1-8,5-8').split(',').map((p) => p.split('-').map(Number));
(async () => {
  const { browser, page, errors } = await open({ width: 640, height: 360 });
  await startSailing(page);
  const analytic = await page.evaluate((pairs) => {
    const g = window.__OCEAN_GAME__, a = g.atmosphere, regions = [[0,-430],[0,-260],[203,-162],[253,58],[113,234],[-113,234],[-253,58],[-203,-162],[0,0]];
    const read = () => {
      const v = a.value, u = a.skyMaterial.uniforms, o = a.out;
      return {
        fog: [g.world.scene.fog.color.r, g.world.scene.fog.color.g, g.world.scene.fog.color.b],
        top: u.uTop.value.toArray(), mid: u.uMid.value.toArray(), hor: u.uHor.value.toArray(),
        sun: u.uSunDir.value.toArray(), fogD: [o.fogD], k: [o.k], hemiI: [o.hemiI], sunI: [o.sunI],
        sunCol: g.world.sunlight.color.toArray(), hemiSky: g.world.hemisphere.color.toArray(),
      };
    };
    // 필드별 전역 범위(정규화 기준): 해역 중심 9곳의 값
    const lo = {}, hi = {};
    regions.forEach(([x, z]) => { a.refresh(g.simTime, x, z); const r = read(); for (const key in r) r[key].forEach((val, i) => { const id = key + i; lo[id] = Math.min(lo[id] ?? 9, val); hi[id] = Math.max(hi[id] ?? -9, val); }); });
    const rows = [];
    for (const [i, j] of pairs) {
      const [x0, z0] = regions[i], [x1, z1] = regions[j], len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len);
      let prev = null, worst = 0, worstKey = '', worstAt = 0;
      for (let s = 0; s <= n; s++) {
        const t = s / n; a.refresh(g.simTime, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
        const r = read();
        if (prev) for (const key in r) r[key].forEach((val, idx) => { const id = key + idx, range = Math.max(1e-6, hi[id] - lo[id]); const d = Math.abs(val - prev[key][idx]) / range * (len / n); if (d > worst) { worst = d; worstKey = id; worstAt = s; } });
        prev = r;
      }
      rows.push({ pair: i + '-' + j, length: Math.round(len), maxStepFracOfRange: +worst.toFixed(4), field: worstKey, at: worstAt });
    }
    return rows;
  }, pairs);
  console.log(JSON.stringify(analytic));
  // 항해 시뮬레이션: 60fps·12칸/초로 직선을 따라가며 화면에 쓰이는 값(평활 후)의 프레임당 변화를 잰다
  const sailing = await page.evaluate((pairs) => {
    const g = window.__OCEAN_GAME__, a = g.atmosphere, regions = [[0,-430],[0,-260],[203,-162],[253,58],[113,234],[-113,234],[-253,58],[-203,-162],[0,0]];
    const read = () => { const u = a.skyMaterial.uniforms, o = a.out; return { fog: g.world.scene.fog.color.toArray(), top: u.uTop.value.toArray(), mid: u.uMid.value.toArray(), hor: u.uHor.value.toArray(), sun: u.uSunDir.value.toArray(), fogD: [o.fogD], k: [o.k], hemiI: [o.hemiI], sunI: [o.sunI], sunCol: g.world.sunlight.color.toArray(), hemiSky: g.world.hemisphere.color.toArray() }; };
    const lo = {}, hi = {};
    regions.forEach(([x, z]) => { a.refresh(g.simTime, x, z); const r = read(); for (const key in r) r[key].forEach((val, i) => { const id = key + i; lo[id] = Math.min(lo[id] ?? 9, val); hi[id] = Math.max(hi[id] ?? -9, val); }); });
    const rows = [], dt = 1 / 60, speed = 12;
    for (const [i, j] of pairs) {
      const [x0, z0] = regions[i], [x1, z1] = regions[j], len = Math.hypot(x1 - x0, z1 - z0), frames = Math.ceil(len / (speed * dt));
      a.refresh(g.simTime, x0, z0); let prev = read(), worst = 0, worstKey = '', sim = g.simTime, sunDeg = 0, maxSunDeg = 0, prevSun = a.sunDir.clone();
      for (let f = 1; f <= frames; f++) {
        const t = f / frames; sim += dt; a.update(dt, sim, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
        const r = read();
        for (const key in r) r[key].forEach((val, idx) => { const id = key + idx, range = Math.max(1e-6, hi[id] - lo[id]); const d = Math.abs(val - prev[key][idx]) / range; if (d > worst) { worst = d; worstKey = id; } });
        sunDeg = Math.acos(Math.min(1, prevSun.dot(a.sunDir))) * 57.2958; maxSunDeg = Math.max(maxSunDeg, sunDeg); prevSun.copy(a.sunDir);
        prev = r;
      }
      rows.push({ pair: i + '-' + j, frames, maxFrameStepFracOfRange: +worst.toFixed(4), field: worstKey, maxSunDegPerFrame: +maxSunDeg.toFixed(3), maxSunDegPerSec: +(maxSunDeg * 60).toFixed(1) });
    }
    a.refresh(g.simTime, g.motion.x, g.motion.z);
    return rows;
  }, pairs);
  console.log(JSON.stringify(sailing));
  const out = { analytic, sailing, errors: errors.slice(0, 6) };
  if (shots) {
    // 화면: 경계 중점 ±45 구간을 10 걸음으로(스냅 없이 실제 평활 포함), 하늘 띠 평균색
    const frameSets = [];
    for (const [i, j] of [[0, 1], [4, 5], [2, 3]]) {
      const files = [];
      for (let s = 0; s < 10; s++) {
        const t = 0.5 + ((s - 4.5) / 9) * 0.4;
        await page.evaluate(({ i, j, t }) => {
          const g = window.__OCEAN_GAME__, regions = [[0,-430],[0,-260],[203,-162],[253,58],[113,234],[-113,234],[-253,58],[-203,-162],[0,0]];
          const [x0, z0] = regions[i], [x1, z1] = regions[j];
          g.motion.x = x0 + (x1 - x0) * t; g.motion.z = z0 + (z1 - z0) * t; g.motion.speed = 0;
          g.motion.heading = Math.atan2(x1 - x0, z1 - z0);
        }, { i, j, t });
        await frames(page, 2);
        const f = outPath(`rm1_cont_${i}-${j}_${String(s).padStart(2, '0')}.png`);
        await page.screenshot({ path: f });
        files.push(f);
      }
      frameSets.push({ pair: i + '-' + j, files });
    }
    out.frames = frameSets;
  }
  fs.writeFileSync(outPath('rm1-continuity.json'), JSON.stringify(out, null, 1));
  await browser.close();
})();

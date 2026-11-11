'use strict';
/*
 * RM8 섬광 빈도·세기 실측 (설계서 V8·8.8절·9장 RM8 #6).
 *   폭풍 해역(2)에서 번개 큐를 실제 연출 감독(VisualEffectDirector)과 실제 섬광 제한기에 먹여 60초(시뮬레이션)씩 기록한다.
 *   헤드리스 렌더가 느려 실시간 녹화로는 초당 몇 번을 셀 수 없으므로, 게임 루프를 세우고 시간(g.simTime)을 1/60초씩 직접 넘긴다.
 *   큐 간격은 느린 박자부터 터무니없이 빠른 박자(50ms)까지 쏟아부어 제한기가 막아 주는지 본다.
 *   재는 것: 허용된 섬광의 1초 창 최대 횟수(≤3), 하늘 섬광 최대(≤0.35, 동작 줄이기 ≤0.12), 점광원 최대(≤1.6, 동작 줄이기 ≤0.6), 화면 덮개 0.
 *   그리고 섬광 정점·직전의 화면을 한 장씩 찍어 화면에서 밝기가 크게 바뀐 면적(상대 휘도 10% 이상)을 잰다(--shots 1, 파이썬 PIL 필요).
 *
 * 사용: BASE_URL=http://127.0.0.1:8767 node rm8-flash.cjs [--seconds 60] [--out output/playwright/rm8-flash.json] [--shots 1]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { open, frames, outPath, POINTS } = require('./lib.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; };
const SECONDS = Number(arg('seconds', 60));
const OUT = arg('out', path.join('output', 'playwright', 'rm8-flash.json'));
const SHOTS = arg('shots', '1') === '1';
const PERIODS = [1000, 500, 333, 250, 150, 100, 50]; // 번개 큐 간격(ms)

// 페이지 안에서 한 시나리오를 돌린다. 반환: 지표 하나
const RUN = ({ period, seconds, reduced }) => {
  const g = window.__OCEAN_GAME__, fx = g.effects, dt = 1 / 60;
  g.applyReducedMotion(reduced);
  fx.flashLimiter.reset();
  fx.lightningStrength = 0;
  fx.flashes = { allowed: 0, suppressed: 0 };
  const overlayEl = document.getElementById('lightning-flash');
  const accepted = [];
  let peakFlash = 0, peakLight = 0, peakOverlay = 0, frames = 0, nextCue = 0.2, cues = 0;
  const t0 = g.simTime, steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    g.simTime = t0 + t;
    if (t >= nextCue) {
      const before = fx.flashes.allowed;
      fx.trigger('lightning');
      cues++;
      if (fx.flashes.allowed > before) accepted.push(t);
      nextCue += period / 1000;
    }
    fx.update(dt);
    const flash = g.atmosphere ? g.atmosphere.flash : 0, light = fx.lightningLight.intensity, overlay = overlayEl ? Number(overlayEl.style.opacity || 0) : 0;
    if (flash > peakFlash) peakFlash = flash;
    if (light > peakLight) peakLight = light;
    if (overlay > peakOverlay) peakOverlay = overlay;
    frames++;
  }
  // 허용된 섬광의 1초 창 최대 횟수(창은 [t, t+1))
  let maxPerSecond = 0;
  for (let i = 0; i < accepted.length; i++) {
    let n = 0;
    for (let j = i; j < accepted.length && accepted[j] < accepted[i] + 1; j++) n++;
    if (n > maxPerSecond) maxPerSecond = n;
  }
  const out = { period, reduced, seconds, frames, cues, allowed: fx.flashes.allowed, suppressed: fx.flashes.suppressed, maxPerSecond, peakFlash: +peakFlash.toFixed(4), peakLight: +peakLight.toFixed(4), peakOverlay: +peakOverlay.toFixed(4) };
  fx.lightningStrength = 0; fx.update(dt); // 끝내고 꺼 둔다
  return out;
};

(async () => {
  const { browser, page, errors } = await open({ query: '?qa=1', width: 1440, height: 900 });
  const rows = [], problems = [];
  const check = (cond, message) => { if (!cond) problems.push(message); return cond; };
  try {
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.click('#start-sailing');
    await page.waitForTimeout(1500);
    const p = POINTS[2];
    await page.evaluate(({ p }) => {
      const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
      a.questQa.prepare(1); g.audio.setMuted(true);
      const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
      g.motion.x = p.x; g.motion.z = p.z; g.motion.heading = p.h; g.motion.speed = 0;
      if (g.atmosphere) g.atmosphere.refresh(g.simTime, p.x, p.z);
      if (a.cameraQa) { a.cameraQa.snap(); a.cameraQa.noteInput(); }
    }, { p });
    await frames(page, 6);
    const region = await page.evaluate(() => window.__OCEAN_GAME__.currentRegion);
    const legacy = await page.evaluate(() => Boolean(window.__OCEAN_GAME__.renderPath && window.__OCEAN_GAME__.renderPath.legacy));
    check(legacy === false, '리마스터 경로에서 재야 한다');
    // 게임 루프를 세워 시간을 직접 넘긴다
    await page.evaluate(() => window.__OCEAN_GAME__.stop());
    for (const reduced of [false, true]) {
      for (const period of PERIODS) {
        const r = await page.evaluate(RUN, { period, seconds: SECONDS, reduced });
        rows.push(r);
        console.log(`${reduced ? '동작 줄이기' : '기본      '} 큐 ${String(period).padStart(4)}ms: 큐 ${r.cues} → 허용 ${r.allowed}·막음 ${r.suppressed} · 1초 최대 ${r.maxPerSecond} · 섬광 ${r.peakFlash} · 점광원 ${r.peakLight} · 덮개 ${r.peakOverlay}`);
        check(r.maxPerSecond <= 3, `큐 ${period}ms${reduced ? '(동작 줄이기)' : ''}: 1초 최대 ${r.maxPerSecond} ≤ 3`);
        check(r.peakFlash <= (reduced ? 0.12 : 0.35) + 1e-6, `큐 ${period}ms${reduced ? '(동작 줄이기)' : ''}: 하늘 섬광 ${r.peakFlash} ≤ ${reduced ? 0.12 : 0.35}`);
        check(r.peakLight <= (reduced ? 0.6 : 1.6) + 1e-6, `큐 ${period}ms${reduced ? '(동작 줄이기)' : ''}: 점광원 ${r.peakLight} ≤ ${reduced ? 0.6 : 1.6}`);
        check(r.peakOverlay === 0, `큐 ${period}ms${reduced ? '(동작 줄이기)' : ''}: 화면 덮개 ${r.peakOverlay} = 0`);
        check(r.allowed + r.suppressed === r.cues, `큐 ${period}ms: 허용+막음 = 큐 수 (${r.allowed}+${r.suppressed} vs ${r.cues})`);
      }
    }
    // 한 번 번쩍일 때 화면에서 밝기가 크게 바뀐 면적: 직전(섬광 0)과 정점(상한)을 한 장씩
    const shots = [];
    if (SHOTS) {
      for (const reduced of [false, true]) {
        const peak = reduced ? 0.12 : 0.35;
        await page.evaluate(({ reduced }) => { const g = window.__OCEAN_GAME__; g.applyReducedMotion(reduced); g.effects.lightningStrength = 0; g.effects.update(1 / 60); g.atmosphere.setFlash(0); g.renderFrame(); }, { reduced });
        await frames(page, 2);
        const a = outPath('rm8', `flash_${reduced ? 'reduced' : 'normal'}_before.png`);
        await page.screenshot({ path: a });
        await page.evaluate(({ peak }) => { const g = window.__OCEAN_GAME__; g.atmosphere.setFlash(peak); g.renderFrame(); }, { peak });
        await frames(page, 2);
        const b = outPath('rm8', `flash_${reduced ? 'reduced' : 'normal'}_peak.png`);
        await page.screenshot({ path: b });
        await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.atmosphere.setFlash(0); g.renderFrame(); });
        shots.push({ reduced, before: a, peak: b });
      }
      // 시계가 멈춘 채라 frames()의 rAF는 돈다(게임 루프만 멈춤). 화면 비교는 파이썬으로.
      const py = `
import sys, json
from PIL import Image
import numpy as np
def lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lum(path):
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    r, g, b = lin(im[..., 0]), lin(im[..., 1]), lin(im[..., 2])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
out = []
for item in json.loads(sys.argv[1]):
    a, b = lum(item['before']), lum(item['peak'])
    d = np.abs(b - a)
    dark = np.minimum(a, b) < 0.8
    out.append({'reduced': item['reduced'], 'maxDelta': round(float(d.max()), 4), 'meanDelta': round(float(d.mean()), 5),
                'areaOver10pct': round(float(((d >= 0.10) & dark).mean()), 5), 'areaOver5pct': round(float(((d >= 0.05) & dark).mean()), 5),
                'areaOver2pct': round(float(((d >= 0.02) & dark).mean()), 5)})
print(json.dumps(out))
`;
      const res = spawnSync('python3', ['-I', '-c', py, JSON.stringify(shots)], { encoding: 'utf8' });
      if (res.status === 0) {
        const measured = JSON.parse(res.stdout.trim());
        measured.forEach((m) => { rows.push({ pixel: m }); console.log(`${m.reduced ? '동작 줄이기' : '기본      '} 정점 화면 변화: 최대 ΔL ${m.maxDelta} · 평균 ${m.meanDelta} · 면적(ΔL≥0.10) ${(m.areaOver10pct * 100).toFixed(2)}% · (≥0.05) ${(m.areaOver5pct * 100).toFixed(2)}% · (≥0.02) ${(m.areaOver2pct * 100).toFixed(2)}%`); });
        // 일반 섬광 한계: 상대 휘도 10% 이상 바뀐 면적이 화면의 약 11%(10도 시야 25%에 해당)를 넘지 않아야 초당 3회 규칙과 상관없이 안전. 우리는 3회 이하라 이 값은 참고다.
        measured.forEach((m) => check(m.areaOver10pct < 0.11, `${m.reduced ? '동작 줄이기' : '기본'}: ΔL≥0.10 면적 ${(m.areaOver10pct * 100).toFixed(2)}% < 11%`));
      } else { console.log('화면 비교를 못 했습니다(PIL/numpy 없음?):', (res.stderr || '').slice(0, 200)); rows.push({ pixel: null, note: 'PIL/numpy 없음' }); }
    }
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyReducedMotion(false); g.startLoop(); });
    const result = { seconds: SECONDS, region, periods: PERIODS, problems, errors, rows, shots };
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
    console.log('문제', problems.length, '오류', errors.length);
    problems.slice(0, 10).forEach((m) => console.log('  -', m));
    errors.slice(0, 4).forEach((e) => console.log('  !', e.slice(0, 200)));
    const ok = problems.length === 0 && errors.length === 0;
    console.log(ok ? 'FLASH PASS' : 'FLASH FAIL');
    await browser.close();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.log('FLASH ERROR', String((e && e.stack) || e).slice(0, 800));
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e), problems, rows, errors }, null, 1));
    await browser.close();
    process.exit(2);
  }
})();

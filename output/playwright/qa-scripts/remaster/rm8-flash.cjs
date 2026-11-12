'use strict';
/*
 * RM8 섬광 빈도·세기 실측 (설계서 V8·8.8절·9장 RM8 #6).
 *   폭풍 해역(2)에서 번개 큐를 실제 연출 감독(VisualEffectDirector)과 실제 섬광 제한기에 먹여 60초(시뮬레이션)씩 기록한다.
 *   헤드리스 렌더가 느려 실시간 녹화로는 초당 몇 번을 셀 수 없으므로, 게임 루프를 세우고 시간(g.simTime)을 1/60초씩 직접 넘긴다.
 *   큐 간격은 느린 박자부터 터무니없이 빠른 박자(50ms)까지 쏟아부어 제한기가 막아 주는지 본다.
 *   재는 것: 허용된 섬광의 1초 창 최대 횟수(≤3), 하늘 섬광 최대(≤0.35, 동작 줄이기 ≤0.12), 점광원 최대(≤1.6, 동작 줄이기 ≤0.6), 화면 덮개 0.
 *   그리고 섬광 정점·직전의 화면을 한 장씩 찍어 화면에서 밝기가 크게 바뀐 면적(상대 휘도 10% 이상)을 잰다(--shots 1, 파이썬 PIL 필요).
 *   1초 창은 반열린 구간 [t, t+1)이다(제한기와 시험 O-31의 정의: 1초가 지나면 첫 칸이 풀린다). 허용 시각은 제한기가 받은 시계로 적는다. 닫힌 창 [t, t+1]의 최대는 참고로만 남긴다.
 *   면적 지표는 WCAG 2.3.1의 두 번째 갈래("일반 섬광 한계 미만")다. 동작 줄이기에서는 합격 기준, 기본 모드에서는 참고값이다(기본은 "초당 3회 이하" 갈래로 만족).
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
  // 허용된 섬광의 시각은 제한기가 실제로 받은 시계로 적는다. 스크립트가 따로 센 시각(i/60)으로 세면 정확히 1.000초 간격(60프레임)에서
  // 부동소수점 오차(1e-14초)만큼 어긋나 "창 안/밖"이 뒤집힌다(처음 돌렸을 때 큐 333ms·100ms에서 4가 나온 원인).
  const lim = fx.flashLimiter, realAllow = lim.allow;
  lim.allow = function (now) { const ok = realAllow.call(this, now); if (ok) accepted.push(now); return ok; };
  let peakFlash = 0, peakLight = 0, peakOverlay = 0, frames = 0, nextCue = 0.2, cues = 0;
  const t0 = g.simTime, steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    g.simTime = t0 + t;
    if (t >= nextCue) {
      fx.trigger('lightning');
      cues++;
      nextCue += period / 1000;
    }
    fx.update(dt);
    const flash = g.atmosphere ? g.atmosphere.flash : 0, light = fx.lightningLight.intensity, overlay = overlayEl ? Number(overlayEl.style.opacity || 0) : 0;
    if (flash > peakFlash) peakFlash = flash;
    if (light > peakLight) peakLight = light;
    if (overlay > peakOverlay) peakOverlay = overlay;
    frames++;
  }
  delete lim.allow; // 원래 메서드로 되돌린다
  // 허용된 섬광의 1초 창 최대 횟수.
  //  - 반열린 창 [t, t+1): 제한기와 시험 O-31이 정의한 "초당 3회"(1초가 지나면 첫 칸이 풀린다). 합격 기준.
  //  - 닫힌 창 [t, t+1]: 참고. 큐가 프레임 격자에 정확히 맞으면(60프레임 뒤) 첫 섬광과 네 번째 섬광이 닫힌 창 양끝에 걸려 4가 된다.
  // 1e-6초 여유는 부동소수점 오차를 가르기 위한 것이다(프레임 간격 1/60초보다 훨씬 작다).
  const EPS = 1e-6;
  let maxPerSecond = 0, maxPerClosedSecond = 0;
  for (let i = 0; i < accepted.length; i++) {
    let n = 0, c = 0;
    for (let j = i; j < accepted.length; j++) {
      const d = accepted[j] - accepted[i];
      if (d > 1 + EPS) break;
      c++;
      if (d < 1 - EPS) n++;
    }
    if (n > maxPerSecond) maxPerSecond = n;
    if (c > maxPerClosedSecond) maxPerClosedSecond = c;
  }
  const out = { period, reduced, seconds, frames, cues, allowed: fx.flashes.allowed, suppressed: fx.flashes.suppressed, logged: accepted.length, maxPerSecond, maxPerClosedSecond, peakFlash: +peakFlash.toFixed(4), peakLight: +peakLight.toFixed(4), peakOverlay: +peakOverlay.toFixed(4) };
  fx.lightningStrength = 0; fx.update(dt); // 끝내고 꺼 둔다
  return out;
};

(async () => {
  const { browser, page, errors } = await open({ query: '?qa=1', width: 1440, height: 900 });
  const rows = [], problems = [];
  let checks = 0; const check = (cond, message) => { checks++; if (!cond) problems.push(message); return cond; };
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
        console.log(`${reduced ? '동작 줄이기' : '기본      '} 큐 ${String(period).padStart(4)}ms: 큐 ${r.cues} → 허용 ${r.allowed}·막음 ${r.suppressed} · 1초 최대 ${r.maxPerSecond}(닫힌 창 ${r.maxPerClosedSecond}) · 섬광 ${r.peakFlash} · 점광원 ${r.peakLight} · 덮개 ${r.peakOverlay}`);
        check(r.maxPerSecond <= 3, `큐 ${period}ms${reduced ? '(동작 줄이기)' : ''}: 1초 최대 ${r.maxPerSecond} ≤ 3`);
        check(r.peakFlash <= (reduced ? 0.12 : 0.35) + 1e-6, `큐 ${period}ms${reduced ? '(동작 줄이기)' : ''}: 하늘 섬광 ${r.peakFlash} ≤ ${reduced ? 0.12 : 0.35}`);
        check(r.peakLight <= (reduced ? 0.6 : 1.6) + 1e-6, `큐 ${period}ms${reduced ? '(동작 줄이기)' : ''}: 점광원 ${r.peakLight} ≤ ${reduced ? 0.6 : 1.6}`);
        check(r.peakOverlay === 0, `큐 ${period}ms${reduced ? '(동작 줄이기)' : ''}: 화면 덮개 ${r.peakOverlay} = 0`);
        check(r.logged === r.allowed, `큐 ${period}ms: 제한기가 받은 허용 기록(${r.logged})과 집계(${r.allowed})가 같다`);
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
        // 접근성 기준(WCAG 2.3.1 "세 번 이하의 섬광 또는 한계 미만")은 두 갈래 중 하나만 만족하면 된다:
        //   ① 어떤 1초에도 섬광이 3회 이하(위 큐 시험의 maxPerSecond ≤ 3, 모든 조건에서 합격 기준) 또는
        //   ② 일반 섬광 한계 미만: 상대 휘도 10% 이상 바뀐 면적이 화면의 약 11%(10도 시야의 25%) 미만.
        // 동작 줄이기는 ②도 만족해야 한다(섬광으로 세지 않는 수준이 설계 의도): 합격 기준.
        // 기본 모드는 ①로 통과한다. ②는 참고값으로 남기고, 한계를 넘으면 그 사실을 보고서에 그대로 적는다(아래 note).
        measured.forEach((m) => {
          const below = m.areaOver10pct < 0.11;
          m.belowGeneralFlashThreshold = below;
          m.note = below ? '일반 섬광 한계 미만' : '일반 섬광 한계(화면 약 11%) 초과 → 초당 3회 이하 제한(①)으로만 기준을 만족한다';
          if (m.reduced) check(below, `동작 줄이기: ΔL≥0.10 면적 ${(m.areaOver10pct * 100).toFixed(2)}% < 11%`);
          else console.log(`  참고(기본): ΔL≥0.10 면적 ${(m.areaOver10pct * 100).toFixed(2)}% ${below ? '< 11% (한계 미만)' : '≥ 11% (한계 초과 — ①초당 3회 이하로 만족)'}`);
        });
      } else { console.log('화면 비교를 못 했습니다(PIL/numpy 없음?):', (res.stderr || '').slice(0, 200)); rows.push({ pixel: null, note: 'PIL/numpy 없음' }); }
    }
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyReducedMotion(false); g.startLoop(); });
    const result = { checks, seconds: SECONDS, region, periods: PERIODS, problems, errors, rows, shots };
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

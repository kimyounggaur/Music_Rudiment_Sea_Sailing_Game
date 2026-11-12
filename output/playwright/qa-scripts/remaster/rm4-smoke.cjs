'use strict';
/*
 * RM4 실제 화면 확인 (카메라 디렉터 · 해역 표제 카드 · 타이틀 전환).
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm4-smoke.cjs [--only A,B,C,D,E]
 *   A 타이틀: 카메라 모드, 포스터→3D 전환(title-live), 장식 문구, 동작 줄이기 정지
 *   B 항해 시작: 해역 표제 카드 시간표(in/hold/out/done), 타이틀→조타 복귀
 *   C 조타 구도: 수평선 위치·배 폭 비율을 실제 투영으로 재고 설계 수치와 비교(16:9, 세로 화면)
 *   D 감상·발견: 감상 진입/복귀, 발견(FOV 49, 요 ≤ 8°)
 *   E 동작 줄이기: 감상 없음, 카메라 자동 움직임 0, 표제 카드 즉시 나타남·즉시 사라짐, 첫 방문 자동 지도
 * 결과는 output/playwright/rm4-smoke.json 에 합쳐 쓴다(--only 로 일부만 돌려도 이전 결과를 보존).
 * 주의: SwiftShader(소프트웨어 렌더)라 프레임이 느리다. 시간표는 performance.now 기준이라 영향이 없지만,
 *       카메라 수렴 속도(시뮬레이션 시간)는 느린 프레임에서 실제 기기와 다르다. 수렴 수치는 검사 O-24가 순수 함수로 확인한다.
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const only = String(arg('only', 'A,B,C,D,E')).split(',').map((s) => s.trim().toUpperCase());
const jsonPath = outPath('rm4-smoke.json');
let results = {};
try { results = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { results = {}; }
const save = () => fs.writeFileSync(jsonPath, JSON.stringify(results, null, 1));
const round = (v, n = 3) => (Number.isFinite(v) ? +v.toFixed(n) : v);

(async () => {
  // ------------------------------------------------------------------ A. 타이틀
  if (only.includes('A')) {
    const { browser, page, errors } = await open({ width: 1280, height: 720 });
    await page.waitForFunction(() => window.__OCEAN_GAME__ && window.__OCEAN_API__ && window.__OCEAN_API__.cameraQa, null, { timeout: 30000 });
    const timeline = [];
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      const row = await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, snap = window.__OCEAN_API__.cameraQa.snapshot();
        return { frame: g.frame, mode: snap && snap.mode, live: document.getElementById('title-overlay').classList.contains('title-live'), titleLive: Boolean(g.titleLive), state: window.__OCEAN_API__.getState ? window.__OCEAN_API__.getState() : null };
      });
      timeline.push({ ms: Date.now() - t0, ...row });
      if (row.live && i > 6) break;
      await page.waitForTimeout(80);
    }
    const firstLive = timeline.find((r) => r.live);
    const live = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, snap = window.__OCEAN_API__.cameraQa.snapshot();
      const mirror = document.querySelector('.title-mirror');
      const rel = (() => { const c = g.camera.position, m = g.motion; return { dist: Math.hypot(c.x - m.x, c.z - m.z), up: c.y - g.world.ship.position.y }; })();
      const cs = getComputedStyle(document.getElementById('title-overlay'));
      return { snap, mirror: mirror ? { ariaHidden: mirror.getAttribute('aria-hidden'), opacity: getComputedStyle(mirror).opacity, text: mirror.textContent.trim() } : null, rel, overlayBg: cs.backgroundColor, overlayTransition: cs.transitionProperty + ' ' + cs.transitionDuration, buttons: [...document.querySelectorAll('#title-overlay button')].map((b) => b.id || b.textContent.trim()).slice(0, 6) };
    });
    // 포스터(3D를 가린 상태)와 라이브 한 장씩
    await page.evaluate(() => { document.getElementById('title-overlay').classList.remove('title-live'); });
    await page.waitForTimeout(1100);
    await page.screenshot({ path: outPath('rm_RM4_title_poster_1280x720_after.png') });
    await page.evaluate(() => { document.getElementById('title-overlay').classList.add('title-live'); });
    await page.waitForTimeout(450);
    await page.screenshot({ path: outPath('rm_RM4_title_fade_mid_1280x720_after.png') });
    await page.waitForTimeout(900);
    await page.screenshot({ path: outPath('rm_RM4_title_live_1280x720_after.png') });
    // 타이틀 궤도: 시간에 따라 카메라가 배 둘레를 천천히 오간다(80초 주기). 배 뒤 방향 대비 각도 변화를 두 번 잰다.
    const orbit = [];
    for (let i = 0; i < 4; i++) {
      orbit.push(await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, c = g.camera.position, m = g.motion;
        return { sim: +g.simTime.toFixed(2), dist: +Math.hypot(c.x - m.x, c.z - m.z).toFixed(2), up: +(c.y - g.world.ship.position.y).toFixed(2), bearingDeg: +(((Math.atan2(-(c.x - m.x), -(c.z - m.z)) - m.heading) * 180) / Math.PI).toFixed(2) };
      }));
      await page.waitForTimeout(700);
    }
    // 동작 줄이기: 카메라 정지
    await page.evaluate(() => { window.__OCEAN_GAME__.applyReducedMotion(true); window.__OCEAN_API__.cameraQa.snap(); }); // 정지 상태로 수렴한 자세에서 재기 위해 바로 놓는다
    await frames(page, 4);
    const still = [];
    for (let i = 0; i < 6; i++) {
      still.push(await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, c = g.camera.position, m = g.motion;
        return { x: c.x - m.x, y: c.y - g.world.ship.position.y, z: c.z - m.z, shipY: g.world.ship.position.y };
      }));
      await page.waitForTimeout(250);
    }
    const spread = (k) => Math.max(...still.map((r) => r[k])) - Math.min(...still.map((r) => r[k]));
    const reduced = { dx: round(spread('x'), 4), dy: round(spread('y'), 4), dz: round(spread('z'), 4), shipYSpread: round(spread('shipY'), 4), mode: (await page.evaluate(() => window.__OCEAN_API__.cameraQa.snapshot())).mode };
    results.A = {
      firstLive: firstLive ? { ms: firstLive.ms, frame: firstLive.frame, mode: firstLive.mode } : null,
      timelineHead: timeline.slice(0, 5), live, orbit, reduced,
      ok: Boolean(firstLive) && firstLive.frame >= 3 && live.snap.mode === 'title' && live.mirror && live.mirror.ariaHidden === 'true' && Math.abs(live.rel.dist - 44) < 3 && live.rel.up > 4.5 && live.rel.up < 9.5 && reduced.dx < 0.02 && reduced.dz < 0.02 && reduced.dy < 0.2,
      errors: errors.slice(0, 5),
    };
    console.log('A', JSON.stringify(results.A));
    save();
    await browser.close();
  }

  // ------------------------------------------------------------------ B. 항해 시작: 해역 표제 카드
  if (only.includes('B')) {
    const { browser, page, errors } = await open({ width: 640, height: 360 });
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__OCEAN_GAME__.audio.setMuted(true); const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; });
    // 표본 수집기를 먼저 걸어 두고(클릭이 오래 걸려도 처음부터 잡히게) 항해를 시작한다
    await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, banner = document.getElementById('region-banner'), out = (window.__cardSamples = []), t0 = performance.now();
      window.__cardT0 = t0;
      const f = () => {
        const now = performance.now(), cs = getComputedStyle(banner);
        out.push({ at: Math.round(now - t0), sinceCard: g.ux.cardStart != null ? Math.round(now - g.ux.cardStart) : null, phase: banner.dataset.phase || null, hidden: banner.hidden, opacity: +Number(cs.opacity).toFixed(2), mode: window.__OCEAN_API__.cameraQa.snapshot().mode });
        if (now - t0 < 12000) requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    await page.click('#start-sailing');
    await page.waitForTimeout(7500);
    const samples = await page.evaluate(() => window.__cardSamples);
    const phases = {};
    for (const p of ['wait', 'in', 'hold', 'out']) { const s = samples.find((x) => x.phase === p && !x.hidden); phases[p] = s ? { at: s.at, sinceCard: s.sinceCard, opacity: s.opacity } : null; }
    const started = samples.find((x) => x.sinceCard !== null);
    const doneRow = samples.find((x) => x.phase === 'done' || (x.hidden && started && x.at > started.at + 300));
    const holdRows = samples.filter((x) => x.phase === 'hold');
    const lastHold = holdRows[holdRows.length - 1], firstOut = samples.find((x) => x.phase === 'out');
    const copy = await page.evaluate(() => { const b = document.getElementById('region-banner'); return { title: b.querySelector('strong').textContent, line: b.querySelector('small').textContent, mirror: b.querySelector('.region-mirror') ? b.querySelector('.region-mirror').getAttribute('aria-hidden') : null }; });
    const camModes = [...new Set(samples.map((s) => s.mode))];
    const camStart = await page.evaluate(() => window.__OCEAN_API__.cameraQa.snapshot());
    const peak = samples.reduce((m, s) => Math.max(m, s.opacity), 0);
    const frameGap = samples.length > 1 ? (samples[samples.length - 1].at - samples[0].at) / (samples.length - 1) : null;
    results.B = {
      phases, startedAt: started ? started.at : null, doneAt: doneRow ? { at: doneRow.at, sinceCard: doneRow.sinceCard } : null, lastHold: lastHold ? { sinceCard: lastHold.sinceCard } : null, firstOut: firstOut ? { sinceCard: firstOut.sinceCard } : null,
      peakOpacity: peak, copy, camModes, camStart, sampleCount: samples.length, frameGapMs: round(frameGap, 1),
      ok: Boolean(phases.in && phases.hold && phases.out) && Boolean(doneRow) && peak > 0.95 && camModes.includes('steer') && copy.line.indexOf('새 항로') < 0,
      errors: errors.slice(0, 5),
    };
    console.log('B', JSON.stringify(results.B));
    save();
    // 카드 보이는 한 장: 항해를 다시 시작해 hold 구간에서 촬영
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.returnToTitle && g.returnToTitle(); });
    await page.waitForTimeout(900);
    await page.click('#start-sailing');
    await page.waitForFunction(() => document.getElementById('region-banner').dataset.phase === 'hold', null, { timeout: 12000 });
    await page.screenshot({ path: outPath('rm_RM4_region_card_hold_1280x720_after.png') });
    await browser.close();
  }

  // ------------------------------------------------------------------ C. 조타 구도 실측
  if (only.includes('C')) {
    const { browser, page, errors } = await open({ width: 1280, height: 720 });
    await startSailing(page);
    await page.evaluate(() => { window.__OCEAN_GAME__.applyQualityProfile('mid', false); });
    // 지점 3(협곡: 정북 h=0, 파도 영향 작음)에서 측정한다. 배 폭 비율은 선체 메시의 월드 경계 상자를 화면에 투영해 잰다.
    const measure = (label) => page.evaluate((label) => {
      const g = window.__OCEAN_GAME__, T = window.THREE, cam = g.camera, ship = g.world.ship;
      cam.updateMatrixWorld(true); ship.updateMatrixWorld(true);
      const fwd = new T.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      const far = cam.position.clone().addScaledVector(fwd, 100000).project(cam); // 카메라 높이의 무한 먼 점 = 수평선
      const horizon = (1 - far.y) / 2;
      // 선체 윤곽: 선체·갑판 메시의 모든 정점을 화면에 투영해 좌우·상하 끝을 잰다(경계 상자 모서리는 가까운 쪽이 커 보여 과대평가된다)
      const xs = [], ys = [], v = new T.Vector3();
      ship.traverse((n) => {
        if (!n.isMesh || !(n.name === 'curved-loft-hull' || n.name === 'curved-main-deck')) return;
        const pos = n.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld).project(cam); xs.push((v.x + 1) / 2); ys.push((1 - v.y) / 2); }
      });
      const whole = new T.Box3().setFromObject(ship);
      const wc = [];
      for (const x of [whole.min.x, whole.max.x]) for (const y of [whole.min.y, whole.max.y]) for (const z of [whole.min.z, whole.max.z]) wc.push(new T.Vector3(x, y, z).project(cam));
      const wy = wc.map((c) => (1 - c.y) / 2);
      const m = g.motion, c = cam.position;
      return {
        label, aspect: +cam.aspect.toFixed(4), fov: +cam.fov.toFixed(2), mode: window.__OCEAN_API__.cameraQa.snapshot().mode,
        horizon: +horizon.toFixed(4), hullWidth: +(Math.max(...xs) - Math.min(...xs)).toFixed(4), hullCenterX: +((Math.max(...xs) + Math.min(...xs)) / 2).toFixed(4),
        hullTop: +Math.min(...ys).toFixed(4), hullBottom: +Math.max(...ys).toFixed(4), shipTop: +Math.min(...wy).toFixed(4),
        back: +Math.hypot(c.x - m.x, c.z - m.z).toFixed(2), up: +(c.y - ship.position.y).toFixed(2),
        design: window.__OCEAN_API__.cameraQa.composition(cam.aspect),
      };
    }, label);
    const rows = [];
    for (const [w, h, label] of [[1280, 720, '16:9'], [390, 844, '390x844'], [844, 390, '844x390'], [768, 1024, '768x1024']]) {
      await page.setViewportSize({ width: w, height: h });
      await teleport(page, POINTS[3], { settle: 14 });
      await frames(page, 6);
      await page.evaluate(() => window.__OCEAN_API__.cameraQa.noteInput());
      const r = await measure(label);
      rows.push(r);
      await page.screenshot({ path: outPath(`rm_RM4_steer_${w}x${h}_after.png`) });
    }
    const pick = (l) => rows.find((r) => r.label === l);
    const landscape = pick('16:9'), portrait = pick('390x844');
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    results.C = {
      rows,
      checks: {
        horizon16x9: near(landscape.horizon, landscape.design.horizon, 0.03),
        horizonPortrait: near(portrait.horizon, portrait.design.horizon, 0.03),
        hullWidthPortrait: near(portrait.hullWidth, portrait.design.shipWidth, 0.04),
        hullWidthPortraitBand: portrait.hullWidth >= 0.3 && portrait.hullWidth <= 0.5,
        cameraBack: near(landscape.back, 31, 0.6),
        cameraUp: near(landscape.up, 6.6, 0.6),
        fov: near(landscape.fov, 53, 0.3) && near(portrait.fov, 53, 0.05),
        steerMode: rows.every((r) => r.mode === 'steer'),
      },
      errors: errors.slice(0, 5),
    };
    results.C.ok = Object.values(results.C.checks).every(Boolean);
    console.log('C', JSON.stringify(results.C.checks), JSON.stringify(rows.map((r) => [r.label, r.horizon, r.design.horizon, r.hullWidth, r.design.shipWidth, r.hullBottom])));
    save();
    await browser.close();
  }

  // ------------------------------------------------------------------ D. 감상·발견
  if (only.includes('D')) {
    const { browser, page, errors } = await open({ width: 640, height: 360 });
    await startSailing(page);
    await teleport(page, POINTS[3], { settle: 14 });
    const sample = () => page.evaluate(() => {
      const g = window.__OCEAN_GAME__, snap = window.__OCEAN_API__.cameraQa.snapshot(), c = g.camera.position, m = g.motion;
      return { sim: +g.simTime.toFixed(2), mode: snap.mode, previous: snap.previous, rate: snap.rate, fov: snap.fov, dist: +Math.hypot(c.x - m.x, c.z - m.z).toFixed(2), up: +(c.y - g.world.ship.position.y).toFixed(2), bearingDeg: +(((Math.atan2(-(c.x - m.x), -(c.z - m.z)) - m.heading) * 180) / Math.PI).toFixed(2), scenicEligible: snap.scenicEligible };
    });
    const steer0 = await sample();
    // 감상 진입: 마지막 입력을 9초 전으로 돌린다(정지한 배, 튜토리얼 끝남)
    await page.evaluate(() => window.__OCEAN_API__.cameraQa.setIdle(9000));
    const scenic = [];
    for (let i = 0; i < 18; i++) { await frames(page, 3); scenic.push(await sample()); }
    const scenicEnd = scenic[scenic.length - 1];
    await page.screenshot({ path: outPath('rm_RM4_scenic_640x360_after.png') });
    // 입력 → 조타 복귀. 프레임마다 기록해 갑작스러운 점프(프레임당 이동량)가 없는지 본다.
    // 복귀 뒤 8초 동안 다시 입력이 없으면 정상적으로 감상에 다시 들어가므로, 표본은 실시간 4.5초 안에서만 모은다.
    await page.evaluate(() => window.__OCEAN_API__.cameraQa.noteInput());
    const back = [];
    const backStart = Date.now();
    while (Date.now() - backStart < 4500) { await frames(page, 2); back.push(await sample()); }
    let maxStep = 0;
    for (let i = 1; i < back.length; i++) maxStep = Math.max(maxStep, Math.abs(back[i].dist - back[i - 1].dist), Math.abs(back[i].up - back[i - 1].up));
    const backEnd = back[back.length - 1];
    const afterInput = back[0];
    // 발견: 미수집 용어 부표(2번 해역)에서 6m 떨어져, 부표가 선수 오른쪽 20° 방향에 오게 놓고 용어 카드를 연다
    const discover = await page.evaluate(async () => {
      const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
      const term = a.TERMS.find((t) => t.region === 2 && t.rarity !== 'rare');
      const spawn = a.contentQa.term(term.id).spawn;
      const phi = 0.9, off = (20 * Math.PI) / 180; // 부표 방위 phi, 선수는 부표보다 20° 왼쪽을 본다
      g.motion.speed = 0; g.motion.x = spawn.x - Math.sin(phi) * 6; g.motion.z = spawn.z - Math.cos(phi) * 6; g.motion.heading = phi - off; g.currentRegion = 2;
      g.cameraDrag.yaw = 0;
      a.cameraQa.snap(); a.cameraQa.noteInput();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      g.checkTermDiscovery(1);
      return { term: term.id, spawn, popup: Boolean(g.currentTerm), offDeg: 20 };
    });
    const disc = [];
    for (let i = 0; i < 12; i++) { await frames(page, 3); disc.push(await sample()); }
    const discEnd = disc[disc.length - 1];
    await page.screenshot({ path: outPath('rm_RM4_discover_640x360_after.png') });
    const focus = await page.evaluate(() => window.__OCEAN_API__.cameraQa.snapshot().focus);
    const yawDeg = Math.abs(discEnd.bearingDeg);
    // 닫은 뒤: 근처의 다음 부표가 또 열리지 않게 배를 멀리 옮기고 Esc
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.motion.x += 120; g.motion.z += 120; });
    await page.keyboard.press('Escape');
    const closed = [];
    const closedStart = Date.now();
    while (Date.now() - closedStart < 4500) { await frames(page, 2); closed.push(await sample()); } // Esc 키 입력이 입력으로 잡혀 8초 안에는 감상에 들어가지 않는다
    const closedEnd = closed[closed.length - 1];
    results.D = {
      steer0, scenic: scenic.filter((_, i) => i % 3 === 0), scenicEnd, afterInput, maxStep: round(maxStep), backEnd,
      discover, focus, discEnd, yawDeg: round(yawDeg, 2), closedEnd,
      checks: {
        steerFirst: steer0.mode === 'steer',
        scenicEntered: scenic.every((r, i) => i < 2 || r.mode === 'scenic') && scenicEnd.mode === 'scenic',
        scenicDistance: Math.abs(scenicEnd.dist - 44) < 4,
        scenicHeight: scenicEnd.up >= 4.6 && scenicEnd.up <= 9.4,
        returnedToSteer: back.every((r) => r.mode === 'steer') && back[0].previous === 'scenic',
        returnDistance: Math.abs(backEnd.dist - 31) < 1.5 && Math.abs(backEnd.up - 6.6) < 1,
        noJump: maxStep < 4,
        discoverMode: discEnd.mode === 'discover' && discover.popup,
        discoverFov: Math.abs(discEnd.fov - 49) < 0.6,
        discoverYaw: yawDeg <= 8.6 && yawDeg >= 6.5,
        closedFov: Math.abs(closedEnd.fov - 53) < 0.8 && closedEnd.mode === 'steer',
      },
      errors: errors.slice(0, 5),
    };
    results.D.ok = Object.values(results.D.checks).every(Boolean);
    console.log('D', JSON.stringify(results.D.checks), JSON.stringify({ scenicEnd, backEnd, discEnd, yawDeg, closedEnd, maxStep }));
    save();
    await browser.close();
  }

  // ------------------------------------------------------------------ E. 동작 줄이기와 첫 방문 지도
  if (only.includes('E')) {
    const { browser, page, errors } = await open({ width: 640, height: 360 });
    await startSailing(page);
    await teleport(page, POINTS[3], { settle: 14 });
    await page.evaluate(() => { window.__OCEAN_GAME__.applyReducedMotion(true); window.__OCEAN_API__.cameraQa.snap(); });
    await frames(page, 4);
    await page.evaluate(() => window.__OCEAN_API__.cameraQa.setIdle(60000));
    const rows = [];
    for (let i = 0; i < 8; i++) {
      await frames(page, 4);
      rows.push(await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, snap = window.__OCEAN_API__.cameraQa.snapshot(), c = g.camera.position, m = g.motion;
        return { mode: snap.mode, eligible: snap.scenicEligible, x: c.x - m.x, y: c.y - g.world.ship.position.y, z: c.z - m.z, fov: snap.fov };
      }));
    }
    const spread = (k) => Math.max(...rows.map((r) => r[k])) - Math.min(...rows.map((r) => r[k]));
    // 해역을 건너 표제 카드: 즉시 나타나고(in 없음) 2.6초 머문 뒤 즉시 사라진다
    const cardSamples = await page.evaluate(() => new Promise((resolve) => {
      const g = window.__OCEAN_GAME__, banner = document.getElementById('region-banner'), out = [], t0 = performance.now();
      g.motion.x = 113; g.motion.z = 190; g.motion.heading = 0; g.currentRegion = 4; // 4번 해역으로 들어가는 것처럼
      const f = () => {
        const now = performance.now();
        out.push({ at: Math.round(now - t0), phase: banner.dataset.phase || null, hidden: banner.hidden, opacity: +Number(getComputedStyle(banner).opacity).toFixed(2), mapOpen: Boolean(g.ux.mapOpen) });
        if (now - t0 > 4200) resolve(out); else requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    }));
    const seen = [...new Set(cardSamples.map((s) => s.phase))];
    const holdFirst = cardSamples.find((s) => s.phase === 'hold' && !s.hidden);
    const doneAt = cardSamples.find((s) => s.hidden && s.at > 300);
    const mapSeen = cardSamples.some((s) => s.mapOpen);
    results.E = {
      auto: { modes: [...new Set(rows.map((r) => r.mode))], eligible: [...new Set(rows.map((r) => r.eligible))], spreadX: round(spread('x'), 4), spreadY: round(spread('y'), 4), spreadZ: round(spread('z'), 4), spreadFov: round(spread('fov'), 4) },
      card: { phasesSeen: seen, holdFirstAt: holdFirst ? holdFirst.at : null, doneAt: doneAt ? doneAt.at : null, maxOpacityBeforeHold: Math.max(...cardSamples.filter((s) => !holdFirst || s.at < holdFirst.at).map((s) => s.opacity)), mapSeen },
      checks: {},
      errors: errors.slice(0, 5),
    };
    const a = results.E.auto, c = results.E.card;
    results.E.checks = {
      neverScenic: a.modes.length === 1 && a.modes[0] === 'steer' && a.eligible.length === 1 && a.eligible[0] === false,
      cameraStill: a.spreadX < 0.02 && a.spreadZ < 0.02 && a.spreadY < 0.2 && a.spreadFov < 0.01,
      noInOutPhase: !c.phasesSeen.includes('in') && !c.phasesSeen.includes('out'),
      holdImmediate: c.holdFirstAt !== null && c.holdFirstAt < 400,
      leavesAfterHold: c.doneAt === null || (c.doneAt >= 2500 && c.doneAt <= 3300),
    };
    results.E.ok = Object.values(results.E.checks).every(Boolean);
    console.log('E', JSON.stringify(results.E));
    save();
    await browser.close();
  }
  console.log('DONE', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.ok]))));
})();

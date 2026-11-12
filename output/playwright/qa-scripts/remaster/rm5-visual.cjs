'use strict';
/*
 * GRM5 시각 확인: 등불 부표·병·문, 배 등불, 수면 고리 여섯 종류, 무드 입자, 용어 발견 빛 덩이를 장면별로 촬영한다.
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm5-visual.cjs [--only buoys,bottles,gates,ship,rings,particles,orb] [--w 1280 --h 720]
 * 장면마다 따로 실패해도 나머지는 계속한다. 촬영 파일: output/playwright/rm_RM5_<장면>_<폭>x<높이>_after.png
 * 모든 값은 sim 시간 기준이다(헤드리스 소프트웨어 렌더는 벽시계보다 한참 느리다).
 */
const fs = require('fs');
const { open, frames, startSailing, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const only = String(arg('only', 'buoys,bottles,gates,ship,rings,particles,orb')).split(',').map((s) => s.trim());
const W = Number(arg('w', '1280')), H = Number(arg('h', '720'));
const HIDE = '#qa-hud{display:none!important} body.nohud .hud, body.nohud #control-layer, body.nohud .minimap-panel, body.nohud #world-labels, body.nohud #objective-chip, body.nohud #help-strip, body.nohud #game-toast, body.nohud #caption-strip, body.nohud #region-banner, body.nohud #remaster-region-art, body.nohud .collect-counter, body.nohud .action-cluster, body.nohud #effect-cue, body.nohud #trial-overlay{display:none!important}';
const report = {};
const shot = async (page, name, { nohud = true } = {}) => {
  if (nohud) await page.evaluate(() => document.body.classList.add('nohud'));
  await frames(page, 2);
  const file = outPath(`rm_RM5_${name}_${W}x${H}_after.png`);
  await page.screenshot({ path: file });
  if (nohud) await page.evaluate(() => document.body.classList.remove('nohud'));
  return file;
};
// 지정 위치에 배를 세우고 (tx,tz)를 바라보게 한다
const stand = async (page, x, z, tx, tz, { pitch = 0.34, region = null } = {}) => {
  await page.evaluate(({ x, z, tx, tz, pitch }) => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    g.motion.x = x; g.motion.z = z; g.motion.heading = Math.atan2(tx - x, tz - z); g.motion.speed = 0;
    g.cameraDrag.yaw = 0; g.cameraDrag.pitch = pitch;
    a.cameraQa.snap(); a.cameraQa.noteInput();
    g.atmosphere.refresh(g.simTime, x, z);
  }, { x, z, tx, tz, pitch });
  await frames(page, 10);
  await page.evaluate(() => { const g = window.__OCEAN_GAME__; if (g.currentTerm) g.closeTermCard(); window.__OCEAN_API__.vfxQa.settle(); });
  await frames(page, 4);
};

(async () => {
  const { browser, page, errors } = await open({ query: '?qa=1', width: W, height: H });
  await startSailing(page);
  await page.evaluate(async () => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    if (g.remaster && g.remaster.start) await g.remaster.start();
    a.vfxQa.setTimeOfDay(0.25);
    const st = document.createElement('style'); st.textContent = '#qa-hud{display:none!important}'; document.head.appendChild(st);
  });
  await page.evaluate((css) => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }, HIDE);
  const run = async (name, fn) => {
    if (!only.includes(name)) return;
    try { report[name] = await fn(); } catch (e) { report[name] = { error: String(e).slice(0, 300) }; }
  };

  // 1) 등불 부표: 점등(안 모은 것) vs 꺼짐(모은 것). 해역 0 낮 / 해역 5 푸른 시간(빛이 두드러진다)
  await run('buoys', async () => {
    const out = {};
    for (const [tag, region] of [['r0', 0], ['r5', 5]]) {
      const pick = await page.evaluate((region) => {
        const g = window.__OCEAN_GAME__;
        const ref = region === 0 ? { x: 0, z: -430 } : { x: -96, z: 172 };
        const rows = TERM_BUOY_SPECS.filter((s) => s.term.region === region || Math.hypot(s.x - ref.x, s.z - ref.z) < 90)
          .map((s) => ({ i: s.index, id: s.term.id, x: s.x, z: s.z, d: Math.hypot(s.x - ref.x, s.z - ref.z) }))
          .sort((p, q) => p.d - q.d).slice(0, 5);
        // 가운데 둘을 "이미 모음"으로 돌려 점등/꺼짐을 한 장면에 담는다
        SAVE.progress.termsFound = [...new Set([...SAVE.progress.termsFound, rows[1].id, rows[3].id])];
        syncTermBuoyColors(g.world.termBuoys);
        return rows;
      }, region);
      const cx = pick.reduce((s, r) => s + r.x, 0) / pick.length, cz = pick.reduce((s, r) => s + r.z, 0) / pick.length;
      await stand(page, cx - 10, cz - 26, cx, cz);
      await frames(page, 12);
      out[tag] = { picked: pick.map((r) => r.id), lanterns: await page.evaluate(() => window.__OCEAN_API__.remasterQa.lanterns().buoy), file: await shot(page, `buoys_${tag}`) };
      // 확대: 점등 하나와 꺼진 하나 옆으로 다가간다
      await stand(page, pick[0].x + 5, pick[0].z - 15, (pick[0].x + pick[1].x) / 2, (pick[0].z + pick[1].z) / 2, { pitch: 0.22 });
      await frames(page, 8);
      out[tag].closeFile = await shot(page, `buoys_${tag}_close`);
      await page.evaluate(() => { SAVE.progress.termsFound = SAVE.progress.termsFound.filter(() => false); syncTermBuoyColors(window.__OCEAN_GAME__.world.termBuoys); });
    }
    return out;
  });

  // 2) 불 든 유리병
  await run('bottles', async () => {
    const b = await page.evaluate(() => BOTTLE_SPECS.slice(0, 3).map((s) => ({ id: s.id, x: s.x, z: s.z })));
    await stand(page, b[0].x + 6, b[0].z - 18, b[0].x, b[0].z, { pitch: 0.28 });
    await frames(page, 8);
    return { bottles: b, lanterns: await page.evaluate(() => window.__OCEAN_API__.remasterQa.lanterns().bottle), file: await shot(page, 'bottles') };
  });

  // 3) 시련 문(등불 문): 1번 해역 시련, 선택지 4개가 원 위에 선다
  await run('gates', async () => {
    // 문은 항해형(navigation·ordered_navigation·listening) 문제에서만 서므로 그 문제로 바로 넘긴다
    const started = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
      a.questQa.prepare(1); g.applyReducedMotion(false);
      a.cameraQa.snap();
      if (!g.startRegionTrial(1)) return { error: 'trial start refused' };
      const idx = g.trialSet.questions.findIndex((q) => ['navigation', 'ordered_navigation', 'listening'].includes(q.type));
      if (idx < 0) return { error: 'no world trial in set' };
      g.trialSession.index = idx; g.resetTrialRuntime(); g.renderTrialProblem();
      return { index: idx, type: g.trialSet.questions[idx].type, choices: g.trialSet.questions[idx].choices.length };
    });
    if (started.error) throw new Error(started.error);
    await page.waitForTimeout(1200);
    await frames(page, 12);
    const info = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__;
      return g.world.trialBuoys.buoys.map((b) => ({ id: b.userData.choiceId, vis: b.visible, x: +b.position.x.toFixed(1), z: +b.position.z.toFixed(1), ry: +b.rotation.y.toFixed(2), eliminated: Boolean(b.userData.eliminated) }));
    });
    const file = await shot(page, 'gates');
    // 힌트로 하나를 지운다(있으면): 지워진 문은 흐려져야 한다
    const hinted = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, p = g.currentTrialProblem();
      if (!p) return null;
      const target = g.currentTrialTarget(p);
      const wrong = g.world.trialBuoys.buoys.find((b) => b.visible && b.userData.choiceId !== target);
      if (!wrong) return null;
      g.trialSession.hintEliminated = { problemId: p.id, choiceId: wrong.userData.choiceId, targetId: null };
      return wrong.userData.choiceId;
    });
    await frames(page, 24);
    const file2 = await shot(page, 'gates_hint');
    const lan = await page.evaluate(() => window.__OCEAN_API__.remasterQa.lanterns().gate);
    // 시련 끝내기
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; try { g.leaveTrial && g.leaveTrial(); } catch (e) {} });
    const after = await page.evaluate(() => window.__OCEAN_GAME__.world.trialBuoys.buoys.map((b) => ({ id: b.userData.choiceId, eliminated: Boolean(b.userData.eliminated), sink: +(b.userData.hintSink || 0).toFixed(2), y: +b.position.y.toFixed(2) })));
    return { started, info, hinted, after, gate: lan, file, file2 };
  });

  // 4) 배 등불 + 창: 푸른 시간(해역 5)과 심해(해역 3)에서 배를 뒤에서
  await run('ship', async () => {
    const out = {};
    for (const [tag, x, z, h] of [['r5', -96, 172, 0.25], ['r3', 253, 0, 0]]) {
      await page.evaluate(({ x, z, h }) => {
        const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
        if (g.mode && g.mode !== 'SAILING') {}
        g.motion.x = x; g.motion.z = z; g.motion.heading = h; g.motion.speed = 0;
        g.cameraDrag.yaw = 0.45; g.cameraDrag.pitch = 0.18; a.cameraQa.snap(); a.cameraQa.noteInput();
        g.atmosphere.refresh(g.simTime, x, z);
      }, { x, z, h });
      await frames(page, 14);
      const lanternState = await page.evaluate(() => { const l = window.__OCEAN_API__.remasterQa.lanterns(); return { ship: l.shipLantern, pointLights: l.pointLights }; });
      out[tag] = { ...lanternState, file: await shot(page, `ship_${tag}`) };
    }
    // 동작 줄이기: 흔들림이 멈춘다
    await page.evaluate(() => window.__OCEAN_GAME__.applyReducedMotion(true));
    await frames(page, 6);
    const flickers = [];
    for (let i = 0; i < 4; i++) { await frames(page, 2); flickers.push(await page.evaluate(() => window.__OCEAN_API__.remasterQa.lanterns().shipLantern.flicker)); }
    out.reducedFlicker = flickers;
    await page.evaluate(() => window.__OCEAN_GAME__.applyReducedMotion(false));
    return out;
  });

  // 5) 수면 고리 여섯 종류: 높은 품질(고리 8칸)에서 배 둘레에 한꺼번에
  await run('rings', async () => {
    await page.evaluate(() => window.__OCEAN_API__.vfxQa.setQuality('high'));
    // 박자 큐가 칸을 덮어쓰지 않도록 소리 진행을 멈춘다(촬영 전용)
    await page.evaluate(() => { const a = window.__OCEAN_API__; a.audioQa.stop(); window.__OCEAN_GAME__.effects.waterRings.clear(); });
    await stand(page, -96, 172, -96, 202, { pitch: 1.18 });
    const kinds = ['beat', 'discover', 'dots', 'wave', 'triple'];
    const placed = await page.evaluate((kinds) => {
      const g = window.__OCEAN_GAME__, s = g.world.ship.position, e = g.effects;
      e.waterRings.clear();
      // 거의 내려다보는 시점에서 다섯 종류를 한 줄로 놓는다. 종류마다 수명의 약 30%가 지난 모습(점등 고리는 너무 커서 뺀다).
      return kinds.map((k, i) => {
        const life = WATER_RING_KINDS[k].life, dx = (i - 2) * 13, dz = 14;
        return [k, e.waterRings.add(k, s.x + dx, s.z + dz, e.time - life * 0.3, 1)];
      });
    }, kinds);
    // 카메라를 배 앞 수면 위에서 거의 수직으로 내려다보게 고정한다(촬영 전용: 인스턴스 메서드로 덮었다가 지운다)
    await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, s = g.world.ship.position;
      g.updateCamera = function () {
        g.camera.position.set(s.x, 34, s.z + 4);
        g.camera.up.set(0, 0, 1);
        g.camera.lookAt(s.x, 0, s.z + 14);
        g.camera.updateMatrixWorld();
      };
    });
    await frames(page, 4);
    const music = await page.evaluate(() => window.__OCEAN_API__.remasterQa.music());
    const file = await shot(page, 'rings_high');
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; delete g.updateCamera; g.camera.up.set(0, 1, 0); });
    await page.evaluate(() => { const a = window.__OCEAN_API__; a.vfxQa.setQuality('mid'); a.audioQa.resume(); });
    return { placed, ringSlots: music.ringSlots, rings: music.rings, file };
  });

  // 6) 무드 입자: 해역 0(새벽 먼지)·1(황금빛 씨앗)·2(폭풍 비)·3(심해 가는 비)·4(안개 꽃잎)
  //    소프트웨어 렌더는 sim이 느려서, 효과 디렉터를 직접 12초치(0.05초 × 240) 돌려 정상 상태 입자 밀도를 만든다.
  await run('particles', async () => {
    const out = {};
    await page.evaluate(() => window.__OCEAN_API__.audioQa.stop()); // 박자 큐 폭발(헤드리스에서만 sim보다 빨리 흐른다)을 끈다
    const pts = [['r0', 0, -430, 0.57], ['r1', -10, -262, -0.49], ['r2', 195, -205, 0.2], ['r3', 253, 0, 0], ['r4', 113, 190, 0]];
    for (const [tag, x, z, h] of pts) {
      await page.evaluate(({ x, z, h }) => {
        const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
        g.motion.x = x; g.motion.z = z; g.motion.heading = h; g.motion.speed = 0;
        g.cameraDrag.yaw = 0; g.cameraDrag.pitch = 0.34; a.cameraQa.snap(); a.cameraQa.noteInput();
        g.atmosphere.refresh(g.simTime, x, z);
        a.vfxQa.settle();
      }, { x, z, h });
      await frames(page, 6);
      const steady = await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
        if (g.currentTerm) g.closeTermCard();
        let peak = 0, ex0 = a.remasterQa.particles().exhausted;
        for (let i = 0; i < 240; i++) { g.effects.update(0.05); peak = Math.max(peak, g.effects.pool.activeCount); }
        const st = a.remasterQa.particles();
        return { peak, active: st.active, capacity: st.capacity, shapes: st.shapes, normalAlpha: st.normalAlpha, exhaustedDelta: st.exhausted - ex0, share: +(st.active / st.capacity).toFixed(3) };
      });
      await page.evaluate(() => { const g = window.__OCEAN_GAME__; if (g.currentTerm) g.closeTermCard(); });
      await frames(page, 2);
      out[tag] = { steady, file: await shot(page, `particles_${tag}`) };
    }
    await page.evaluate(() => window.__OCEAN_API__.audioQa.resume());
    return out;
  });

  // 7) 용어 발견: 빛 덩이가 뜬다(원통 빛기둥 없음)
  await run('orb', async () => {
    await stand(page, 0, -430, 25.8, -424.4, { pitch: 0.3 });
    await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, s = g.world.ship.position;
      g.effects.showOrb({ x: s.x + 3, y: 2.5, z: s.z - 12 });
      g.effects.addWaterRing('discover', s.x + 3, s.z - 12, 1);
    });
    await frames(page, 3);
    const snap = await page.evaluate(() => window.__OCEAN_API__.remasterQa.music().orb);
    return { orb: snap, file: await shot(page, 'orb') };
  });

  console.log(JSON.stringify({ report, errors: errors.slice(0, 8) }, null, 1));
  fs.writeFileSync(outPath('rm5-visual.json'), JSON.stringify({ report, errors }, null, 1));
  await browser.close();
})();

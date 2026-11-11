'use strict';
/*
 * RM8 진단: 렌더러 자원이 "처음 화면에 그려질 때" 올라가는 것인지 본다 (지구력 시험이 처음에 지오메트리 +7·텍스처 +1·프로그램 +1로 실패한 원인 조사).
 *   지구력 시험의 항로(w+d를 계속 누른 원 운동)를 게임 시간으로 빨리 감는다: 게임 루프를 세우고 tick()을 직접 50ms씩 부르되, 그리기는 N걸음에 한 번만 한다.
 *   그리기를 한 직후 renderer.info(지오메트리·텍스처·프로그램)가 바뀌었으면 그 시각·자리와 새로 올라간 지오메트리(장면에서 renderer가 처음 쓴 것: 'dispose' 리스너가 붙은 것)·새 셰이더 프로그램을 적는다.
 *   결과: 새로 올라가는 것은 랜드마크 근경·원경 부품과 시련 부표 라벨 스프라이트뿐이고, 그 뒤로는 늘지 않는다(유한한 첫 그리기 업로드 = 누수 아님).
 *
 * 사용: BASE_URL=http://127.0.0.1:8767 node rm8-lazy-upload.cjs [걸음 수 6000] [그리기 간격 16]
 */
const { open } = require('./lib.cjs');
const STEPS = Number(process.argv[2] || 6000), EVERY = Number(process.argv[3] || 16), CHUNK = 200;
(async () => {
  const { browser, page, errors } = await open({ query: '?qa=1', width: 1440, height: 900 });
  await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
  await page.click('#start-sailing');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
    a.questQa.prepare(1); g.audio.setMuted(true);
    const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
    g.stop();
    g.keys.add('w'); g.keys.add('d');
    window.__now = performance.now(); g.lastTime = window.__now;
    const info = g.renderer.info;
    window.__last = { geo: info.memory.geometries, tex: info.memory.textures, prog: info.programs.length };
    window.__known = new Set();
    window.__progNames = new Set(info.programs.map((p) => p.name + '|' + (p.cacheKey || '').slice(0, 60)));
    window.__scan = () => { const out = []; g.world.scene.traverse((o) => { const L = o.geometry && o.geometry._listeners; if (L && L.dispose && L.dispose.length && !window.__known.has(o.geometry.uuid)) { window.__known.add(o.geometry.uuid); out.push((o.name || o.type) + ':' + o.geometry.type + (o.parent && o.parent.name ? '@' + o.parent.name : '')); } }); return out; };
    window.__scan(); // 현재까지 올라간 것을 기준으로 삼는다
  });
  console.log('기준', JSON.stringify(await page.evaluate(() => window.__last)));
  const events = [];
  for (let s = 0; s < STEPS; s += CHUNK) {
    const ev = await page.evaluate(({ startStep, n, every }) => {
      const g = window.__OCEAN_GAME__, out = [];
      let now = window.__now;
      for (let i = 0; i < n; i++) {
        const step = startStep + i;
        now += 50;
        const doRender = step % every === 0;
        if (!doRender) g.renderFrame = () => {}; else delete g.renderFrame;
        g.tick(now); cancelAnimationFrame(g.raf); g.raf = 0;
        if (doRender) {
          const info = g.renderer.info, cur = { geo: info.memory.geometries, tex: info.memory.textures, prog: info.programs.length };
          if (cur.geo !== window.__last.geo || cur.tex !== window.__last.tex || cur.prog !== window.__last.prog) {
            const names = new Set(info.programs.map((p) => p.name + '|' + (p.cacheKey || '').slice(0, 60)));
            const newProgs = [...names].filter((n2) => !window.__progNames.has(n2));
            window.__progNames = names;
            out.push({ step, sim: +g.simTime.toFixed(1), x: Math.round(g.motion.x), z: Math.round(g.motion.z), h: +g.motion.heading.toFixed(2), region: g.currentRegion, mood: g.atmosphere && g.atmosphere.mood, before: window.__last, after: cur, newGeo: window.__scan(), newProgs });
            window.__last = cur;
          }
        }
      }
      delete g.renderFrame; window.__now = now;
      return out;
    }, { startStep: s, n: CHUNK, every: EVERY });
    ev.forEach((e) => { events.push(e); console.log('변화', JSON.stringify(e)); });
    if (((s / CHUNK) % 5) === 4) console.log('진행', s + CHUNK, '/', STEPS, JSON.stringify(await page.evaluate(() => ({ last: window.__last, sim: Math.round(window.__OCEAN_GAME__.simTime), x: Math.round(window.__OCEAN_GAME__.motion.x), z: Math.round(window.__OCEAN_GAME__.motion.z) }))));
  }
  console.log('끝', JSON.stringify(await page.evaluate(() => window.__last)), '변화 횟수', events.length, '오류', JSON.stringify(errors.slice(0, 3)));
  await browser.close();
})();

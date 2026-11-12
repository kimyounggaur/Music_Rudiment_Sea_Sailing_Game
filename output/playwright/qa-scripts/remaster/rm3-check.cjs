'use strict';
/*
 * RM3 게이트 확인 (GRM3)
 *   A. 품질 3 × fx 4 행렬: 계획·패스별 드로우콜·타깃 수·CSS 대체
 *   B. 켜고 끄기 20회 반복: 렌더 타깃·텍스처·프로그램 수가 늘지 않는다
 *   C. WebGL 컨텍스트 손실·복구(WEBGL_lose_context)
 *   D. 아홉 지점의 패스별 삼각형(반사 패스 70,000 이하는 잠정 기준)
 *   node rm3-check.cjs [--w 1280 --h 720] [--only A,B,C,D]
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const W = Number(arg('w', '1280')), H = Number(arg('h', '720'));
const only = arg('only', 'A,B,C,D').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const probe = () => {
  const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, r = g.renderer, p = a.remasterQa.pipeline(), s = a.remasterQa.passes();
  const canvas = r.domElement, vig = document.getElementById('scene-vignette');
  return {
    plan: p && p.plan ? { q: p.plan.quality, fx: p.plan.fx, reflect: p.plan.reflect, post: p.plan.post, passes: p.plan.passes, msaa: p.plan.msaa } : null,
    calls: { shadow: s.shadow.calls, reflection: s.reflection.calls, main: s.main.calls, post: s.post.calls },
    tris: { shadow: s.shadow.triangles, reflection: s.reflection.triangles, main: s.main.triangles, post: s.post.triangles, total: s.total.triangles },
    targets: p ? p.targetCount : null,
    sizes: p ? p.targets : null,
    textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs.length,
    filter: canvas.style.filter || '', vignette: vig ? vig.style.display : 'none',
    defines: g.atmosphere.waterMaterial.defines,
    paletteGrade: g.atmosphere.paletteGrade, reflReady: p ? p.reflReady : null, failed: p ? p.failed : null, demoted: p ? p.demoted : null,
    tone: a.remasterQa.tone(),
  };
};

(async () => {
  const { browser, page, errors } = await open({ width: W, height: H });
  await startSailing(page);
  await page.evaluate(() => { const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; });
  await teleport(page, POINTS[0], { settle: 30 });
  // 이전 실행 결과를 보존한다(--only 로 일부만 다시 돌려도 나머지 항목이 남는다).
  const prev = fs.existsSync(outPath('rm3-check.json')) ? JSON.parse(fs.readFileSync(outPath('rm3-check.json'), 'utf8')) : {};
  const out = { ...prev, viewport: [W, H] };

  if (only.includes('A')) {
    out.matrix = [];
    for (const q of ['low', 'mid', 'high'])
      for (const fx of ['auto', 'full', 'lite', 'off']) {
        await page.evaluate(({ q, fx }) => { const g = window.__OCEAN_GAME__; g.applyQualityProfile(q, false); window.__OCEAN_API__.remasterQa.setFx(fx); }, { q, fx });
        await frames(page, 8);
        const row = await page.evaluate(probe);
        row.q = q; row.fxAsked = fx;
        out.matrix.push(row);
        console.log('A', q.padEnd(4), fx.padEnd(5), 'plan', JSON.stringify(row.plan && [row.plan.reflect, row.plan.post, row.plan.passes]), 'calls', JSON.stringify(row.calls), 'targets', row.targets, 'prog', row.programs, 'tex', row.textures, row.filter ? 'css' : '', row.vignette !== 'none' ? 'vig' : '', 'tone', JSON.stringify(row.tone));
      }
  }

  if (only.includes('B')) {
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyQualityProfile('mid', false); window.__OCEAN_API__.remasterQa.setFx('full'); });
    await frames(page, 6);
    out.toggle = { baseline: await page.evaluate(probe), cycles: [] };
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
        a.remasterQa.setFx('off'); g.renderFrame();
        g.applyQualityProfile('low', false); g.renderFrame();
        g.applyQualityProfile('high', false); a.remasterQa.setFx('lite'); g.renderFrame();
        g.applyQualityProfile('mid', false); a.remasterQa.setFx('full'); g.renderFrame();
      });
      await frames(page, 2);
      const r = await page.evaluate(probe);
      out.toggle.cycles.push({ i: i + 1, targets: r.targets, textures: r.textures, geometries: r.geometries, programs: r.programs });
    }
    const first = out.toggle.cycles[0], last = out.toggle.cycles[19], base = out.toggle.baseline;
    out.toggle.summary = {
      baseline: { targets: base.targets, textures: base.textures, geometries: base.geometries, programs: base.programs },
      first, last,
      growthAfterFirstCycle: { targets: last.targets - first.targets, textures: last.textures - first.textures, geometries: last.geometries - first.geometries, programs: last.programs - first.programs },
      growthVsBaseline: { targets: last.targets - base.targets, textures: last.textures - base.textures, geometries: last.geometries - base.geometries, programs: last.programs - base.programs },
    };
    console.log('B', JSON.stringify(out.toggle.summary));
  }

  if (only.includes('C')) {
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyQualityProfile('mid', false); window.__OCEAN_API__.remasterQa.setFx('full'); });
    await frames(page, 10);
    const before = await page.evaluate(probe);
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; window.__lose = g.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
    await sleep(400);
    const during = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, p = window.__OCEAN_API__.remasterQa.pipeline();
      return { contextLost: g.contextLost, pipelineLost: p.lost, targetCount: p.targetCount, overlay: document.getElementById('system-overlay').classList.contains('active') };
    });
    await page.evaluate(() => window.__lose.restoreContext());
    await sleep(800);
    await frames(page, 12);
    const after = await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, p = a.remasterQa.pipeline(), s = a.remasterQa.passes();
      return { contextLost: g.contextLost, pipelineLost: p.lost, targetCount: p.targetCount, reflReady: p.reflReady, counters: p.counters, overlay: document.getElementById('system-overlay').classList.contains('active'),
        calls: { shadow: s.shadow.calls, reflection: s.reflection.calls, main: s.main.calls, post: s.post.calls }, tris: s.total.triangles,
        shadowEnabled: g.renderer.shadowMap.enabled, autoReset: g.renderer.info.autoReset, rebinds: g.renderStats.rebinds, raf: Boolean(g.raf), frames: p.frames, tone: a.remasterQa.tone() };
    });
    const errorsAtRestore = errors.slice();
    // 복구 뒤 몇 프레임 더 돌려 상태가 유지되는지, 그리고 설정을 바꿔도 동작하는지
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyQualityProfile('high', false); window.__OCEAN_API__.remasterQa.setFx('full'); });
    await frames(page, 10);
    const afterHigh = await page.evaluate(probe);
    out.contextLoss = { errorsAtRestore: errorsAtRestore.slice(0, 6), errorsAfterQualityChange: errors.length - errorsAtRestore.length, before: { targets: before.targets, calls: before.calls, tone: before.tone }, during, after, afterQualityChange: { plan: afterHigh.plan, targets: afterHigh.targets, calls: afterHigh.calls, tone: afterHigh.tone } };
    console.log('C', JSON.stringify(out.contextLoss));
  }

  if (only.includes('D')) {
    out.points = [];
    for (const quality of ['mid', 'high']) {
      await page.evaluate((q) => { const g = window.__OCEAN_GAME__; g.applyQualityProfile(q, false); window.__OCEAN_API__.remasterQa.setFx('full'); }, quality);
      for (const p of POINTS) {
        await teleport(page, p, { settle: 10 });
        await frames(page, 6);
        const r = await page.evaluate(probe);
        out.points.push({ quality, point: p.name, calls: r.calls, tris: r.tris, programs: r.programs });
        console.log('D', quality.padEnd(4), p.name.padEnd(13), 'R', r.calls.reflection + '/' + r.tris.reflection, 'M', r.calls.main + '/' + r.tris.main, 'S', r.calls.shadow + '/' + r.tris.shadow, 'P', r.calls.post + '/' + r.tris.post, 'prog', r.programs);
      }
    }
    const worst = (q) => Math.max(...out.points.filter((x) => x.quality === q).map((x) => x.tris.reflection));
    out.pointsSummary = { maxReflectionTris: { mid: worst('mid'), high: worst('high') }, limit: 70000 };
    console.log('D', JSON.stringify(out.pointsSummary));
  }

  out.errors = errors.slice(0, 12);
  fs.writeFileSync(outPath('rm3-check.json'), JSON.stringify(out, null, 1));
  console.log('errors', JSON.stringify(out.errors));
  await browser.close();
})();

'use strict';
/*
 * GRM5: 141개 용어가 새 부표·병으로도 전부 수집되는지, 수집이 시각 상태(꺼짐·배 등불 성장)로 이어지는지, 오디오·화면 동기 값을 확인한다.
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm5-journey.cjs
 * 방법은 기존 여정 QA(journey-final.cjs)의 moveToTerm과 같다: 용어의 출현 위치로 옮기고 checkTermDiscovery(1)을 부른다.
 */
const fs = require('fs');
const { open, frames, startSailing, outPath } = require('./lib.cjs');
(async () => {
  const { browser, page, errors } = await open({ query: '?qa=1', width: 960, height: 540 });
  await startSailing(page, { prepare: false });
  await page.evaluate(async () => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    await g.remaster.start();
    g.audio.setMuted(true);
  });
  await frames(page, 4);
  const before = await page.evaluate(() => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    return { found: SAVE.progress.termsFound.length, terms: a.TERMS.length, lanterns: a.remasterQa.lanterns() };
  });
  // 한 번의 평가 안에서 모두 시도한다: 일반 용어는 부표 경로(checkTermDiscovery), 희귀 용어 13개·이야기 5개는 유리병 경로(checkBottleDiscovery)
  const run = await page.evaluate(() => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, rows = [], missed = [], bottles = [];
    const closeAll = () => { if (g.currentTerm) g.closeTermCard(); if (MODE.current === 'DIALOG') g.closeKeeperDialogue(); };
    for (const term of a.TERMS) {
      if (term.rarity === 'rare') continue; // 희귀 용어는 유리병에서 얻는다(아래)
      const spawn = a.contentQa.term(term.id).spawn;
      if (!spawn) { missed.push({ id: term.id, why: 'no spawn' }); continue; }
      g.motion.speed = 0; g.motion.x = spawn.x; g.motion.z = spawn.z; g.currentRegion = term.region;
      const had = SAVE.progress.termsFound.includes(term.id);
      g.checkTermDiscovery(1);
      const has = SAVE.progress.termsFound.includes(term.id);
      closeAll();
      rows.push({ id: term.id, region: term.region, rarity: term.rarity, had, has });
      if (!has) missed.push({ id: term.id, region: term.region, rarity: term.rarity, spawn });
    }
    for (const spec of BOTTLE_SPECS) {
      g.motion.speed = 0; g.motion.x = spec.x; g.motion.z = spec.z; g.currentRegion = spec.region;
      const had = SAVE.progress.bottlesOpened.includes(spec.id);
      g.bottleClock = 1; g.checkBottleDiscovery(1);
      const has = SAVE.progress.bottlesOpened.includes(spec.id);
      closeAll();
      bottles.push({ id: spec.id, region: spec.region, kind: spec.reward.kind, had, has });
      if (!has) missed.push({ id: spec.id, region: spec.region, why: 'bottle not opened' });
    }
    const normalTotal = a.TERMS.filter((t) => t.rarity !== 'rare').length, rareTotal = a.TERMS.filter((t) => t.rarity === 'rare').length;
    return {
      total: a.TERMS.length, normalTotal, rareTotal, normalCollected: rows.filter((r) => r.has).length,
      bottlesTotal: bottles.length, bottlesOpened: bottles.filter((b) => b.has).length, rareBottles: bottles.filter((b) => b.kind === 'term').length, storyBottles: bottles.filter((b) => b.kind !== 'term').length,
      termsFound: SAVE.progress.termsFound.length, missed,
      byRegion: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((r) => rows.filter((x) => x.region === r && x.has).length + '/' + rows.filter((x) => x.region === r).length),
      state: MODE.current,
    };
  });
  await frames(page, 30);
  const after = await page.evaluate(() => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
    const l = a.remasterQa.lanterns();
    const stats = g.audio.stats ? g.audio.stats() : null;
    return { found: SAVE.progress.termsFound.length, lanterns: l, audioVisualSync: stats && stats.audioVisualSync, bottlesLit: l.bottle.lit };
  });
  console.log(JSON.stringify({ before: { found: before.found, terms: before.terms, buoyLit: before.lanterns.buoy.lit, ship: before.lanterns.shipLantern }, run: { total: run.total, normal: run.normalCollected + '/' + run.normalTotal, rareBottles: run.rareBottles, storyBottles: run.storyBottles, bottlesOpened: run.bottlesOpened + '/' + run.bottlesTotal, termsFound: run.termsFound, byRegion: run.byRegion, missed: run.missed.slice(0, 10), state: run.state }, after: { found: after.found, buoyLit: after.lanterns.buoy.lit, bottleLit: after.bottlesLit, ship: after.lanterns.shipLantern, audioVisualSync: after.audioVisualSync }, errors: errors.slice(0, 5) }, null, 1));
  fs.writeFileSync(outPath('rm5-journey.json'), JSON.stringify({ before, run, after, errors }, null, 1));
  await browser.close();
  process.exit(run.termsFound === run.total && run.bottlesOpened === run.bottlesTotal && run.missed.length === 0 && errors.length === 0 ? 0 : 1);
})();

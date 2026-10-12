async (page) => {
  await page.reload();
  await page.waitForTimeout(1600);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#start-sailing").click();
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    const game = window.__OCEAN_GAME__;
    game.audio.setMuted(true);
    game.applyReducedMotion(true);
    game.motion.x = -82;
    game.motion.z = -288;
    game.motion.heading = 0.58;
    game.motion.speed = 0;
    game.currentRegion = 1;
    game.lastSafe = { x: -82, z: -288 };
    document.getElementById("qa-hud").style.display = "none";
  });
  await page.waitForTimeout(1400);
  await page.screenshot({
    path: "output/playwright/art-refactor_island_1440x900_after.png",
  });
  const desktop = await page.evaluate(() => ({
    mode: window.__OCEAN_API__.phase8Qa.snapshot().mode,
    contextLost: window.__OCEAN_API__.phase8Qa.lifecycle().contextLost,
    visibleRegions: window.__OCEAN_GAME__.world.regionGroups
      .filter((group) => group.visible)
      .map((group) => group.userData.regionId),
    drawCalls: window.__OCEAN_GAME__.renderer.info.render.calls,
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const game = window.__OCEAN_GAME__;
    game.motion.x = 220;
    game.motion.z = -250;
    game.motion.heading = 0.08;
    game.currentRegion = 1;
  });
  await page.waitForTimeout(1600);
  await page.screenshot({
    path: "output/playwright/art-refactor_sailing_390x844_after.png",
  });
  const tests = await page.evaluate(() => window.__OCEAN_TEST_RESULTS__?.totals);
  return { desktop, tests };
}

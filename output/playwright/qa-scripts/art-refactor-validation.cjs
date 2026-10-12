async (page) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1440, height: 900 });
  const start = page.locator("#start-sailing");
  if (await start.isVisible()) await start.click();
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const game = window.__OCEAN_GAME__;
    game.audio.setMuted(true);
    game.applyReducedMotion(false);
    game.motion.x = 220;
    game.motion.z = -250;
    game.motion.heading = 0.08;
    document.getElementById("qa-hud").style.display = "none";
  });
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: "output/playwright/art-refactor_sailing_1440x900_after.png",
  });

  const desktop = await page.evaluate(() => {
    const game = window.__OCEAN_GAME__;
    const ship = game.world.ship;
    const hull = ship.getObjectByName("curved-loft-hull");
    const sail = ship.getObjectByName("wind-filled-curved-sail");
    return {
      mode: window.__OCEAN_API__.phase8Qa.snapshot().mode,
      renderer: {
        contextLost: game.renderer.getContext().isContextLost(),
        calls: game.renderer.info.render.calls,
        triangles: game.renderer.info.render.triangles,
        geometries: game.renderer.info.memory.geometries,
        textures: game.renderer.info.memory.textures,
      },
      art: {
        shipChildren: ship.children.length,
        hullVertices: hull.geometry.attributes.position.count,
        sailVertices: sail.geometry.attributes.position.count,
        termBuoyParts: Object.keys(game.world.termBuoys).filter((key) =>
          ["base", "skirt", "collar", "pole", "cap", "beam"].includes(key),
        ),
        layeredRegionMeshes: game.world.regionGroups.map(
          (group) => group.children.filter((child) => child.isInstancedMesh).length,
        ),
      },
    };
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__OCEAN_GAME__.applyReducedMotion(true));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "output/playwright/art-refactor_sailing_390x844_after.png",
  });
  const mobile = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight],
    overflow: document.documentElement.scrollWidth > innerWidth,
    touchTargets: window.__OCEAN_API__.measureTouchTargets(),
    reducedMotion: document.documentElement.dataset.reducedMotion,
  }));

  await page.evaluate(() => {
    const game = window.__OCEAN_GAME__;
    game.openPause();
    game.showMenuTab("settings");
  });
  const menuOpen = await page.locator("#pause-overlay").isVisible();
  await page.evaluate(() => window.__OCEAN_GAME__.closePause());
  await page.evaluate(() => window.__OCEAN_GAME__.openCodex());
  const codexOpen = await page.locator("#codex-overlay").isVisible();
  await page.evaluate(() => window.__OCEAN_GAME__.closeCodex());
  await page.evaluate(() => window.__OCEAN_GAME__.returnToTitle());
  const titleVisible = await page.locator("#title-overlay").isVisible();
  await page.reload();
  await page.waitForTimeout(700);
  const restartStartVisible = await page.locator("#start-sailing").isVisible();
  if (restartStartVisible) await page.locator("#start-sailing").click();
  await page.waitForTimeout(500);
  const restartMode = await page.evaluate(
    () => window.__OCEAN_API__.phase8Qa.snapshot().mode,
  );
  return {
    desktop,
    mobile,
    transitions: {
      menuOpen,
      codexOpen,
      titleVisible,
      restartStartVisible,
      restartMode,
    },
    pageErrors,
  };
}

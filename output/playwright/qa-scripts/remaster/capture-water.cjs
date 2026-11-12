'use strict';
/*
 * RM2: 파도 세기 0.08 / 0.3 / 0.85에서 배·부표·유리병이 수면에 붙어 있는지 옆에서 찍는다.
 *   node capture-water.cjs [--seas 0.08,0.3,0.85] [--label after] [--w 960 --h 540]
 * 카메라는 수면 높이 근처에 두고(옛 추종 카메라 끔) 대상을 가까이서 본다. 대상과 배는 수집 반경 밖에 둔다.
 * 같은 시각에서 대상의 y와 수면 높이(waterY)의 차이를 숫자로도 기록한다(diff가 파도 세기와 무관하게 일정해야 한다).
 */
const fs = require('fs');
const { open, frames, startSailing, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const seas = arg('seas', '0.08,0.3,0.85').split(',').map(Number);
const label = arg('label', 'after');
const W = Number(arg('w', '960')), H = Number(arg('h', '540'));
(async () => {
  const { browser, page, errors } = await open({ width: W, height: H });
  await startSailing(page);
  await page.evaluate(() => {
    const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none';
    document.body.classList.add('nohud');
    const st = document.createElement('style');
    st.textContent = 'body.nohud .hud, body.nohud #control-layer, body.nohud .minimap-panel, body.nohud #world-labels, body.nohud #objective-chip, body.nohud #help-strip, body.nohud #game-toast, body.nohud #caption-strip, body.nohud #region-banner, body.nohud #remaster-region-art, body.nohud .collect-counter, body.nohud .action-cluster, body.nohud #effect-cue, body.nohud [id*="term"], body.nohud [class*="term-card"], body.nohud [class*="quest"], body.nohud [class*="chip"]{display:none!important}';
    document.head.appendChild(st);
  });
  const targets = await page.evaluate(() => {
    const g = window.__OCEAN_GAME__, T = window.THREE, m = new T.Matrix4();
    const find = (mesh, x, z) => { let best = null; for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); const px = m.elements[12], py = m.elements[13], pz = m.elements[14]; if (py < -100) continue; const d = Math.hypot(px - x, pz - z); if (!best || d < best.d) best = { i, x: px, z: pz, d }; } return best; };
    return { buoy: find(g.world.termBuoys.base, 0, -430), bottle: find(g.world.bottles.glass, 0, -430) };
  });
  const out = { targets, rows: [], errors: [] };
  const files = [];
  for (const sea of seas) {
    for (const kind of ['buoy', 'bottle', 'ship']) {
      const t = kind === 'ship' ? { x: targets.buoy.x + 70, z: targets.buoy.z - 40 } : targets[kind];
      await page.evaluate(({ sea, t, kind }) => {
        const g = window.__OCEAN_GAME__;
        g.atmosphere.forceSea = sea;
        g.updateCamera = () => {};
        // 수집 반경 밖(45칸)에 배를 두고, 배를 찍을 때는 배를 대상 자리에 둔다
        g.motion.x = kind === 'ship' ? t.x : t.x + 45; g.motion.z = t.z; g.motion.heading = -Math.PI / 2; g.motion.speed = 0;
        g.atmosphere.refresh(g.simTime, g.motion.x, g.motion.z);
        if (g.currentTerm) g.closeTermCard();
      }, { sea, t, kind });
      await frames(page, 30);
      const row = await page.evaluate(({ t, kind }) => {
        const g = window.__OCEAN_GAME__, api = window.__OCEAN_API__, T = window.THREE, m = new T.Matrix4();
        const sim = g.simTime, amp = api.waterVisualAmplitude();
        let y, water;
        if (kind === 'ship') { y = g.world.ship.position.y; water = api.waterY(g.motion.x, g.motion.z, sim); }
        else { const mesh = kind === 'buoy' ? g.world.termBuoys.base : g.world.bottles.glass; mesh.getMatrixAt(t.i, m); y = m.elements[13]; water = api.waterY(t.x, t.z, sim); }
        const tx = kind === 'ship' ? g.motion.x : t.x, tz = kind === 'ship' ? g.motion.z : t.z;
        // 카메라: 옆(-z)에서 수면 위 0.55, 대상을 본다
        const dist = kind === 'ship' ? 15 : 8;
        g.camera.position.set(tx + 1.5, water + 0.55, tz - dist);
        g.camera.lookAt(tx, water + (kind === 'ship' ? 1.6 : 0.9), tz);
        return { amplitude: +amp.toFixed(3), y: +y.toFixed(3), waterAtTarget: +water.toFixed(3), diff: +(y - water).toFixed(3), sim: +sim.toFixed(2), termOpen: Boolean(g.currentTerm) };
      }, { t, kind });
      await frames(page, 3);
      const file = outPath(`rm_RM2_side_${kind}_sea${sea}_${label}.png`);
      await page.screenshot({ path: file });
      files.push(file);
      out.rows.push({ sea, kind, ...row });
    }
  }
  out.errors = errors.slice(0, 8);
  out.files = files;
  fs.writeFileSync(outPath('rm2-water-contact.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.rows), 'errors', JSON.stringify(out.errors));
  await browser.close();
})();

'use strict';
/*
 * RM6 랜드마크 QA(해역 하나).
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm6-landmark.cjs --region 0 [--scenario all|normal|both|near|far] [--shots start,fixed,close,farN,farS]
 *
 * 시나리오(각각 새 페이지)
 *   normal : 원경·근경이 모두 올라오고, 원시 도형이 숨고, 충돌체가 발자국대로 더해지며, 실루엣·조명 캡처와 겹침 스캔·수집 점검을 한다.
 *   both   : 원경·근경 로드를 둘 다 실패시킨다 → 원시 도형이 그대로 보이고 충돌체는 더해지지 않는다(O-35).
 *   near   : 근경만 실패 → 원경 대역이 본 패스에 서고 원시 도형은 숨으며 충돌체는 없다.
 *   far    : 원경만 실패 → 근경이 서고 원시 도형은 숨으며 충돌체가 더해진다.
 * 실루엣은 게임 화면과 별개로 같은 카메라에서 검은 단색 재질로 따로 그린 것이고(흰 배경), 근경·원경 마스크의 IoU와 차이 지도도 만든다.
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const REGION = Number(arg('region', '0'));
const SCENARIOS = arg('scenario', 'all') === 'all' ? ['normal', 'both', 'near', 'far'] : [arg('scenario')];
const CENTERS = [[0, -430], [0, -260], [203, -162], [253, 58], [113, 234], [-113, 234], [-253, 58], [-203, -162], [0, 0]];
const W = 1280, H = 720;
const local = (rx, rz, h) => ({ x: CENTERS[REGION][0] + rx, z: CENTERS[REGION][1] + rz, h });
// 촬영 지점: 지역 좌표(해역 중심 기준). 해역마다 아래 표에서 고른다.
const SHOT_TABLE = {
  0: {
    start: { ...local(0, 0, 0), stage: 'near' },
    fixed: { ...POINTS[0], stage: 'near' },
    close: { ...local(0, 60, 0), stage: 'near' },
    farN: { x: 0, z: -262, h: Math.PI, stage: 'far' },
    farS: { ...local(0, -185, 0), stage: 'far' },
  },
};
// 해역 0 밖의 해역은 같은 규칙으로 촬영 지점을 만든다. 모든 샷은 겨냥점(AIM: 랜드마크 근경 경계의 중심, 해역 지역 좌표)을 바라본다.
//   fixed   : 고정 촬영 지점(POINTS)의 자리 그대로, 머리만 겨냥점 쪽으로 돌린다(근경 단계). 고정 지점의 기본 헤딩은 옛 도형 쪽이라 랜드마크가 시야 밖일 수 있다.
//   close   : 겨냥점에서 바깥으로 95 m(근경 단계)
//   farOut  : 겨냥점에서 바깥으로 200 m(원경 단계: 해역 중심에서 165~360 m)
// 0·8 사이에 낀 해역(1·8)은 이웃 해역과 겹치지 않는 방향(OUT_DIR)을 따로 준다.
const AIM = { 1: [5, -35], 2: [-1, 0], 3: [1, -1], 4: [-3.5, 4.4], 5: [-1.5, -9], 6: [0, 0], 7: [0, 0], 8: [0, 12.9] };
const OUT_DIR = { 1: [-0.8, -0.6], 8: [0.434, -0.901] };
const aim = AIM[REGION] || [0, 0];
const outward = (() => {
  const c = CENTERS[REGION], len = Math.hypot(c[0], c[1]);
  const d = OUT_DIR[REGION] || (len > 1 ? [c[0] / len, c[1] / len] : [0, -1]);
  return { dir: d, heading: Math.atan2(-d[0], -d[1]) };
})();
const aimWorld = { x: CENTERS[REGION][0] + aim[0], z: CENTERS[REGION][1] + aim[1] };
const along = (dist, stage) => ({ x: aimWorld.x + outward.dir[0] * dist, z: aimWorld.z + outward.dir[1] * dist, h: outward.heading, stage });
const facingAim = (p) => ({ x: p.x, z: p.z, h: Math.atan2(aimWorld.x - p.x, aimWorld.z - p.z) });
const SHOTS = SHOT_TABLE[REGION] || { fixed: { ...facingAim(POINTS[REGION]), stage: 'near' }, close: along(95, 'near'), farOut: along(200, 'far') };
const WANT = arg('shots', Object.keys(SHOTS).join(',')).split(',').filter((s) => SHOTS[s]);

// 페이지 안 도우미: 겹침 스캔·실루엣·수집 여유
const PAGE_HELPERS = () => {
  const THREE_ = window.THREE;
  const aliveDeep = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const label = (o, scene) => { const chain = []; for (let n = o; n && n !== scene; n = n.parent) chain.push(n.name || n.type); return chain.slice(0, 3).join('<'); };
  const rm6 = (window.__rm6 = {});

  // 배 발자국(헤딩 0의 AABB)과 겹치는 지역 메시를 삼각형 단위로 찾는다. 물선 위(y ≥ 0.15)만 센다.
  rm6.scanShipOverlap = () => {
    const g = window.__OCEAN_GAME__, ship = g.world.ship;
    ship.updateWorldMatrix(true, true);
    const hull = ship.getObjectByName('remaster-research-vessel') || ship;
    const hb = new THREE_.Box3().setFromObject(hull);
    const rect = { x0: hb.min.x, x1: hb.max.x, z0: hb.min.z, z1: hb.max.z, y1: hb.max.y };
    const corners = [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x1, rect.z1], [rect.x0, rect.z1]];
    const hit = (A, B, C) => {
      const minx = Math.min(A[0], B[0], C[0]), maxx = Math.max(A[0], B[0], C[0]), minz = Math.min(A[2], B[2], C[2]), maxz = Math.max(A[2], B[2], C[2]);
      if (maxx < rect.x0 || minx > rect.x1 || maxz < rect.z0 || minz > rect.z1) return false;
      if (Math.max(A[1], B[1], C[1]) < 0.15 || Math.min(A[1], B[1], C[1]) > rect.y1) return false;
      const P = [[A[0], A[2]], [B[0], B[2]], [C[0], C[2]]];
      for (let i = 0; i < 3; i++) {
        const a = P[i], b = P[(i + 1) % 3], nx = -(b[1] - a[1]), nz = b[0] - a[0];
        const tp = P.map((p) => nx * p[0] + nz * p[1]), tmin = Math.min(...tp), tmax = Math.max(...tp);
        const rp = corners.map((p) => nx * p[0] + nz * p[1]), rmin = Math.min(...rp), rmax = Math.max(...rp);
        if (tmax < rmin || rmax < tmin) return false;
      }
      return true;
    };
    const found = new Map(), solid = new Map();
    let meshes = 0, tests = 0;
    const m4 = new THREE_.Matrix4(), tmp = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const visit = (o, world) => {
      const geo = o.geometry, pos = geo && geo.attributes.position;
      if (!pos) return;
      const idx = geo.index, count = idx ? idx.count : pos.count, e = world.elements;
      for (let t = 0; t < count; t += 3) {
        for (let k = 0; k < 3; k++) {
          const v = idx ? idx.getX(t + k) : t + k, x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
          tmp[k][0] = e[0] * x + e[4] * y + e[8] * z + e[12];
          tmp[k][1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          tmp[k][2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        }
        tests++;
        if (hit(tmp[0], tmp[1], tmp[2])) {
          const key = label(o, g.world.scene) + (o.userData && o.userData.landmarkFallback ? '#' + o.userData.landmarkFallback : '');
          found.set(key, (found.get(key) || 0) + 1);
          const mat = Array.isArray(o.material) ? o.material[0] : o.material;
          if (!(mat && mat.transparent && mat.opacity < 0.9) && !(mat && mat.depthWrite === false)) solid.set(key, (solid.get(key) || 0) + 1);
        }
      }
    };
    g.world.regionGroups.forEach((group) => group.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || !aliveDeep(o) || !o.geometry) return;
      for (let n = o; n; n = n.parent) if (n === ship) return;
      meshes++;
      o.updateWorldMatrix(true, false);
      if (o.isInstancedMesh) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox, im = new THREE_.Matrix4(), box = new THREE_.Box3();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, im);
          m4.multiplyMatrices(o.matrixWorld, im);
          box.copy(bb).applyMatrix4(m4);
          if (box.max.x < rect.x0 || box.min.x > rect.x1 || box.max.z < rect.z0 || box.min.z > rect.z1) continue;
          visit(o, m4.clone());
        }
      } else {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        if (box.max.x < rect.x0 || box.min.x > rect.x1 || box.max.z < rect.z0 || box.min.z > rect.z1) return;
        visit(o, o.matrixWorld);
      }
    }));
    return { rect: Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, +v.toFixed(2)])), meshes, tests, any: [...found].map(([k, v]) => ({ mesh: k, tris: v })), solid: [...solid].map(([k, v]) => ({ mesh: k, tris: v })) };
  };

  // 같은 카메라에서 근경·원경을 검은 단색으로 따로 그려 PNG(base64)와 마스크 통계를 돌려준다.
  rm6.silhouettes = (regionIdx, w, h) => {
    const g = window.__OCEAN_GAME__, r = g.renderer, cam = g.camera;
    const entry = g.remaster.landmarks.entries.find((e) => e.spec.region === regionIdx);
    const render = (kind) => {
      const root = entry[kind].root;
      if (!root) return null;
      const scene = new THREE_.Scene();
      scene.background = new THREE_.Color(0xffffff);
      scene.overrideMaterial = new THREE_.MeshBasicMaterial({ color: 0x000000 });
      root.updateWorldMatrix(true, true);
      const clone = root.clone(true);
      clone.matrixAutoUpdate = false;
      clone.matrix.copy(root.matrixWorld);
      clone.traverse((o) => { o.visible = true; o.layers.set(0); });
      scene.add(clone);
      const rt = new THREE_.WebGLRenderTarget(w, h, { format: THREE_.RGBAFormat, type: THREE_.UnsignedByteType });
      const oc = new THREE_.Color(), oa = r.getClearAlpha(), ort = r.getRenderTarget(), oclip = r.clippingPlanes;
      r.getClearColor(oc);
      // 수면 아래(말뚝 밑동 등)는 게임 화면에서 물에 가려지므로 실루엣 비교에서 뺀다
      r.clippingPlanes = [new THREE_.Plane(new THREE_.Vector3(0, 1, 0), 0)];
      r.setRenderTarget(rt); r.setClearColor(0xffffff, 1); r.clear(); r.render(scene, cam);
      const buf = new Uint8Array(w * h * 4);
      r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      r.clippingPlanes = oclip;
      r.setRenderTarget(ort); r.setClearColor(oc, oa);
      rt.dispose(); scene.overrideMaterial.dispose();
      const mask = new Uint8Array(w * h);
      let black = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (buf[((h - 1 - y) * w + x) * 4] < 128) { mask[y * w + x] = 1; black++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      return { mask, black, bbox: black ? [x0, y0, x1, y1] : null };
    };
    const png = (draw) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) { const [R, G, B] = draw(i); img.data[i * 4] = R; img.data[i * 4 + 1] = G; img.data[i * 4 + 2] = B; img.data[i * 4 + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    };
    const near = render('near'), far = render('far');
    const out = { near: null, far: null, iou: null, nearPng: null, farPng: null, diffPng: null };
    if (near) { out.near = { coverage: near.black / (w * h), bbox: near.bbox }; out.nearPng = png((i) => (near.mask[i] ? [0, 0, 0] : [255, 255, 255])); }
    if (far) { out.far = { coverage: far.black / (w * h), bbox: far.bbox }; out.farPng = png((i) => (far.mask[i] ? [0, 0, 0] : [255, 255, 255])); }
    if (near && far) {
      let inter = 0, union = 0;
      for (let i = 0; i < w * h; i++) { const a = near.mask[i], b = far.mask[i]; if (a && b) inter++; if (a || b) union++; }
      out.iou = union ? inter / union : null;
      out.diffPng = png((i) => { const a = near.mask[i], b = far.mask[i]; return a && b ? [0, 0, 0] : a ? [40, 90, 230] : b ? [230, 60, 50] : [255, 255, 255]; });
    }
    return out;
  };

  // 해역의 부표·병이 런타임 충돌체(r+4) 밖에 있는지 여유를 잰다.
  rm6.collectables = (regionIdx) => {
    const g = window.__OCEAN_GAME__, pts = [];
    TERM_BUOY_SPECS.filter((s) => s.term.region === regionIdx).forEach((s) => pts.push({ kind: 'term', id: s.term.id, x: s.x, z: s.z }));
    BOTTLE_SPECS.filter((s) => s.region === regionIdx).forEach((s) => pts.push({ kind: 'bottle', id: s.id, x: s.x, z: s.z }));
    return pts.map((p) => {
      let worst = Infinity, who = null;
      for (const c of g.world.colliders) { const d = Math.hypot(p.x - c.x, p.z - c.z) - (c.r + 4); if (d < worst) { worst = d; who = c.landmark || 'static'; } }
      return { ...p, clearance: +worst.toFixed(2), who };
    });
  };

  // 해역의 용어·병을 실제 수집 경로로 모두 거둬 본다(월드 규칙을 몇 번 돌려 밀려나지 않는지도 본다).
  rm6.journey = (regionIdx) => {
    const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__, rows = [], missed = [];
    const closeAll = () => { if (g.currentTerm) g.closeTermCard(); if (MODE.current === 'DIALOG') g.closeKeeperDialogue(); };
    const settleAt = (x, z) => {
      g.motion.speed = 0; g.motion.x = x; g.motion.z = z;
      for (let i = 0; i < 12; i++) g.applyWorldRules(0.05);
      return Math.hypot(g.motion.x - x, g.motion.z - z);
    };
    for (const term of a.TERMS) {
      if (term.region !== regionIdx || term.rarity === 'rare') continue;
      const spawn = a.contentQa.term(term.id).spawn;
      if (!spawn) { missed.push({ id: term.id, why: 'no spawn' }); continue; }
      const moved = settleAt(spawn.x, spawn.z);
      g.currentRegion = regionIdx;
      const had = SAVE.progress.termsFound.includes(term.id);
      g.checkTermDiscovery(1);
      const has = SAVE.progress.termsFound.includes(term.id);
      closeAll();
      rows.push({ id: term.id, kind: 'term', moved: +moved.toFixed(2), had, has });
      if (!has) missed.push({ id: term.id, why: 'term not found' });
    }
    for (const spec of BOTTLE_SPECS) {
      if (spec.region !== regionIdx) continue;
      const moved = settleAt(spec.x, spec.z);
      g.currentRegion = regionIdx;
      const had = SAVE.progress.bottlesOpened.includes(spec.id);
      g.bottleClock = 1; g.checkBottleDiscovery(1);
      const has = SAVE.progress.bottlesOpened.includes(spec.id);
      closeAll();
      rows.push({ id: spec.id, kind: 'bottle', moved: +moved.toFixed(2), had, has });
      if (!has) missed.push({ id: spec.id, why: 'bottle not opened' });
    }
    return { rows, missed };
  };

  // 로드된 루트의 삼각형·재질·노드 수(데이터 표와 대조)
  rm6.rootStats = (regionIdx, kind) => {
    const g = window.__OCEAN_GAME__, entry = g.remaster.landmarks.entries.find((e) => e.spec.region === regionIdx), root = entry[kind].root;
    if (!root) return null;
    let tris = 0, meshes = 0;
    const mats = new Set();
    root.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; mats.add(o.material.uuid); } });
    return { tris, meshes, materials: mats.size, visible: root.visible, name: root.name };
  };
};

const hideHud = (page) => page.evaluate(() => {
  const st = document.createElement('style');
  st.textContent = '#qa-hud,.hud,#control-layer,.minimap-panel,#world-labels,#objective-chip,#help-strip,#game-toast,#caption-strip,#region-banner,.collect-counter,.action-cluster,#effect-cue,#remaster-region-art{display:none!important}';
  document.head.appendChild(st);
});

// 조건이 참이 될 때까지 기다린다(프레임 단위 폴링). 시간 초과면 마지막 값을 돌려준다.
async function waitFor(page, fn, arg, maxMs = 90000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < maxMs) {
    last = await page.evaluate(fn, arg);
    if (last && last.ok) return { ...last, waitedMs: Date.now() - t0 };
    await frames(page, 3);
  }
  return { ...(last || {}), ok: false, waitedMs: Date.now() - t0, timeout: true };
}

// 실패 시나리오는 모델 요청 자체를 끊어서(네트워크 실패) 로더의 오류 경로를 탄다. 파일 이름은 데이터 표(assets/remaster/models/landmark-<id>[-far].glb)와 같다.
const IDS = { 0: 'r0-staff-gate', 1: 'r1-tempo-tower', 2: 'r2-storm-drum', 3: 'r3-dynamics-canyon', 4: 'r4-fermata-bridge', 5: 'r5-scale-lights', 6: 'r6-chord-spires', 7: 'r7-key-ring', 8: 'r8-repeat-gate' };
const failRoutes = (name) => async (page) => {
  const stem = `landmark-${arg('id', IDS[REGION])}`;
  if (name === 'both' || name === 'near') await page.route(`**/${stem}.glb`, (route) => route.abort('failed'));
  if (name === 'both' || name === 'far') await page.route(`**/${stem}-far.glb`, (route) => route.abort('failed'));
};
async function scenario(name) {
  const { browser, page, errors, requests } = await open({ query: '?qa=1', width: W, height: H, before: failRoutes(name) });
  const res = { scenario: name, shots: {}, checks: {} };
  try {
    await startSailing(page);
    await page.evaluate(PAGE_HELPERS);
    await hideHud(page);
    const spec = await page.evaluate((r) => { const s = REMASTER_LANDMARKS.find((e) => e.region === r); return s ? JSON.parse(JSON.stringify(s)) : null; }, REGION);
    if (!spec) throw new Error('이 해역의 랜드마크 데이터가 없습니다: ' + REGION);
    res.spec = { id: spec.id, name: spec.name, near: spec.near, far: spec.far, footprints: spec.footprints, hide: spec.hide, hideProps: spec.hideProps };
    const t0 = Date.now();
    await page.evaluate(async () => { const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__; await g.remaster.start(); a.vfxQa.setTimeOfDay(0.25); g.applyQualityProfile('mid', false); });
    res.remasterReadyMs = Date.now() - t0;

    const first = SHOTS[WANT[0]];
    for (const id of WANT) {
      const shot = SHOTS[id];
      await teleport(page, shot, { settle: 6 });
      // 단계가 맞고(그 단계에서 필요한 모델이 준비되었거나 실패로 확정될 때까지) 기다린다
      const state = await waitFor(page, ({ r, stage, scenario }) => {
        const e = window.__OCEAN_GAME__.remaster.landmarks.entries.find((x) => x.spec.region === r);
        const settled = (s) => s === 'ready' || s === 'failed';
        const ok = e.stage === stage && settled(e.far.status) && (stage === 'far' || settled(e.near.status));
        return { ok, stage: e.stage, far: e.far.status, near: e.near.status, scenario };
      }, { r: REGION, stage: shot.stage, scenario: name });
      await frames(page, 6);
      const row = { shot: id, stage: state.stage, far: state.far, near: state.near, waitedMs: state.waitedMs };
      row.snapshot = await page.evaluate((r) => window.__OCEAN_API__.remasterQa.landmarks().entries.find((e) => e.region === r), REGION);
      row.litFile = outPath(`rm6_r${REGION}_${name}_${id}_lit.png`);
      await page.screenshot({ path: row.litFile });
      if (name === 'normal') {
        const s = await page.evaluate(({ r, w, h }) => window.__rm6.silhouettes(r, w, h), { r: REGION, w: W, h: H });
        row.sil = { near: s.near, far: s.far, iou: s.iou };
        for (const [k, key] of [['near', 'nearPng'], ['far', 'farPng'], ['diff', 'diffPng']]) if (s[key]) { row[k + 'File'] = outPath(`rm6_r${REGION}_${id}_sil_${k}.png`); fs.writeFileSync(row[k + 'File'], Buffer.from(s[key], 'base64')); }
      }
      res.shots[id] = row;
    }
    void first;

    // 해역 상태 요약
    res.final = await page.evaluate((r) => window.__OCEAN_API__.remasterQa.landmarks(), REGION);
    if (name === 'normal') {
      await teleport(page, SHOTS[WANT.includes('start') ? 'start' : WANT[0]], { settle: 4 });
      await waitFor(page, ({ r }) => { const e = window.__OCEAN_GAME__.remaster.landmarks.entries.find((x) => x.spec.region === r); return { ok: e.near.status === 'ready' && e.far.status === 'ready' }; }, { r: REGION });
      res.rootStats = { near: await page.evaluate((r) => window.__rm6.rootStats(r, 'near'), REGION), far: await page.evaluate((r) => window.__rm6.rootStats(r, 'far'), REGION) };
      res.colliders = await page.evaluate((r) => window.__OCEAN_GAME__.world.colliders.filter((c) => c.landmark && c.region === r).map((c) => ({ region: c.region, x: c.x, z: c.z, r: c.r, landmark: c.landmark })), REGION);
      if (REGION === 0 && SHOTS.start) {
        // 시작 위치에서 배가 겹치는 메시: 랜드마크가 올라온 상태, 그리고 원시 도형을 강제로 보이게 한 기준선(스캔이 실제로 잡는지 확인)
        await teleport(page, SHOTS.start, { settle: 4 });
        res.overlapNormal = await page.evaluate(() => window.__rm6.scanShipOverlap());
        res.overlapBaseline = await page.evaluate((r) => {
          const e = window.__OCEAN_GAME__.remaster.landmarks.entries.find((x) => x.spec.region === r);
          e.fallback.forEach((m) => (m.visible = true));
          const scan = window.__rm6.scanShipOverlap();
          e.fallback.forEach((m) => (m.visible = false));
          return scan;
        }, REGION);
      }
      res.collectables = await page.evaluate((r) => window.__rm6.collectables(r), REGION);
      res.journey = await page.evaluate((r) => window.__rm6.journey(r), REGION);
    }
    if (name === 'normal') {
      // 지점에서 한 번 더: 근경 단계에서 렌더 통계(예산 점검 보조)
      await teleport(page, SHOTS[WANT[0]], { settle: 6 });
      res.passes = await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.renderFrame(); return g.renderStats.snapshot(); });
    }
  } catch (e) {
    res.exception = String((e && e.stack) || e).slice(0, 800);
  }
  res.errors = errors.slice(0, 6);
  res.externalRequests = requests.filter((u) => !/three(\.min)?\.js/.test(u));
  await browser.close();
  return res;
}

(async () => {
  const results = [];
  for (const name of SCENARIOS) {
    const r = await scenario(name);
    results.push(r);
    console.log(`[${name}] ${r.exception ? 'EXCEPTION ' + r.exception : 'done'} · 오류 ${r.errors.length}`);
  }
  // 게이트 판정
  const by = Object.fromEntries(results.map((r) => [r.scenario, r]));
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  const spec = (results[0] && results[0].spec) || null;
  const lastShot = (r, id) => r && r.shots && r.shots[id];
  const n = by.normal;
  if (n) {
    const startShot = n.shots.start || n.shots[WANT[0]];
    add('normal: 근경·원경 모두 로드됨', startShot && startShot.far === 'ready' && startShot.near === 'ready', startShot && { far: startShot.far, near: startShot.near, waitedMs: startShot.waitedMs });
    const ent = n.final && n.final.entries.find((e) => e.region === REGION);
    add('normal: 원시 도형이 전부 숨음', ent && ent.primitives > 0 && ent.primitivesHidden === ent.primitives, ent && { primitives: ent.primitives, hidden: ent.primitivesHidden });
    add('normal: 충돌체가 발자국 수만큼 더해짐', ent && ent.colliders === spec.footprints.length && n.colliders && n.colliders.length === spec.footprints.length, n.colliders);
    const rs = n.rootStats;
    add('normal: 로드된 근경 삼각형 = 데이터 표', rs && rs.near && rs.near.tris === spec.near.tris, rs && rs.near && { loaded: rs.near.tris, table: spec.near.tris, meshes: rs.near.meshes, materials: rs.near.materials });
    add('normal: 로드된 원경 삼각형 = 데이터 표', rs && rs.far && rs.far.tris === spec.far.tris, rs && rs.far && { loaded: rs.far.tris, table: spec.far.tris, meshes: rs.far.meshes, materials: rs.far.materials });
    add('예산: 근경 ≤ 30,000 · 원경 ≤ 6,000 · 원경 ≤ 근경의 20%', spec.near.tris <= 30000 && spec.far.tris <= 6000 && spec.far.tris <= spec.near.tris * 0.2, { near: spec.near.tris, far: spec.far.tris, ratio: +(spec.far.tris / spec.near.tris).toFixed(3) });
    const sils = WANT.map((id) => [id, n.shots[id] && n.shots[id].sil]).filter(([, s]) => s);
    add('실루엣: 지점마다 근경 실루엣이 화면에 보임(≥ 0.3% 면적)', sils.length > 0 && sils.filter(([id]) => SHOTS[id].stage === 'near').every(([, s]) => s.near && s.near.coverage >= 0.003), sils.map(([id, s]) => ({ id, nearCoverage: s.near && +s.near.coverage.toFixed(4), farCoverage: s.far && +s.far.coverage.toFixed(4), iou: s.iou && +s.iou.toFixed(3) })));
    add('원경 대역이 근경 실루엣을 그대로 닮음(IoU ≥ 0.75, 근경 지점)', sils.filter(([id]) => SHOTS[id].stage === 'near').every(([, s]) => s.iou !== null && s.iou >= 0.75), sils.map(([id, s]) => ({ id, iou: s.iou && +s.iou.toFixed(3) })));
    if (REGION === 0 && n.overlapNormal) {
      add('해역 0: 시작 위치에서 배가 겹치는 고체 메시 없음', n.overlapNormal.solid.length === 0, { normal: n.overlapNormal.solid, anyIncludingTransparent: n.overlapNormal.any, rect: n.overlapNormal.rect });
      add('해역 0: 기준선(원시 도형 복구)에서는 스캔이 부두를 잡음(스캔 유효성)', n.overlapBaseline.solid.some((x) => /pier/.test(x.mesh)), n.overlapBaseline.solid);
    }
    add('수집: 부표·병 모두 충돌체 밖(여유 ≥ 4 m)', n.collectables && n.collectables.length > 0 && n.collectables.every((c) => c.clearance >= 4), n.collectables && { count: n.collectables.length, minClearance: Math.min(...n.collectables.map((c) => c.clearance)), nearest: n.collectables.slice().sort((a, b) => a.clearance - b.clearance).slice(0, 3) });
    add('수집: 용어·병 전부 수집되고 월드 규칙에 밀려나지 않음(< 0.5 m)', n.journey && n.journey.missed.length === 0 && n.journey.rows.length > 0 && n.journey.rows.every((r) => r.moved < 0.5), n.journey && { rows: n.journey.rows.length, missed: n.journey.missed, maxMoved: Math.max(...n.journey.rows.map((r) => r.moved)) });
    if (n.passes) add('예산 참고: 근경 지점 합계 호출·삼각형', true, { calls: n.passes.total.calls, tris: n.passes.total.triangles, shadow: n.passes.shadow, reflection: n.passes.reflection, main: n.passes.main });
  }
  // 실패 시나리오는 거리 단계별로 본다: 근경 단계(≤153 m)와 원경 단계(≤360 m)에서 보여줄 모델이 다르다.
  //   · 둘 다 실패: 어느 단계에서도 원시 도형이 그대로 보이고 충돌체가 없다.
  //   · 근경만 실패: 두 단계 모두 원경 대역이 원시 도형을 대신하고(본 패스), 충돌체는 없다.
  //   · 원경만 실패: 근경 단계에서는 근경이 서서 원시 도형을 대신하고 충돌체가 더해진다. 원경 단계로 물러나면
  //     보여줄 모델이 없으니 원시 도형이 돌아온다(설계: 로드 실패 시 기존 도형 유지). 충돌체는 근경이 올라온 뒤로 남는다.
  const shotsAt = (r, stage) => WANT.filter((id) => SHOTS[id].stage === stage).map((id) => ({ id, ...r.shots[id] })).filter((s) => s.snapshot);
  for (const sc of ['both', 'near', 'far']) {
    const r = by[sc];
    if (!r) continue;
    const nearShots = shotsAt(r, 'near'), farShots = shotsAt(r, 'far');
    const brief = (list) => list.map((s) => ({ shot: s.id, far: s.far, near: s.near, hidden: s.snapshot.primitivesHidden, primitives: s.snapshot.primitives, colliders: s.snapshot.colliders }));
    if (sc === 'both') {
      const all = nearShots.concat(farShots);
      add('both: 둘 다 실패해도 원시 도형이 그대로 보이고 충돌체가 없음(모든 단계)', all.length > 0 && all.every((s) => s.far === 'failed' && s.near === 'failed' && s.snapshot.primitivesHidden === 0 && s.snapshot.colliders === 0) && r.final.failures >= 2, { shots: brief(all), failures: r.final.failures });
    }
    if (sc === 'near') {
      const all = nearShots.concat(farShots);
      add('near 실패: 원경 대역이 본 패스에 서서 원시 도형을 대신하고 충돌체는 없음(모든 단계)', all.length > 0 && all.every((s) => s.far === 'ready' && s.near === 'failed' && s.snapshot.primitivesHidden === s.snapshot.primitives && s.snapshot.colliders === 0), brief(all));
    }
    if (sc === 'far') {
      add('far 실패(근경 단계): 근경이 서서 원시 도형을 대신하고 충돌체가 더해짐', nearShots.length > 0 && nearShots.every((s) => s.far === 'failed' && s.near === 'ready' && s.snapshot.primitivesHidden === s.snapshot.primitives && s.snapshot.colliders === spec.footprints.length), brief(nearShots));
      add('far 실패(원경 단계): 보여줄 모델이 없으면 원시 도형이 돌아옴', farShots.length > 0 && farShots.every((s) => s.far === 'failed' && s.snapshot.primitivesHidden === 0), brief(farShots));
    }
  }
  // 실패 시나리오에서는 끊은 요청 때문에 브라우저가 남기는 "Failed to load resource"만 의도된 오류로 본다.
  const expected = (r, m) => r.scenario !== 'normal' && /Failed to load resource|net::ERR_FAILED/.test(m);
  add('콘솔 오류 없음(정상 시나리오는 하나도 없어야 하고, 실패 시나리오는 끊은 요청 로그만 허용)', results.every((r) => r.errors.filter((m) => !expected(r, m)).length === 0 && !r.exception), results.map((r) => ({ scenario: r.scenario, errors: r.errors, exception: r.exception })));
  add('외부 요청 없음(three CDN 대신 로컬 응답만)', results.every((r) => r.externalRequests.length === 0), results.map((r) => r.externalRequests));
  const gate = checks.every((c) => c.ok);
  for (const c of checks) console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.ok ? '' : '\n     ' + JSON.stringify(c.detail).slice(0, 700)));
  console.log('GATE', gate ? 'PASS' : 'FAIL');
  fs.writeFileSync(outPath(`rm6-landmark-r${REGION}.json`), JSON.stringify({ region: REGION, gate, checks, results }, null, 1));
  process.exit(gate ? 0 : 1);
})();

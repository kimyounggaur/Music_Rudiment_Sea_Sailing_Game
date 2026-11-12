'use strict';
/*
 * RM6-d 음악 연동 라이브 검사(8.6절): 랜드마크 모델의 Beat_·Glow_·Lantern_·Sway_ 노드가 음악 값에 반응하는지 실제 페이지에서 본다.
 *   cd /home/claude/remaster/game && node output/playwright/qa-scripts/remaster/rm6-music.cjs [--regions 0,1,2,3,4,5,6,7,8] [--shots 1]
 *
 * 방법: 오디오 엔진이 만든 값(latestContext)을 읽는 쪽에서만 덮어쓰고(쓰는 쪽은 그대로), 큐는 구동기에 직접 알린 뒤,
 *       시계를 얼려(렌더 루프가 구동기를 부르지 않게) 구동기를 한 걸음씩 직접 돌려 노드 값을 읽는다 → 결정적.
 * 검사: (1) 음악 목표가 가리키는 노드가 모두 모델에 있고, 모델의 음악 노드도 모두 목표가 있다(1:1)
 *       (2) 해역별 반응 수치  (3) 감소된 모션에서는 움직임이 멎는다  (4) 원경 대역의 발광은 쉬는 값으로 고정
 *       (5) 메트로놈 주기·박 큐 위상 보정(독립 인스턴스)  (6) 음계 해협: 오디오의 "가장 가까운 등대"가 등대 좌표와 같다
 *       (7) 먼 거리에서는 갱신 비용이 없다  (8) 큐 → 구동기 연결(consumeMusic)
 */
const fs = require('fs');
const { open, frames, startSailing, teleport, POINTS, outPath } = require('./lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const REGIONS = arg('regions', '0,1,2,3,4,5,6,7,8').split(',').map(Number);
const SHOTS = arg('shots', '1') !== '0';
const CENTERS = [[0, -430], [0, -260], [203, -162], [253, 58], [113, 234], [-113, 234], [-253, 58], [-203, -162], [0, 0]];
const W = 1280, H = 720;

// 촬영 자리: 랜드마크 겨냥점에서 바깥으로 95 m(rm6-landmark.cjs와 같은 규칙) 또는 해역별 가까운 자리
const AIM = { 1: [5, -35], 2: [-1, 0], 3: [1, -1], 4: [-3.5, 4.4], 5: [-1.5, -9], 6: [0, 0], 7: [0, 0], 8: [0, 12.9] };
const OUT_DIR = { 1: [-0.8, -0.6], 8: [0.434, -0.901] };
const outwardOf = (r) => { const c = CENTERS[r], len = Math.hypot(c[0], c[1]); return OUT_DIR[r] || (len > 1 ? [c[0] / len, c[1] / len] : [0, -1]); };
const closeShot = (r) => {
  if (r === 0) return { x: 0, z: -430 + 60, h: 0 };
  const d = outwardOf(r), a = AIM[r] || [0, 0];
  return { x: CENTERS[r][0] + a[0] + d[0] * 95, z: CENTERS[r][1] + a[1] + d[1] * 95, h: Math.atan2(-d[0], -d[1]) };
};
// 해역마다 "움직이는 부품"이 잘 보이는 가까운 자리(해역 지역 좌표의 초점, 초점에서 from 방향으로 dist m)
const VIEW = {
  1: { focus: [50, -22], from: [0, -1], dist: 36 },
  2: { focus: [-58, 8], from: [0.35, -0.94], dist: 52 },
  5: { focus: [-6, 0], from: [0, 1], dist: 42 },
};
const viewShot = (r) => {
  const v = VIEW[r];
  if (!v) return closeShot(r);
  const x = CENTERS[r][0] + v.focus[0] + v.from[0] * v.dist, z = CENTERS[r][1] + v.focus[1] + v.from[1] * v.dist;
  return { x, z, h: Math.atan2(CENTERS[r][0] + v.focus[0] - x, CENTERS[r][1] + v.focus[1] - z) };
};

// 페이지 안 도우미
const PAGE = () => {
  const g = window.__OCEAN_GAME__;
  const m = (window.__rm6m = {});
  const mu = g.remaster.landmarks.music, orig = mu.update.bind(mu);
  let real = g.audio.latestContext;
  window.__fakeCtx = null;
  Object.defineProperty(g.audio, 'latestContext', { configurable: true, get: () => window.__fakeCtx || real, set: (v) => { real = v; } });
  window.__freeze = false;
  // 얼린 동안에는 렌더 루프의 갱신과 오디오 엔진의 실제 큐가 구동기에 닿지 않게 막는다(검사 격리). 검사는 원래 함수(orig·origCue)를 직접 부른다.
  const origCue = mu.onCue.bind(mu);
  mu.update = (t) => { if (!window.__freeze) orig(t); };
  mu.onCue = (cue, plan, time) => { if (!window.__freeze) origCue(cue, plan, time); };
  const entry = (r) => g.remaster.landmarks.entries.find((e) => e.spec.region === r);
  const item = (r, name, kind = 'near') => { const b = mu.bound.get(entry(r).spec.id); return b && b[kind] && b[kind].get(name); };
  m.entry = entry;
  m.freeze = () => { window.__freeze = true; m.t = g.simTime; mu.lastTime = m.t; mu.events = { beatAt: -Infinity, flashAt: -Infinity, degree: null, degreeAt: -Infinity, pearls: 0, pearlAt: -Infinity, bar: null, barAt: -Infinity }; };
  m.thaw = () => { window.__freeze = false; window.__fakeCtx = null; };
  m.step = (dt = 0.05, n = 1) => { for (let i = 0; i < n; i++) { m.t += dt; orig(m.t); } return m.t; };
  m.cue = (cue) => origCue(cue, musicVisualPlan(cue), m.t);
  m.setCtx = (r, patch) => { const base = g.audio.deriveRegionContext({ region: r, x: g.motion.x, z: g.motion.z, anchored: false }); window.__fakeCtx = Object.assign(base, patch || {}); };
  m.clearCtx = () => { window.__fakeCtx = null; };
  m.ratio = (r, name, kind = 'near') => { const it = item(r, name, kind); return it && it.material ? +(it.material.emissiveIntensity / it.base).toFixed(4) : null; };
  m.angle = (r, name) => { const it = item(r, name); return it ? +(it.node.rotation.z - it.home.rz).toFixed(4) : null; };
  m.drop = (r, name) => { const it = item(r, name); return it ? +(it.home.y - it.node.position.y).toFixed(4) : null; };
  m.rotY = (r, name) => { const it = item(r, name); return it ? it.node.rotation.y : null; };
  m.reduced = (on) => { SAVE.settings.reducedMotion = Boolean(on); };
  m.names = (r, kind = 'near') => { const b = mu.bound.get(entry(r).spec.id); return b && b[kind] ? [...b[kind].keys()].sort() : []; };
  m.targetNames = (r) => Object.keys(landmarkMusicTargets(r, mu.state(r, null, 0, false))).sort();
  m.farRatios = (r) => { const b = mu.bound.get(entry(r).spec.id); return b && b.far ? [...b.far.values()].filter((it) => it.material).map((it) => +(it.material.emissiveIntensity / it.base).toFixed(4)) : []; };
  m.snapshot = () => mu.snapshot();
  m.ready = (r) => { const e = entry(r); return { stage: e.stage, near: e.near.status, far: e.far.status, visible: Boolean(e.near.root && e.near.root.visible) }; };
  // 독립 인스턴스(렌더와 무관): 메트로놈 주기와 박 큐 위상 보정
  m.metronome = () => {
    const fake = (bpm) => new LandmarkMusic({ game: { audio: { latestContext: { region: 1, bpm } } }, entries: [] });
    const out = { cycles: [], lock: null };
    for (const bpm of [40, 60, 96, 120, 180]) {
      const inst = fake(bpm);
      let t = 0;
      inst.update(t);
      let travelled = 0, last = inst.phase;
      for (let i = 0; i < 200; i++) { t += 0.05; inst.update(t); travelled += (inst.phase - last + 1) % 1; last = inst.phase; }
      out.cycles.push({ bpm, seconds: 10, expected: +(bpm / 60 * 10).toFixed(3), measured: +travelled.toFixed(3), period: +inst.period.toFixed(4) });
    }
    const inst = fake(100);
    inst.phase = 0.6;
    const seq = [inst.phase];
    for (let i = 0; i < 8; i++) { inst.onCue({ region: 1, beat: true, bpm: 100 }, musicVisualPlan({ region: 1, bpm: 100 }), i * 0.6); seq.push(+inst.phase.toFixed(4)); }
    out.lock = { start: 0.6, seq, locks: inst.locks };
    out.wrap = [0.76, 0.74].map((start) => { // 0.25에서 0.5 떨어진 두 위상: 가까운 쪽으로 35% 이동(0.76은 앞으로 넘어가고 0.74는 뒤로 간다)
      const inst2 = fake(100);
      inst2.phase = start;
      inst2.onCue({ region: 1, beat: true, bpm: 100 }, musicVisualPlan({ region: 1, bpm: 100 }), 0);
      return { start, end: +inst2.phase.toFixed(4) };
    });
    return out;
  };
};

const hideHud = (page) => page.evaluate(() => {
  const st = document.createElement('style');
  st.textContent = '#qa-hud,.hud,#control-layer,.minimap-panel,#world-labels,#objective-chip,#help-strip,#game-toast,#caption-strip,#region-banner,.collect-counter,.action-cluster,#effect-cue,#remaster-region-art{display:none!important}';
  document.head.appendChild(st);
});

async function waitFor(page, fn, arg2, maxMs = 120000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < maxMs) {
    last = await page.evaluate(fn, arg2);
    if (last && last.ok) return { ...last, waitedMs: Date.now() - t0 };
    await frames(page, 3);
  }
  return { ...(last || {}), ok: false, waitedMs: Date.now() - t0, timeout: true };
}

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n     ' + JSON.stringify(detail))); };
const near = (a, b, tol = 0.02) => a !== null && b !== null && Math.abs(a - b) <= tol;

// 해역별 시나리오. page는 near 단계가 준비되었고 시계가 얼어 있다. 값은 page.evaluate 안에서 직접 읽는다.
const REGION_TESTS = {
  0: async (page) => {
    const a = await page.evaluate(() => { const m = window.__rm6m; m.setCtx(0); m.step(0.05, 3); const r = { clef: m.ratio(0, 'Glow_clef'), notes: m.ratio(0, 'Lantern_notes') }; m.reduced(true); m.step(0.3, 1); const x = { clef: m.ratio(0, 'Glow_clef'), notes: m.ratio(0, 'Lantern_notes') }; m.step(0.7, 1); const y = { clef: m.ratio(0, 'Glow_clef'), notes: m.ratio(0, 'Lantern_notes') }; m.reduced(false); return { normal: r, reducedA: x, reducedB: y }; });
    check('r0 높은음자리표·음표 등불이 숨 쉰다(0.35~0.95)', a.normal.clef >= 0.35 && a.normal.clef <= 0.95 && a.normal.notes >= 0.35 && a.normal.notes <= 0.95, a);
    check('r0 감소된 모션이면 0.8로 고정(시간이 지나도 변하지 않음)', near(a.reducedA.clef, 0.8, 0.001) && near(a.reducedB.clef, 0.8, 0.001) && near(a.reducedA.notes, 0.8, 0.001) && near(a.reducedB.notes, 0.8, 0.001), a);
  },
  1: async (page) => {
    const a = await page.evaluate(() => {
      const m = window.__rm6m;
      m.setCtx(1, { bpm: 120 });
      const angles = [], lamps = [];
      for (let i = 0; i < 12; i++) { m.step(0.05); angles.push(m.angle(1, 'Beat_pendulum')); lamps.push(m.ratio(1, 'Lantern_tempo')); }
      m.reduced(true); m.step(0.1, 2);
      const red = { angle: m.angle(1, 'Beat_pendulum'), lamp: m.ratio(1, 'Lantern_tempo') };
      m.reduced(false);
      return { angles, lamps, red, metronome: m.metronome() };
    });
    const lo = Math.min(...a.angles), hi = Math.max(...a.angles);
    check('r1 진자가 ±0.5 rad 안에서 흔들린다(한 주기 동안 폭 ≥ 0.5)', hi <= 0.5001 && lo >= -0.5001 && hi - lo >= 0.5, { lo, hi });
    check('r1 케이스 등이 한쪽 끝에서만 반짝인다(최대 > 0.8, 최소 < 0.5)', Math.max(...a.lamps) > 0.8 && Math.min(...a.lamps) < 0.5, a.lamps);
    check('r1 감소된 모션이면 진자 정지(각 0)·등 0.7', near(a.red.angle, 0, 0.0001) && near(a.red.lamp, 0.7, 0.001), a.red);
    const cyc = a.metronome.cycles;
    check('r1 메트로놈 주기 = 60/bpm(10초 동안 bpm/60×10 주기, 40~180 bpm)', cyc.every((c) => Math.abs(c.measured - c.expected) < 0.01), cyc);
    check('r1 박 큐가 진자 위상을 0.25(오른쪽 끝)로 끌어당긴다(8박 뒤 ±0.02)', Math.abs(a.metronome.lock.seq[8] - 0.25) < 0.02 && a.metronome.lock.locks === 8, a.metronome.lock);
    check('r1 위상 보정은 가까운 쪽으로 돈다(0.76 → 0.9315 앞으로, 0.74 → 0.5685 뒤로)', near(a.metronome.wrap[0].end, 0.9315, 0.001) && near(a.metronome.wrap[1].end, 0.5685, 0.001), a.metronome.wrap);
  },
  2: async (page) => {
    const a = await page.evaluate(() => {
      const m = window.__rm6m;
      m.setCtx(2);
      m.step(0.05, 2);
      const rest = { drop: m.drop(2, 'Beat_head'), rim: m.ratio(2, 'Glow_rim'), arc: m.ratio(2, 'Glow_arc') };
      m.cue({ region: 2, beat: true });
      m.step(0.05);
      const hit = { drop: m.drop(2, 'Beat_head'), rim: m.ratio(2, 'Glow_rim'), arc: m.ratio(2, 'Glow_arc') };
      m.step(0.6);
      const after = { drop: m.drop(2, 'Beat_head'), rim: m.ratio(2, 'Glow_rim') };
      m.cue({ region: 2, lightning: true });
      m.step(0.05);
      const bolt = { arc: m.ratio(2, 'Glow_arc'), drop: m.drop(2, 'Beat_head') };
      m.step(0.7);
      const boltAfter = { arc: m.ratio(2, 'Glow_arc') };
      m.reduced(true);
      m.cue({ region: 2, beat: true });
      m.cue({ region: 2, lightning: true });
      m.step(0.05);
      const red = { drop: m.drop(2, 'Beat_head'), arc: m.ratio(2, 'Glow_arc') };
      m.reduced(false);
      return { rest, hit, after, bolt, boltAfter, red };
    });
    check('r2 쉬는 값: 가죽 안 눌림 · 테 0.2 · 피뢰침 0.3', a.rest.drop === 0 && near(a.rest.rim, 0.2, 0.001) && near(a.rest.arc, 0.3, 0.001), a.rest);
    check('r2 강박 큐 직후 가죽이 눌리고(≥ 0.5 m) 테가 밝아진다(≥ 1.0)', a.hit.drop >= 0.5 && a.hit.drop <= 0.8001 && a.hit.rim >= 1.0, a.hit);
    check('r2 강박 0.65초 뒤 원래대로(가죽 0 · 테 0.2)', a.after.drop === 0 && near(a.after.rim, 0.2, 0.001), a.after);
    check('r2 엇박 번개 큐에 피뢰침 끝이 번쩍이고(≥ 1.0) 가죽은 그대로', a.bolt.arc >= 1.0 && a.bolt.drop === 0 && near(a.boltAfter.arc, 0.3, 0.001), { bolt: a.bolt, after: a.boltAfter });
    check('r2 감소된 모션이면 가죽이 눌리지 않고 번쩍임이 약하다(피뢰침 ≤ 0.8)', a.red.drop === 0 && a.red.arc <= 0.8, a.red);
  },
  3: async (page) => {
    const a = await page.evaluate(() => {
      const m = window.__rm6m, rows = [];
      for (const dynamic of [0.1, 0.35, 0.55, 0.8, 1.0, null]) {
        m.setCtx(3, { dynamic });
        m.step(0.05, 2);
        rows.push({ dynamic, levels: [1, 2, 3, 4].map((k) => m.ratio(3, 'Glow_level' + k)), level: landmarkDynamicLevel(dynamic === null ? NaN : dynamic) });
      }
      return rows;
    });
    const lit = (row) => row.levels.filter((v) => v >= 0.99).length;
    const monotone = a.filter((r) => r.dynamic !== null).every((r, i, list) => i === 0 || lit(r) >= lit(list[i - 1]));
    check('r3 셈여림 0.1~1.0에서 켜진 단이 늘기만 한다(1 → 4단)', monotone && lit(a[0]) === 1 && lit(a[4]) === 4, a);
    check('r3 켜진 단은 아래부터 연속이고 꺼진 단은 0.14', a.filter((r) => r.dynamic !== null).every((r) => r.levels.every((v, i) => (i < r.level ? near(v, 1, 0.001) : near(v, 0.14, 0.001)))), a);
    check('r3 값이 없으면 모든 단이 쉬는 값 0.3', a[5].levels.every((v) => near(v, 0.3, 0.001)), a[5]);
  },
  4: async (page) => {
    const a = await page.evaluate(() => {
      const m = window.__rm6m, out = {};
      m.setCtx(4, { gate: 0.9, fermata: false });
      m.step(0.05, 2);
      out.rest = { dots: m.ratio(4, 'Lantern_dots'), hold: m.ratio(4, 'Glow_hold') };
      m.cue({ region: 4, beat: true, gate: 0.9 });
      m.step(0.05);
      out.legato = m.ratio(4, 'Lantern_dots');
      m.step(0.3);
      out.legato03 = m.ratio(4, 'Lantern_dots');
      m.setCtx(4, { gate: 0.2, fermata: false });
      m.cue({ region: 4, beat: true, gate: 0.2 });
      m.step(0.05);
      out.staccato = m.ratio(4, 'Lantern_dots');
      m.step(0.3);
      out.staccato03 = m.ratio(4, 'Lantern_dots');
      m.setCtx(4, { gate: 0.5, fermata: true });
      m.step(0.05);
      out.fermata = m.ratio(4, 'Glow_hold');
      return out;
    });
    check('r4 쉬는 값: 점 0.25 · 페르마타 진주 0.25', near(a.rest.dots, 0.25, 0.001) && near(a.rest.hold, 0.25, 0.001), a.rest);
    check('r4 legato는 길게 이어지고 staccato는 짧게 끊긴다(0.3초 뒤 legato ≥ 0.6 · staccato = 0.25)', a.legato > 1.0 && a.legato03 >= 0.6 && a.staccato > 0.5 && near(a.staccato03, 0.25, 0.001), a);
    check('r4 페르마타 곁에서 아치 아래 진주가 환하다(1.3)', near(a.fermata, 1.3, 0.001), a.fermata);
  },
  5: async (page) => {
    const a = await page.evaluate(() => {
      const m = window.__rm6m, out = { rows: [] };
      for (const k of [0, 3, 6]) {
        m.setCtx(5, { scaleNearby: true, scaleStep: k });
        m.step(0.05, 2);
        out.rows.push({ k, ratios: [1, 2, 3, 4, 5, 6, 7].map((n) => m.ratio(5, 'Lantern_deg' + n)) });
      }
      m.setCtx(5, { scaleNearby: true, scaleStep: 2 });
      m.cue({ region: 5, scaleDegree: 3 });
      m.step(0.05);
      out.flare = [1, 2, 3, 4].map((n) => m.ratio(5, 'Lantern_deg' + n));
      m.step(1.3);
      out.after = [1, 2, 3, 4].map((n) => m.ratio(5, 'Lantern_deg' + n));
      m.setCtx(5, { scaleNearby: false, scaleStep: null });
      m.step(0.05, 2);
      out.none = [1, 2, 3, 4, 5, 6, 7].map((n) => m.ratio(5, 'Lantern_deg' + n));
      return out;
    });
    check('r5 가까운 등대(계이름 k+1)만 1.0으로 켜지고 나머지는 0.3', a.rows.every((row) => row.ratios.every((v, i) => (i === row.k ? near(v, 1, 0.001) : near(v, 0.3, 0.001)))), a.rows);
    check('r5 계이름이 바뀐 순간 그 등대가 한 번 더 번쩍인다(> 1.3) → 1.3초 뒤 1.0', a.flare[2] > 1.3 && near(a.after[2], 1, 0.001) && near(a.flare[0], 0.3, 0.001), { flare: a.flare, after: a.after });
    check('r5 등대에서 멀면(scaleNearby = false) 일곱 모두 0.3', a.none.every((v) => near(v, 0.3, 0.001)), a.none);
  },
  6: async (page) => {
    const a = await page.evaluate(() => {
      const m = window.__rm6m, out = {};
      m.setCtx(6, { chordNearby: false, chordSlot: null });
      m.step(0.05, 2);
      out.far = [1, 2, 3].map((k) => m.ratio(6, 'Glow_pearls' + k));
      m.setCtx(6, { chordNearby: true, chordSlot: 0 });
      m.step(0.05, 2);
      out.near = [1, 2, 3].map((k) => m.ratio(6, 'Glow_pearls' + k));
      m.cue({ region: 6, chordTones: ['C', 'E', 'G'] });
      m.step(0.05);
      out.cue0 = [1, 2, 3].map((k) => m.ratio(6, 'Glow_pearls' + k));
      m.step(0.2);
      out.cue1 = [1, 2, 3].map((k) => m.ratio(6, 'Glow_pearls' + k));
      m.step(1.5);
      out.after = [1, 2, 3].map((k) => m.ratio(6, 'Glow_pearls' + k));
      return out;
    });
    check('r6 산호에서 멀면 진주 셋 모두 0.25', a.far.every((v) => near(v, 0.25, 0.001)), a.far);
    check('r6 산호 곁이면 진주 셋 모두 켜진다(1.0)', a.near.every((v) => near(v, 1, 0.001)), a.near);
    check('r6 화음 큐에서 근음 → 3음 → 5음 차례로 번쩍인다(0.05초: 1단만, 0.25초: 2단 이상) → 1.7초 뒤 1.0', a.cue0[0] > 1.3 && near(a.cue0[1], 1, 0.001) && a.cue1[1] > 1.2 && a.after.every((v) => near(v, 1, 0.001)), a);
  },
  7: async (page) => {
    const a = await page.evaluate(() => {
      const m = window.__rm6m, out = { rows: [] };
      const key = (i) => (i === 6 ? ['Lantern_key6a', 'Lantern_key6b'] : ['Lantern_key' + i]);
      for (const idx of [0, 1, 6, 7, 11]) {
        m.setCtx(7, { circleIndex: idx });
        m.step(0.05, 2);
        const lit = [], idle = [];
        for (let i = 1; i <= 11; i++) key(i).forEach((n) => (i === idx ? lit : idle).push(m.ratio(7, n)));
        out.rows.push({ idx, lit, idle, core: m.ratio(7, 'Glow_core') });
      }
      m.setCtx(7, { circleIndex: 3 });
      const r0 = m.rotY(7, 'Sway_rings');
      m.step(0.1, 10);
      const r1 = m.rotY(7, 'Sway_rings');
      m.reduced(true);
      m.step(0.1, 10);
      const r2 = m.rotY(7, 'Sway_rings');
      m.reduced(false);
      out.spin = { moved: r1 - r0, reducedMoved: r2 - r1 };
      return out;
    });
    check('r7 조표 띠: 음악의 조(5도권 번호)만 1.4로 켜지고 나머지는 0.3(F♯/G♭는 두 막대 모두)', a.rows.every((row) => (row.idx === 0 ? row.lit.length === 0 : row.lit.every((v) => near(v, 1.4, 0.001))) && row.idle.every((v) => near(v, 0.3, 0.001))), a.rows);
    check('r7 C(5도권 0)는 조표가 없어 가운데 진주가 1.3으로 켜진다', near(a.rows[0].core, 1.3, 0.001) && a.rows.slice(1).every((row) => row.core >= 0.35 && row.core <= 0.95), a.rows.map((r) => r.core));
    check('r7 혼천의 고리가 천천히 돈다(1초에 약 0.14 rad) · 감소된 모션이면 멈춘다', a.spin.moved > 0.1 && a.spin.moved < 0.2 && Math.abs(a.spin.reducedMoved) < 1e-6, a.spin);
  },
  8: async (page) => {
    const a = await page.evaluate(() => {
      const m = window.__rm6m, out = {};
      m.setCtx(8);
      m.step(0.05, 2);
      out.rest = [m.ratio(8, 'Lantern_dotsStart'), m.ratio(8, 'Lantern_dotsEnd'), m.ratio(8, 'Glow_coda')];
      for (const bar of [4, 7, 6, 5]) {
        m.cue({ region: 8, bar });
        m.step(0.05);
        out['bar' + bar] = [m.ratio(8, 'Lantern_dotsStart'), m.ratio(8, 'Lantern_dotsEnd'), m.ratio(8, 'Glow_coda')];
        m.step(1.8);
      }
      out.after = [m.ratio(8, 'Lantern_dotsStart'), m.ratio(8, 'Lantern_dotsEnd'), m.ratio(8, 'Glow_coda')];
      return out;
    });
    check('r8 쉬는 값은 셋 모두 0.3', a.rest.every((v) => near(v, 0.3, 0.001)), a.rest);
    check('r8 마디 0(A 처음)에는 시작 도돌이 점, 3(A 끝)에는 끝 도돌이 점, 2(B)에는 코다 구만 켜진다', a.bar4[0] > 1 && near(a.bar4[1], 0.3, 0.001) && near(a.bar4[2], 0.3, 0.001) && a.bar7[1] > 1 && near(a.bar7[0], 0.3, 0.001) && a.bar6[2] > 1 && near(a.bar6[0], 0.3, 0.001) && near(a.bar6[1], 0.3, 0.001), { bar4: a.bar4, bar7: a.bar7, bar6: a.bar6 });
    check('r8 마디 1(A 둘째)에는 아무것도 번쩍이지 않고, 1.8초 뒤 모두 쉬는 값', a.bar5.every((v) => near(v, 0.3, 0.001)) && a.after.every((v) => near(v, 0.3, 0.001)), { bar5: a.bar5, after: a.after });
  },
};

// 캡처 상태: 시계를 얼린 채 값을 맞춘 뒤 한 장 찍는다.
const CAPTURES = {
  1: [
    ['right', (m) => { m.setCtx(1, { bpm: 100 }); const mu = window.__OCEAN_GAME__.remaster.landmarks.music; mu.phase = 0.25; m.step(0.0001); }],
    ['left', (m) => { m.setCtx(1, { bpm: 100 }); const mu = window.__OCEAN_GAME__.remaster.landmarks.music; mu.phase = 0.75; m.step(0.0001); }],
  ],
  2: [['hit', (m) => { m.setCtx(2); m.cue({ region: 2, beat: true }); m.cue({ region: 2, lightning: true }); m.step(0.05); }]],
  3: [
    ['pp', (m) => { m.setCtx(3, { dynamic: 0.1 }); m.step(0.05, 2); }],
    ['ff', (m) => { m.setCtx(3, { dynamic: 1.0 }); m.step(0.05, 2); }],
  ],
  4: [['fermata', (m) => { m.setCtx(4, { gate: 0.9, fermata: true }); m.cue({ region: 4, beat: true, gate: 0.9 }); m.step(0.05); }]],
  5: [['mi', (m) => { m.setCtx(5, { scaleNearby: true, scaleStep: 2 }); m.cue({ region: 5, scaleDegree: 3 }); m.step(0.05); }]],
  6: [['triad', (m) => { m.setCtx(6, { chordNearby: true, chordSlot: 0 }); m.cue({ region: 6, chordTones: ['C', 'E', 'G'] }); m.step(0.3); }]],
  7: [['key-d', (m) => { m.setCtx(7, { circleIndex: 2 }); m.step(0.05, 2); }]],
  8: [['repeat-start', (m) => { m.setCtx(8); m.cue({ region: 8, bar: 4 }); m.step(0.05); }]],
};

async function regionBlock(page, r) {
  const shot = viewShot(r);
  await page.evaluate(() => window.__rm6m.thaw());
  await teleport(page, shot, { settle: 6 });
  const st = await waitFor(page, (rr) => { const e = window.__rm6m.entry(rr); const s = (x) => x === 'ready' || x === 'failed'; return { ok: e.stage === 'near' && s(e.far.status) && s(e.near.status) && e.near.root && e.near.root.visible, stage: e.stage, far: e.far.status, near: e.near.status }; }, r);
  check(`r${r} 근경이 올라와 보임(대기 ${(st.waitedMs / 1000).toFixed(0)}초)`, st.ok, st);
  if (!st.ok) return;
  await frames(page, 4);
  await page.evaluate(() => window.__rm6m.freeze());

  // (1) 노드 이름 1:1
  const names = await page.evaluate((rr) => ({ bound: window.__rm6m.names(rr), target: window.__rm6m.targetNames(rr), far: window.__rm6m.names(rr, 'far') }), r);
  const missing = names.target.filter((n) => !names.bound.includes(n)), orphan = names.bound.filter((n) => !names.target.includes(n));
  check(`r${r} 음악 목표 노드가 모델에 모두 있다(${names.target.length}개)`, missing.length === 0 && names.target.length > 0, { missing, bound: names.bound });
  check(`r${r} 모델의 음악 노드(Beat_·Glow_·Lantern_·Sway_)는 모두 음악 목표가 있다`, orphan.length === 0, { orphan });
  // (4) 원경 대역 발광은 쉬는 값
  const far = await page.evaluate((rr) => window.__rm6m.farRatios(rr), r);
  check(`r${r} 원경 대역의 발광 노드는 쉬는 값 0.4로 고정(${far.length}개)`, far.every((v) => near(v, 0.4, 0.001)), far);

  // (2)(3) 해역별 반응
  if (REGION_TESTS[r]) await REGION_TESTS[r](page);

  // 캡처
  if (SHOTS && CAPTURES[r]) {
    for (const [label, setup] of CAPTURES[r]) {
      await page.evaluate(`(${setup.toString()})(window.__rm6m)`);
      await frames(page, 6);
      const file = outPath(`rm6m_r${r}_${label}.png`);
      await page.screenshot({ path: file });
      console.log('  캡처', file);
      await page.evaluate(() => window.__rm6m.freeze());
    }
  }
  await page.evaluate(() => window.__rm6m.thaw());
}

(async () => {
  const { browser, page, errors, requests } = await open({ query: '?qa=1', width: W, height: H });
  const t0 = Date.now();
  try {
    await startSailing(page);
    await page.evaluate(PAGE);
    await hideHud(page);
    await page.evaluate(async () => { const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__; await g.remaster.start(); a.vfxQa.setTimeOfDay(0.25); g.applyQualityProfile('mid', false); });

    for (const r of REGIONS) await regionBlock(page, r);

    // (6) 음계 해협: 오디오 판정 = 등대 좌표 = 원시 비콘 좌표. 실제(가짜가 아닌) 컨텍스트로 본다.
    if (REGIONS.includes(5)) {
      await page.evaluate(() => window.__rm6m.thaw());
      const lights = await page.evaluate(() => REMASTER_SCALE_LIGHTS.map((l) => [l[0], l[1]]));
      const spec = await page.evaluate(() => REMASTER_LANDMARKS.find((e) => e.region === 5).footprints.map((f) => [f.x, f.z]));
      check('r5 등대 발자국 일곱 = REMASTER_SCALE_LIGHTS = 훅 단계 수', JSON.stringify(lights) === JSON.stringify(spec) && lights.length === 7, { lights, spec });
      const rows = [];
      for (const k of [0, 2, 3, 6]) {
        const wx = CENTERS[5][0] + lights[k][0], wz = CENTERS[5][1] + lights[k][1];
        await teleport(page, { x: wx + 4, z: wz, h: 0 }, { settle: 5 });
        rows.push(await page.evaluate((kk) => { const c = window.__OCEAN_GAME__.audio.latestContext; return { k: kk, region: c.region, scaleNearby: c.scaleNearby, scaleStep: c.scaleStep, dist: c.scaleDistance == null ? null : +c.scaleDistance.toFixed(2) }; }, k));
      }
      check('r5 배가 등대 곁(4 m)에 서면 오디오의 가장 가까운 등대가 그 등대(계이름 일치)', rows.every((row) => row.region === 5 && row.scaleNearby === true && row.scaleStep === row.k), rows);
      const beacons = await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, group = g.world.regionGroups[5], out = [], mat = new THREE.Matrix4();
        group.children.forEach((ch) => {
          if (!ch.userData || ch.userData.landmarkFallback !== 'r5-beacons') return;
          if (ch.isInstancedMesh) for (let i = 0; i < ch.count; i++) { ch.getMatrixAt(i, mat); out.push([+(mat.elements[12] + ch.position.x).toFixed(2), +(mat.elements[14] + ch.position.z).toFixed(2)]); }
          else out.push([+ch.position.x.toFixed(2), +ch.position.z.toFixed(2)]);
        });
        return out;
      });
      check('r5 원시 비콘(옛 도형) 일곱도 등대와 같은 자리(지역 좌표)', beacons.length === 7 && lights.every((l) => beacons.some((p) => Math.abs(l[0] - p[0]) < 0.01 && Math.abs(l[1] - p[1]) < 0.01)), { beacons, lights });
    }

    // (7) 먼 거리 비용 0, (8) 큐 → 구동기 연결
    {
      await page.evaluate(() => window.__rm6m.thaw());
      await teleport(page, { x: 0, z: 560, h: 0 }, { settle: 4 }); // 어느 해역 중심에서도 150 m 넘게 떨어진 바깥(근경이 안 보인다)
      const a = await page.evaluate(() => window.__rm6m.snapshot());
      await frames(page, 8);
      const b = await page.evaluate(() => window.__rm6m.snapshot());
      check('먼 거리(근경이 안 보일 때)에는 구동기 적용이 늘지 않는다(update는 계속, applied는 그대로)', b.updates > a.updates && b.applied === a.applied, { a: { u: a.updates, ap: a.applied }, b: { u: b.updates, ap: b.applied } });
      const w = await page.evaluate(() => {
        const g = window.__OCEAN_GAME__, mu = g.remaster.landmarks.music;
        const before = { ...mu.events };
        g.effects.consumeMusic({ region: 5, beat: false, scaleDegree: 4, bpm: 96 });
        g.effects.consumeMusic({ region: 8, beat: true, bar: 6, bpm: 96 });
        return { before: { degree: before.degree, bar: before.bar }, after: { degree: mu.events.degree, bar: mu.events.bar, degreeAt: mu.events.degreeAt, time: g.effects.time } };
      });
      check('큐 처리(consumeMusic)가 랜드마크 구동기에 계이름·마디를 알린다', w.after.degree === 4 && w.after.bar === 6 && Math.abs(w.after.degreeAt - w.after.time) < 1e-6, w);
    }
  } catch (e) {
    check('예외 없이 끝남', false, String((e && e.stack) || e).slice(0, 800));
  }
  const bad = errors.filter((x) => !/GL Driver Message|GPU stall/.test(x));
  check('콘솔 오류·경고 없음', bad.length === 0, bad.slice(0, 6));
  const external = requests.filter((u) => !/three(\.min)?\.js/.test(u));
  check('외부 요청 없음(three CDN 대신 로컬 응답만)', external.length === 0, external.slice(0, 6));
  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(outPath('rm6-music.json'), JSON.stringify({ gate: failed.length ? 'FAIL' : 'PASS', regions: REGIONS, seconds: Math.round((Date.now() - t0) / 1000), checks }, null, 1));
  console.log(failed.length ? `GATE FAIL (${failed.length}/${checks.length})` : `GATE PASS (${checks.length}/${checks.length})`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();

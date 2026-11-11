'use strict';
/*
 * RM7 화면 캡처와 자동 측정 (설계서 10.2절).
 *   20개 상태 × 6개 화면 크기 × 글자 배율 2 × 종이 2(낮·밤) = 480장 + 장마다 자동 측정.
 *   UX 트랙의 터치 모드 강제 캡처(touch-expandedqa.cjs)와 같은 흐름이다. 종이는 QA 함수 hudQa.forcePaper 로 고정한다.
 *
 * 사용(예):
 *   node rm7-capture.cjs                                  전부(480장)
 *   node rm7-capture.cjs --states sailing,title --sizes 390x844,1440x900 --scales 1 --papers day
 *   node rm7-capture.cjs --png 0                          측정만(그림 저장 없음)
 * 옵션: --states a,b | all · --sizes WxH,… | all · --scales 1,1.3 · --papers day,night · --out 폴더 · --tag 접두어 · --json 경로
 *       --extras 1 (조용한·숨김 항해 화면을 더한다) · --png 0|1 · --touch 0|1
 * 환경변수: BASE_URL (기본 게임 폴더 서버), THREE_JS
 */
const fs = require('fs');
const path = require('path');
const { open, frames, outPath } = require('./lib.cjs');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};
const ALL_SIZES = [[320, 568], [375, 812], [390, 844], [844, 390], [768, 1024], [1440, 900]];
const ALL_STATES = [
  'sailing', 'sailing-near-lighthouse', 'codex-detail', 'menu-settings', 'dialogue',
  'trial-nav', 'trial-nav-open', 'trial-listen', 'trial-listen-open', 'trial-order', 'trial-order-open', 'trial-match',
  'trial-result', 'lighthouse-event', 'shop', 'term-sheet', 'codex-grid', 'ending-normal', 'ending-hidden', 'title',
];
const EXTRA_STATES = ['sailing-quiet', 'sailing-off', 'region-banner', 'sailing-map'];
const sizes = arg('sizes', 'all') === 'all' ? ALL_SIZES : arg('sizes').split(',').map((s) => s.split('x').map(Number));
const scales = arg('scales', '1,1.3').split(',').map(Number);
const papers = arg('papers', 'day,night').split(',');
const wantArg = arg('states', 'all');
const extras = arg('extras', '0') === '1';
const want = new Set(wantArg === 'all' ? [...ALL_STATES, ...(extras ? EXTRA_STATES : [])] : wantArg.split(','));
const savePng = arg('png', '1') === '1';
const fmt = arg('fmt', 'png') === 'jpeg' ? 'jpeg' : 'png', ext = fmt === 'jpeg' ? 'jpg' : 'png'; // jpeg: 행렬 전체를 가볍게 남길 때(품질 80)
const touch = arg('touch', '1') === '1';
const tag = arg('tag', 'rm7');
const outDir = arg('out', 'output/playwright/rm7');
const jsonOut = arg('json', path.join(outDir, tag + '-measure.json'));
// 이어하기: 장면 하나가 끝날 때마다 측정 줄을 <tag>-rows.jsonl 에 덧붙인다. 작업 환경이 끊겨도 --resume 1 로 이미 끝낸 장면을 건너뛰고 잇는다.
// (빌드가 바뀌었으면 --resume 없이 새로 돌린다: 그때는 이 파일을 비우고 시작한다.)
const resume = arg('resume', '0') === '1';
const stopAfter = arg('stop-after', ''); // 점검용: 이 장면을 잰 뒤 바로 끝낸다(--states 와 함께). 행렬 전체에는 쓰지 않는다.
class StopAfter extends Error {}
const measureOnly = new Set(arg('measure-only', '').split(',').filter(Boolean)); // 이 장면들은 그림을 다시 찍지 않고 측정만 한다(이미 찍은 그림을 그대로 둘 때)
const rowsFile = path.resolve(outDir, tag + '-rows.jsonl');
const resumed = new Map(); // "종이|장면" -> 측정 줄 배열
// 빌드 지문: 측정한 index.html(과 거기서 부르는 글꼴 파일)의 해시. 줄마다 남기고, 이어하기는 같은 지문인 줄만 쓴다.
// 보고서 도구는 낮·밤 측정이 같은 지문인지 확인한다 — 잰 빌드와 내보낸 빌드가 같다는 증거다.
const crypto = require('crypto');
const BUILD_BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
async function buildFingerprint() {
  const html = await (await fetch(BUILD_BASE + '/')).text();
  const h = crypto.createHash('sha256').update(html);
  const fonts = Array.from(new Set(html.match(/assets\/remaster\/fonts\/[^"'()\s]+\.woff2/g) || [])).sort();
  for (const f of fonts) h.update(Buffer.from(await (await fetch(BUILD_BASE + '/' + f)).arrayBuffer()));
  return h.digest('hex').slice(0, 16);
}
let buildHash = '';

// 페이지 안에서 장마다 재는 값
const MEASURE = (state) => {
  const a = window.__OCEAN_API__;
  const r = (id) => { const n = document.getElementById(id); return n && !n.hidden ? n.getBoundingClientRect().height : 0; };
  const html = document.documentElement;
  const contrast = a.measureContrast();
  // 화면 밖으로 나간 글자: 가로로 스크롤되는 조상 안의 것은 제외한다
  const offscreen = [];
  document.querySelectorAll('body *').forEach((n) => {
    if (n.closest('script,style,svg,canvas,#qa-hud,#test-report,[data-qa-only],[hidden],[inert],.hidden,.sr-only,#scene-host')) return;
    if (!Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim())) return;
    const rect = n.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || cs.opacity === '0') return;
    for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (/(auto|scroll)/.test(o.overflowX) && p.scrollWidth > p.clientWidth + 1) return;
      if (/(auto|scroll)/.test(o.overflowY) && p.scrollHeight > p.clientHeight + 1) { const pr = p.getBoundingClientRect(); if (rect.bottom > pr.bottom + 1 || rect.top < pr.top - 1) return; }
    }
    if (rect.right > innerWidth + 1 || rect.left < -1 || rect.bottom > innerHeight + 1 || rect.top < -1) offscreen.push({ id: n.id || n.className || n.tagName, text: n.textContent.trim().slice(0, 30), l: Math.round(rect.left), r: Math.round(rect.right), t: Math.round(rect.top), b: Math.round(rect.bottom) });
  });
  // HUD 요소·월드 라벨끼리 겹침(항해·시련 화면): 보이는 것만, 2px 넘게 서로 파고들 때
  const overlaps = [];
  if (state.startsWith('sailing') || state === 'region-banner' || state.startsWith('trial-')) {
    const sel = ['#region-chip', '#compass', '#objective-chip', '.collect-counter', '.minimap-panel', '.action-cluster button', '.joystick', '#region-banner', '#caption-strip', '#game-toast .toast-item', '#hud-hide-button', '#tutorial-skip', '#trial-banner', '#trial-drawer', '#world-labels .world-label'];
    const items = [];
    sel.forEach((q) => document.querySelectorAll(q).forEach((n) => {
      if (n.closest('[hidden],[inert]') && !n.closest('.minimap-panel')) return;
      if (n.hidden) return;
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return;
      const r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      items.push({ name: q === '#world-labels .world-label' ? 'label:' + n.textContent.trim().slice(0, 14) : n.id || q, r });
    }));
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i].r, b = items[j].r;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2) overlaps.push(items[i].name + ' × ' + items[j].name + ' (' + Math.round(w) + '×' + Math.round(h) + ')');
    }
  }
  // 잘린 글자: 늘 다 보여야 하는 상자가 안쪽 내용을 다 담지 못해 스크롤·숨김으로 가려질 때(스크롤이 의도된 목록·서랍은 뺀다)
  const clipped = [];
  ['#trial-banner', '#region-chip', '#objective-chip', '#region-banner', '.collect-counter', '#caption-strip', '#game-toast .toast-item', '#tutorial-skip'].forEach((q) => document.querySelectorAll(q).forEach((n) => {
    if (n.hidden || n.closest('[hidden],[inert]')) return;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return;
    const dy = n.scrollHeight - n.clientHeight, dx = n.scrollWidth - n.clientWidth;
    if ((dy > 2 && cs.overflowY !== 'visible') || (dx > 2 && cs.overflowX !== 'visible')) clipped.push((n.id || q) + (dy > 2 ? ' 세로+' + dy : '') + (dx > 2 ? ' 가로+' + dx : ''));
  }));
  return {
    state,
    overlaps,
    clipped,
    paper: html.dataset.paper || '', hud: html.dataset.hud || '', mode: html.dataset.mode || '',
    textScale: getComputedStyle(html).getPropertyValue('--text-scale').trim(),
    size: [innerWidth, innerHeight],
    center: state.startsWith('sailing') && state !== 'sailing-map' ? (() => {
      const c = a.measureCenterSafeZone();
      // 위반한 상자의 실제 좌표(왼·위·오른·아래)를 함께 남긴다
      c.rects = {};
      document.querySelectorAll('.region-chip,.instrument,.minimap-panel,.collect-counter,.action-cluster,.joystick,.objective-chip').forEach((n) => {
        const name = n.id || n.className;
        if (c.violations.includes(name)) { const r = n.getBoundingClientRect(); c.rects[name] = [r.left, r.top, r.right, r.bottom].map(Math.round); }
      });
      return c;
    })() : null,
    touch: a.measureTouchTargets().below44,
    term: r('term-sheet'), banner: r('trial-banner'), drawer: r('trial-drawer'),
    contrast: { measured: contrast.measured, minimum: contrast.minimum, violations: contrast.violations },
    copy: a.auditUiCopy(),
    overflow: html.scrollWidth > innerWidth,
    offscreen: offscreen.slice(0, 8),
    offscreenCount: offscreen.length,
  };
};

async function runPaper(paper) {
  const { browser, page, errors } = await open({ query: '?qa=1', width: 1280, height: 720 });
  const out = [];
  const log = (...m) => console.log(`[${paper}]`, ...m);
  try {
    await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
    await page.click('#start-sailing');
    await page.waitForTimeout(1200);
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 3 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 350, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await page.evaluate((paper) => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
      if (g.trialSession) g.exitTrial();
      g.applyReducedMotion(true);
      g.audio.setMuted(true);
      a.hudQa.setQuiet(false); // 늘 떠오름: 겹침의 가장 나쁜 경우를 잰다
      a.hudQa.forcePaper(paper);
      a.hudQa.noTransition(true);
      document.getElementById('qa-hud').style.display = 'none';
    }, paper);

    const capture = async (state) => {
      if (!want.has(state)) return;
      const savedRows = resumed.get(paper + '|' + state);
      if (savedRows) { out.push(...savedRows); log('skip', state, `(저장된 ${savedRows.length}장 사용)`); return; }
      const firstRow = out.length, doPng = savePng && !measureOnly.has(state);
      for (const scale of scales) {
        await page.evaluate((scale) => { document.documentElement.style.setProperty('--text-scale', scale); document.documentElement.dataset.textScale = String(scale); }, scale);
        for (const [width, height] of sizes) {
          await page.setViewportSize({ width, height });
          if (state.startsWith('sailing') || state === 'region-banner') {
            // 지도는 기본 닫힘이다(처음 가는 해역에서 잠깐 자동으로 열렸다 닫히는 것은 제외하고 잰다). sailing-map만 연 채로 잰다.
            // region-banner도 닫힌 채로 잰다: 앞 장면(sailing-map)이 지도를 연 채로 남겨 두면 카드와 지도가 한 화면에 겹쳐 잡힌다. 자동 흐름에서는 지도가
            // 카드가 걷힌 뒤에 열리므로(rm8a.py 7번, 겹침은 rm8-cardmap.cjs가 프레임마다 잰다) 이 장면은 카드만 본다. 카드가 떠 있는 동안 사람이 지도를
            // 직접 열면 폭이 좁은 세로폰에서 겹치는 것은 알려진 한계다(RM8 한계 목록).
            await page.evaluate((openMap) => { const g = window.__OCEAN_GAME__; if (Boolean(g.ux.mapOpen) !== openMap) g.toggleMinimap(); g.ux.autoMapToken = (g.ux.autoMapToken || 0) + 1; }, state === 'sailing-map');
          }
          await page.waitForTimeout(220);
          await frames(page, 2);
          if (doPng) {
            // 헤드리스 합성기 문제: 스크롤되는 보기 서랍이 열려 있으면 캔버스 위에 투명 구멍이 생긴다(캔버스 픽셀을 읽어 보면 정상).
            // 찍는 동안만 서랍 스크롤을 끈다. 잰 값에는 영향이 없다(잰 뒤에 되돌린다).
            await page.evaluate(() => { const d = document.getElementById('trial-drawer'); if (d && !d.hidden) d.style.overflow = 'hidden'; });
            await frames(page, 2);
            await page.screenshot(Object.assign({ path: outPath('rm7', `${tag}_${paper}_${state}_s${scale}_${width}x${height}.${ext}`) }, fmt === 'jpeg' ? { type: 'jpeg', quality: 80 } : {}));
            await page.evaluate(() => { const d = document.getElementById('trial-drawer'); if (d) d.style.overflow = ''; });
          }
          out.push({ ...(await page.evaluate(MEASURE, state)), file: `${tag}_${paper}_${state}_s${scale}_${width}x${height}.${ext}` });
        }
      }
      // 재는 동안 서버의 빌드가 바뀌었으면(다시 만들었으면) 이 줄들은 한 빌드의 증거가 아니다. 멈추고 처음부터 다시 돌린다.
      const nowHash = await buildFingerprint();
      if (nowHash !== buildHash) { log('중단', `측정 중 빌드가 바뀌었습니다(${buildHash} → ${nowHash}).`); process.exit(9); }
      // 진행 중에도 위반을 볼 수 있게 장면 하나가 끝날 때마다 한 줄로 알린다
      const rows = out.filter((r) => r.state === state), keyOf = (r) => [r.center && r.center.violations.length && 'center:' + r.center.violations.join('+'), r.touch && r.touch.length && 'touch', r.contrast.violations.length && 'contrast', r.copy && r.copy.length && 'copy', r.overflow && 'overflow', r.overlaps && r.overlaps.length && 'overlap:' + r.overlaps[0], r.clipped && r.clipped.length && 'clipped:' + r.clipped[0]].filter(Boolean);
      const badRows = rows.filter((r) => keyOf(r).length);
      fs.appendFileSync(rowsFile, JSON.stringify({ build: buildHash, paper, state, rows: out.slice(firstRow) }) + '\n');
      log('done', state, `(${rows.length}장, 위반 ${badRows.length})`);
      badRows.slice(0, 4).forEach((r) => log('   ', r.file, keyOf(r).join(' | ')));
      if (state === stopAfter) throw new StopAfter();
    };

    // 항해 두 가지
    await page.evaluate((paper) => {
      const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
      a.questQa.prepare(1);
      g.applyReducedMotion(true); // prepare()가 설정을 처음 값으로 돌리므로 다시 켠다(점등 연출 시간표가 동작 줄이기 쪽이 된다)
      a.hudQa.setQuiet(false); // 같은 까닭으로 '늘 떠오름'도 다시 켠다(안 그러면 6초 뒤 잠잠으로 돌아가 가장 나쁜 경우를 못 잰다)
      // 낮 종이는 안개(해역 4), 밤 종이는 오로라(해역 7) 한가운데에서 본다
      const c = paper === 'day' ? [113, 234] : [-203, -162];
      g.motion.x = c[0]; g.motion.z = c[1]; g.motion.heading = 0; g.motion.speed = 0;
      if (g.atmosphere) g.atmosphere.refresh(g.simTime, c[0], c[1]);
      if (a.cameraQa) { a.cameraQa.snap(); a.cameraQa.noteInput(); }
    }, paper);
    await frames(page, 8);
    await capture('sailing');
    if (extras) {
      await page.evaluate(() => { const a = window.__OCEAN_API__; a.hudQa.setQuiet(true); a.hudQa.rest(); });
      await frames(page, 3);
      await capture('sailing-quiet');
      await page.evaluate(() => { const a = window.__OCEAN_API__; a.hudQa.setQuiet(false); a.hudQa.setHidden(true); });
      await frames(page, 3);
      await capture('sailing-off');
      await page.evaluate(() => { const a = window.__OCEAN_API__; a.hudQa.setHidden(false); a.hudQa.setQuiet(false); });
      await frames(page, 3);
      await capture('sailing-map');
      // 해역 표제 카드: 머무는 구간(동작 줄이기 시간표 0~2600ms)에 묶어 둔다. 해역이 바뀐 것처럼 만들어 게임이 스스로 카드를 띄우게 한다.
      await page.evaluate(() => {
        const g = window.__OCEAN_GAME__;
        Object.defineProperty(g.ux, 'cardStart', { configurable: true, get: () => performance.now() - 1500, set: () => {} });
        g.ux.lastRegion = -1;
        g.ux.firstVisit = true;
      });
      await frames(page, 3);
      await capture('region-banner');
      await page.evaluate(() => { const g = window.__OCEAN_GAME__; delete g.ux.cardStart; g.ux.cardStart = null; g.ux.firstVisit = false; document.getElementById('region-banner').hidden = true; });
    }
    await page.evaluate(() => { window.__OCEAN_API__.questQa.prepare(1); window.__OCEAN_GAME__.applyReducedMotion(true); window.__OCEAN_API__.hudQa.setQuiet(false); });
    await frames(page, 6);
    await capture('sailing-near-lighthouse');
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.openCodex(); g.showCodexDetail(window.__OCEAN_API__.TERMS.find((t) => t.id === 'r1_grave')); });
    await capture('codex-detail');
    await page.evaluate(() => window.__OCEAN_GAME__.closeCodex());
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.openPause(); g.showMenuTab('settings'); });
    await capture('menu-settings');
    await page.evaluate(() => window.__OCEAN_GAME__.closePause());
    await page.evaluate(() => window.__OCEAN_GAME__.openKeeperDialogue(1));
    await capture('dialogue');
    await page.evaluate(() => window.__OCEAN_GAME__.startRegionTrial(1));
    for (const [type, state] of [['navigation', 'trial-nav'], ['listening', 'trial-listen'], ['ordered_navigation', 'trial-order'], ['symbol_matching', 'trial-match']]) {
      const exists = await page.evaluate((type) => {
        const g = window.__OCEAN_GAME__, index = g.trialSet.questions.findIndex((q) => q.type === type);
        if (index < 0) return false;
        g.trialSession.index = index; g.resetTrialRuntime(); g.renderTrialProblem();
        return true;
      }, type);
      if (exists) {
        await capture(state);
        if (type !== 'symbol_matching') {
          await page.locator('#trial-drawer-toggle').click();
          await capture(state + '-open');
          await page.locator('#trial-drawer-toggle').click();
        }
      }
    }
    await page.evaluate(() => {
      const g = window.__OCEAN_GAME__;
      g.trialSession.score = g.trialSession.count;
      g.trialSet.questions.forEach((q) => (g.trialSession.firstAttempts[q.id] = true));
      g.trialSession.index = g.trialSession.count;
      g.completeTrialRun();
    });
    await capture('trial-result');
    // 점등 연출은 시간표로 흐른다. 찍는 순간마다 같은 장면이 되도록 시작 시각을 '지금 - 1450ms'로 묶어 둔다(동작 줄이기 시간표: 표제 1200ms 이후, 검은 띠는 1600ms까지).
    // 느린 렌더(초당 1~4프레임)에서는 단추를 누른 뒤 값을 고치는 사이에 연출(동작 줄이기 2초)이 먼저 끝난다. 그래서 누르기 *전에*
    // 끝나는 시각 속성을 '쓰기는 무시하고 늘 Infinity를 돌려주는' 접근자로 바꿔 두고, 12장을 찍는 동안 스스로 끝나지 않게 한다(끝에서 건너뛰기 단추로 닫는다).
    await page.evaluate(() => {
      const g = window.__OCEAN_GAME__;
      Object.defineProperty(g, 'lighthouseEventUntil', { configurable: true, enumerable: true, get: () => Infinity, set: () => {} });
      // 화면 갱신은 프레임 시각(now)을 받는다. 느린 렌더에서는 now가 한참 늦으니 시각도 고정한다.
      const orig = g.updateLighthouseStage.bind(g);
      g.updateLighthouseStage = () => orig(1450);
    });
    await page.getByRole('button', { name: '등대 점등하기', exact: true }).click();
    await page.evaluate(() => { window.__OCEAN_GAME__.ux.lighthouseStarted = 0; });
    await frames(page, 2);
    await capture('lighthouse-event');
    await page.evaluate(() => {
      const g = window.__OCEAN_GAME__;
      delete g.updateLighthouseStage; delete g.ux.lighthouseStarted;
      Object.defineProperty(g, 'lighthouseEventUntil', { configurable: true, enumerable: true, writable: true, value: 0 });
    });
    await page.getByRole('button', { name: '건너뛰기 · Enter', exact: true }).click();
    await page.evaluate(() => window.__OCEAN_GAME__.openShop());
    await capture('shop');
    await page.evaluate(() => window.__OCEAN_GAME__.closeShop());
    await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, spawn = window.__OCEAN_API__.contentQa.term('r0_staff').spawn;
      g.motion.x = spawn.x; g.motion.z = spawn.z; g.currentRegion = 0; g.checkTermDiscovery(1);
    });
    await capture('term-sheet');
    await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.closeTermCard(); g.openCodex(); });
    await capture('codex-grid');
    await page.evaluate(() => window.__OCEAN_GAME__.closeCodex());
    for (const kind of ['normal', 'hidden']) {
      await page.evaluate((kind) => {
        const a = window.__OCEAN_API__, g = window.__OCEAN_GAME__;
        a.journeyQa[kind === 'normal' ? 'prepareNormalFinale' : 'prepareHiddenFinale']();
        g.beginFinalRoute();
        for (const spec of a.FINAL_ROUTE_SPECS) for (const action of spec.sequence) g.chooseFinalRouteAction(action, document.querySelector('[data-route-action="' + action + '"]'));
      }, kind);
      await capture('ending-' + kind);
      await page.locator('#ending-continue').click();
    }
    await page.evaluate(() => window.__OCEAN_GAME__.returnToTitle());
    await capture('title');
  } catch (e) {
    if (!(e instanceof StopAfter)) throw e;
  } finally {
    await browser.close();
  }
  return { out, errors };
}

(async () => {
  fs.mkdirSync(outPath('rm7'), { recursive: true });
  fs.mkdirSync(path.dirname(rowsFile), { recursive: true });
  buildHash = await buildFingerprint();
  console.log(`[빌드] ${BUILD_BASE} 지문 ${buildHash}`);
  if (resume && fs.existsSync(rowsFile)) {
    let stale = 0;
    for (const line of fs.readFileSync(rowsFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.build === buildHash) resumed.set(o.paper + '|' + o.state, o.rows); else stale++;
      } catch (e) { /* 끊기면서 반쯤 쓰인 마지막 줄은 버린다 */ }
    }
    console.log(`[이어하기] 끝난 장면 ${resumed.size}개를 건너뜁니다: ` + Array.from(resumed.keys()).join(', ') + (stale ? ` (다른 빌드에서 잰 ${stale}줄은 쓰지 않고 다시 잰다)` : ''));
    // 다시 잴 장면의 묵은 줄이 남지 않게, 이번 지문의 줄만 남기고 파일을 다시 쓴다
    const keep = [];
    for (const [k, rows] of resumed) { const [p, s] = k.split('|'); keep.push(JSON.stringify({ build: buildHash, paper: p, state: s, rows })); }
    fs.writeFileSync(rowsFile, keep.length ? keep.join('\n') + '\n' : '');
  } else fs.writeFileSync(rowsFile, '');
  const all = [], errs = [];
  for (const paper of papers) {
    const { out, errors } = await runPaper(paper);
    all.push(...out);
    errs.push(...errors.map((e) => `[${paper}] ${e}`));
  }
  fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify({ build: buildHash, count: all.length, errors: errs, rows: all }, null, 1));
  // 요약
  const bad = (f) => all.filter(f);
  const summary = {
    captures: all.length,
    consoleErrors: errs.length,
    centerViolations: bad((r) => r.center && r.center.violations.length).length,
    touchBelow44: bad((r) => r.touch && r.touch.length).length,
    contrastViolations: bad((r) => r.contrast.violations.length).length,
    copyViolations: bad((r) => r.copy && r.copy.length).length,
    horizontalOverflow: bad((r) => r.overflow).length,
    hudOverlaps: bad((r) => r.overlaps && r.overlaps.length).length,
    clippedBoxes: bad((r) => r.clipped && r.clipped.length).length,
    offscreenText: bad((r) => r.offscreenCount).length,
  };
  console.log(JSON.stringify(summary));
  if (errs.length) console.log('console errors', JSON.stringify(errs.slice(0, 6)));
  for (const key of ['center', 'touch', 'contrast', 'copy', 'overflow', 'overlap', 'clipped', 'offscreen']) {
    const rows = bad((r) => (key === 'center' ? r.center && r.center.violations.length : key === 'touch' ? r.touch && r.touch.length : key === 'contrast' ? r.contrast.violations.length : key === 'copy' ? r.copy && r.copy.length : key === 'overflow' ? r.overflow : key === 'overlap' ? r.overlaps && r.overlaps.length : key === 'clipped' ? r.clipped && r.clipped.length : r.offscreenCount));
    rows.slice(0, 8).forEach((r) => console.log(`  ${key}: ${r.file}`, JSON.stringify(key === 'center' ? [r.center.violations, r.center.rects, r.center.zone] : key === 'touch' ? r.touch : key === 'contrast' ? r.contrast.violations.slice(0, 3) : key === 'copy' ? r.copy : key === 'offscreen' ? r.offscreen.slice(0, 3) : key === 'overlap' ? r.overlaps.slice(0, 4) : key === 'clipped' ? r.clipped : true)));
  }
  const ok = !errs.length && !summary.centerViolations && !summary.touchBelow44 && !summary.contrastViolations && !summary.copyViolations && !summary.horizontalOverflow && !summary.hudOverlaps && !summary.clippedBoxes;
  console.log(ok ? 'CAPTURE-GATE PASS (오프스크린 글자는 참고)' : 'CAPTURE-GATE FAIL');
  process.exit(ok ? 0 : 1);
})();

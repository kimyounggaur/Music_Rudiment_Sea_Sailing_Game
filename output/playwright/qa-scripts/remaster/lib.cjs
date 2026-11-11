'use strict';
/*
 * 물빛 리마스터 QA 공용 도구.
 * 환경변수: BASE_URL(기본 http://127.0.0.1:8765), THREE_JS(로컬 three r128 min.js 경로)
 * three는 게임이 CDN에서 받는 요청 1건을 로컬 파일로 대신 응답해 오프라인에서 돌린다.
 */
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8765';
const SCRATCH = '/tmp/claude-0/-home-claude/d9851b37-f9ed-5184-9ec5-8e9b1c84c264/scratchpad';
const THREE_CANDIDATES = [
  process.env.THREE_JS,
  path.join(process.cwd(), 'node_modules/three/build/three.min.js'),
  path.join(SCRATCH, 'three128/package/build/three.min.js'),
].filter(Boolean);
const THREE_JS = THREE_CANDIDATES.find((p) => fs.existsSync(p));
if (!THREE_JS) throw new Error('three r128 min.js를 찾을 수 없습니다. THREE_JS 환경변수를 지정하세요.');

// 정적 서버: 별도 백그라운드 서버가 없어도 스크립트가 자기 안에서 게임 폴더를 :8765로 내준다(스크립트가 끝나면 함께 닫힌다).
// 이미 다른 서버가 8765를 쓰고 있거나 BASE_URL을 바꿨으면 아무것도 하지 않는다. QA 스크립트는 한 번에 하나씩 돌린다.
(function startStaticServer() {
  if (process.env.BASE_URL) return;
  const http = require('http');
  const ROOT = path.resolve(__dirname, '../../../..');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(buf);
      });
    } catch (e) { res.writeHead(400); res.end(); }
  });
  server.on('error', () => {});
  server.listen(8765, '127.0.0.1');
  server.unref();
})();

const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

// 고정 촬영 지점 (설계서 9.0절)
const POINTS = [
  { id: 0, name: 'r0-harbor', x: 0, z: -430, h: 0.57 },
  { id: 1, name: 'r1-arch', x: -10, z: -262, h: -0.49 },
  { id: 2, name: 'r2-storm', x: 195, z: -205, h: 0.2 },
  { id: 3, name: 'r3-canyon', x: 253, z: 0, h: 0 },
  { id: 4, name: 'r4-islands', x: 113, z: 190, h: 0 },
  { id: 5, name: 'r5-strait', x: -96, z: 172, h: 0.25 },
  { id: 6, name: 'r6-coral', x: -225, z: 60, h: 0.58 },
  { id: 7, name: 'r7-fifths', x: -203, z: -215, h: 0 },
  { id: 8, name: 'r8-maelstrom', x: 0, z: -75, h: 0 },
];

async function open(opts = {}) {
  const { width = 1280, height = 720, dsf = 1, query = '?qa=1', base = BASE_URL, touch = false, before = null } = opts;
  const browser = await chromium.launch({ args: GL_ARGS });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) errors.push(m.type() + ': ' + m.text().slice(0, 500)); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('data:') && !u.startsWith(base)) requests.push(u); });
  await page.route('https://cdnjs.cloudflare.com/**', (route) => route.fulfill({ path: THREE_JS, contentType: 'application/javascript' }));
  if (before) await before(page); // 페이지가 열리기 전에 걸 훅(예: 특정 모델 요청을 실패시키는 라우트)
  await page.goto(base + '/' + query, { waitUntil: 'load' });
  return { browser, context, page, errors, requests };
}

const frames = (page, n = 4) => page.evaluate((n) => new Promise((res) => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// 항해 시작 + 기존 QA 도구로 촬영 준비(외곽 등대 점등, 음소거)
async function startSailing(page, { prepare = true } = {}) {
  await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 20000 });
  await page.click('#start-sailing');
  await page.waitForTimeout(1200);
  if (prepare)
    await page.evaluate(() => {
      const g = window.__OCEAN_GAME__, a = window.__OCEAN_API__;
      g.audio.setMuted(true);
      a.questQa.prepare(1);
      g.qaLightOuterLighthouses();
    });
}

// 지점으로 순간이동하고 카메라를 정리한다. 용어 카드가 떠 있으면 닫는다.
async function teleport(page, p, { settle = 8, hideQa = true } = {}) {
  await page.evaluate(({ x, z, h, hideQa }) => {
    const g = window.__OCEAN_GAME__;
    if (hideQa) { const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; }
    g.motion.x = x; g.motion.z = z; g.motion.heading = h; g.motion.speed = 0;
    g.cameraDrag.yaw = 0; g.cameraDrag.pitch = 0.34;
    // RM4: 카메라 디렉터가 다음 프레임에 목표 자세로 바로 놓도록 한다(없으면 무시)
    if (window.__OCEAN_API__ && window.__OCEAN_API__.cameraQa) { window.__OCEAN_API__.cameraQa.snap(); window.__OCEAN_API__.cameraQa.noteInput(); }
    // 대기 디렉터는 시간 상수 1.2초라 순간이동 뒤에는 즉시 맞춘다(촬영 한정)
    if (g.atmosphere) g.atmosphere.refresh(g.simTime, x, z);
  }, { x: p.x, z: p.z, h: p.h, hideQa });
  await frames(page, settle);
  await page.evaluate(() => { const g = window.__OCEAN_GAME__; if (g.currentTerm) g.closeTermCard(); if (window.__OCEAN_API__ && window.__OCEAN_API__.cameraQa) window.__OCEAN_API__.cameraQa.noteInput(); });
  await frames(page, 4);
}

function outPath(...parts) {
  const dir = path.join(process.cwd(), 'output', 'playwright');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, ...parts);
}

module.exports = { chromium, BASE_URL, THREE_JS, GL_ARGS, POINTS, open, frames, startSailing, teleport, outPath };

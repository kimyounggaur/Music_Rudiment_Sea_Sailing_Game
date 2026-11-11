'use strict';
/*
 * 타이틀 카드 잘림 전수 측정 (RM8).
 *   화면 × 글자 배율 × 저장 유무마다 타이틀 카드의 내용(글자·단추)이 화면 안에 다 들어오는지 잰다.
 *   타이틀 층(#title-overlay)은 원본의 overflow: hidden 이라 화면 아래로 넘친 부분은 스크롤도 되지 않고 그냥 잘린다.
 *   저장이 있으면 "이어하기"·"새 항해" 두 단추와 진행 줄이 더해져 가장 길다(RM7 눈 검토에서 844×390·배율 1.3일 때 아래 끝이 6px 잘린 것이 이 상태).
 *
 * 사용(예):
 *   BASE_URL=http://127.0.0.1:8765 node survey-title.cjs                                기본: 화면 18종 × 배율 1·1.15·1.3 × 저장 없음·있음
 *   node survey-title.cjs 844x390,568x320 1,1.3 결과.json                                화면 · 배율 · 결과 파일(선택)
 * 환경변수: BASE_URL(기본 게임 폴더 서버), CSS_FILE(이 CSS를 페이지에 덧붙여 후보 규칙을 빌드 없이 시험한다)
 * 환경변수: QA_BUTTONS=1 이면 QA 주소처럼 "기반 검증 보기" 단추까지 보이는 상태로 잰다(기본은 실제 게임처럼 숨김)
 * 위반(한 칸이라도 있으면 실패):
 *   ① 내용 아래 끝·카드 아래 끝이 화면 아래 끝을 넘는다  ② 제목이 3줄 이상으로 꺾인다  ③ 카드가 안쪽 스크롤을 쓴다(처음 화면에서 다 보여야 한다)
 *   ④ 내용 위·옆이 화면 밖이다  ⑤ 설정 단추가 카드의 글자·단추와 겹친다(2px 넘게)  ⑥ 단추가 잘려 보인다
 */
const fs = require('fs');
const { open } = require('./lib.cjs');

const DEFAULT_VIEWS = [
  '320x568', '360x640', '375x667', '375x812', '390x844', '412x915', '768x1024', // 세로
  '568x320', '640x360', '667x375', '740x360', '812x375', '844x390', '896x414', '926x428', '1024x600', // 가로폰·작은 태블릿
  '1280x720', '1440x900',
].join(',');
const VIEWS = (process.argv[2] || DEFAULT_VIEWS).split(',').map((s) => s.split('x').map(Number));
const SCALES = (process.argv[3] || '1,1.15,1.3').split(',').map(Number);
const OUT = process.argv[4] || '';

(async () => {
  const { browser, page } = await open({ query: '?qa=1', width: 1280, height: 720 });
  await page.waitForSelector('#start-sailing:not([disabled])', { timeout: 30000 });
  await page.evaluate(() => { const g = window.__OCEAN_GAME__; g.applyReducedMotion(true); g.audio.setMuted(true); const q = document.getElementById('qa-hud'); if (q) q.style.display = 'none'; window.__OCEAN_API__.hudQa.noTransition(true); });
  if (process.env.CSS_FILE) {
    const css = fs.readFileSync(process.env.CSS_FILE, 'utf8');
    await page.evaluate((css) => { const s = document.createElement('style'); s.id = 'cand-css'; s.textContent = css; document.head.append(s); }, css);
  }
  const rows = [];
  for (const saved of [false, true]) {
    // 저장이 있는 모양을 DOM으로 만든다(가장 긴 해역 이름·가장 큰 숫자): 게임 refreshTitle()이 쓰는 문구 형식과 같다
    await page.evaluate(([saved, withQaButton]) => {
      const start = document.getElementById('start-sailing'), ng = document.getElementById('new-game-button'), pr = document.getElementById('title-progress');
      start.textContent = saved ? '이어하기' : '항해 시작';
      ng.hidden = !saved;
      pr.textContent = saved ? '도돌이 항구 · 도감 141/141 · 등대 7/7' : '';
      pr.hidden = !saved;
      document.getElementById('phase-status').hidden = true;
      document.getElementById('run-tests').hidden = !withQaButton;
    }, [saved, process.env.QA_BUTTONS === '1']);
    for (const [W, H] of VIEWS) {
      await page.setViewportSize({ width: W, height: H });
      for (const scale of SCALES) {
        const r = await page.evaluate((scale) => {
          document.documentElement.style.setProperty('--text-scale', scale);
          document.documentElement.dataset.textScale = String(scale);
          const ov = document.getElementById('title-overlay'), card = ov.querySelector('.title-card');
          const vis = (n) => { if (n.hidden || n.closest('[hidden]')) return false; const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = n.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
          let top = Infinity, bottom = 0, left = Infinity, right = 0;
          const parts = [];
          card.querySelectorAll('.eyebrow, h1, .title-mirror, .title-wave, .title-progress, .subtitle, .status, .title-actions button').forEach((n) => {
            if (!vis(n)) return;
            const b = n.getBoundingClientRect();
            top = Math.min(top, b.top); bottom = Math.max(bottom, b.bottom); left = Math.min(left, b.left); right = Math.max(right, b.right);
            parts.push({ q: n.id || n.className || n.tagName, t: Math.round(b.top), b: Math.round(b.bottom) });
          });
          const set = document.getElementById('title-settings').getBoundingClientRect();
          let ovSettings = 0;
          parts.forEach((p) => { /* 아래에서 다시 계산 */ });
          card.querySelectorAll('.eyebrow, h1, .title-mirror, .title-progress, .subtitle, .status, .title-actions button').forEach((n) => {
            if (!vis(n)) return;
            const b = n.getBoundingClientRect();
            const w = Math.min(b.right, set.right) - Math.max(b.left, set.left), h = Math.min(b.bottom, set.bottom) - Math.max(b.top, set.top);
            if (w > 2 && h > 2) ovSettings = Math.max(ovSettings, Math.round(Math.min(w, h)));
          });
          const btns = Array.from(card.querySelectorAll('.title-actions button')).filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, h: Math.round(r.height), visibleH: Math.round(Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) }; });
          const h1el = card.querySelector('h1'), h1 = getComputedStyle(h1el);
          const h1Lines = Math.round(h1el.getBoundingClientRect().height / (parseFloat(h1.fontSize) * 1.1));
          const scrolls = card.scrollHeight - card.clientHeight > 2;
          const cardRect = card.getBoundingClientRect();
          return {
            top: Math.round(top), bottom: Math.round(bottom), left: Math.round(left), right: Math.round(right),
            clipBottom: Math.max(0, Math.round(bottom - innerHeight)), slack: Math.round(innerHeight - bottom),
            ovSettings, btns, h1: Math.round(parseFloat(h1.fontSize)), h1Lines, scrolls, cardW: Math.round(cardRect.width), cardBottom: Math.round(cardRect.bottom),
            hidden: { subtitle: !vis(card.querySelector('.subtitle')), wave: !vis(card.querySelector('.title-wave')), mirror: !vis(card.querySelector('.title-mirror')) },
          };
        }, scale);
        const bad = [];
        if (r.clipBottom > 0) bad.push('아래 ' + r.clipBottom + 'px 잘림');
        if (r.cardBottom > H + 0.5) bad.push('카드 아래 끝이 화면 밖 ' + (r.cardBottom - H) + 'px');
        if (r.h1Lines > 2) bad.push('제목이 ' + r.h1Lines + '줄로 꺾임');
        if (r.scrolls) bad.push('카드가 스크롤됨');
        if (r.top < 0 || r.left < 0 || r.right > W + 0.5) bad.push('위·옆이 화면 밖');
        if (r.ovSettings > 0) bad.push('설정 단추와 겹침 ' + r.ovSettings + 'px');
        if (r.btns.some((b) => b.visibleH < 44 - 0.5 && b.h >= 44 - 0.5) || r.btns.some((b) => b.visibleH < b.h - 0.5)) bad.push('단추가 잘림');
        rows.push({ saved, W, H, scale, ...r, bad });
      }
    }
  }
  let nbad = 0;
  for (const r of rows) {
    if (r.bad.length) nbad++;
    console.log(`${r.saved ? '저장 있음' : '저장 없음'} ${String(r.W + 'x' + r.H).padEnd(9)} s${String(r.scale).padEnd(4)} 아래 여유 ${String(r.slack).padStart(4)}px  h1 ${r.h1}px×${r.h1Lines}줄 카드폭 ${r.cardW}  ${r.hidden.subtitle ? '' : '부제 '}${r.hidden.wave ? '' : '물결 '}${r.hidden.mirror ? '' : '거울 '}${r.bad.length ? '  ✗ ' + r.bad.join(' · ') : ''}`);
  }
  console.log(nbad ? 'TITLE SURVEY FAIL: 위반 ' + nbad + '칸 / ' + rows.length : 'TITLE SURVEY PASS: 위반 0 (' + rows.length + '칸)');
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows));
  await browser.close();
  process.exit(nbad ? 1 : 0);
})();

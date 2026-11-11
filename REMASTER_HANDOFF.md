# 물빛 리마스터 인수 문서 (REMASTER_HANDOFF)

> 트랙 `REMASTER` · 설계서 v1.0. 이 문서는 단계가 끝날 때마다 갱신한다.

## 지키는 것 (변경 금지)

- 이론 엔진·141개 용어 데이터·시련 규칙·오디오 합성(오디오 파일 0개)·`setState()` 전용 전환·세이브 `version:1`.
- `STATIC_WORLD_COLLIDERS`(부표·유리병 배치 계산용)는 바꾸지 않는다. 새 구조물의 충돌은 런타임 충돌체로만 더한다. (검사 O-04, O-05)
- 외부 origin 요청은 Three.js CDN 1건뿐이다. 새 코드·주석·셰이더 문자열에 `http://`·`https://`를 쓰지 않는다(V2).

## 리마스터 규칙 V1~V10 (요약)

V1 sRGB hex를 `lin()`으로 한 번만 선형 변환 · V2 URL 문자열 금지 · V3 수면 높이는 `waterY()` · V4 대기 값은 `AtmosphereDirector`만 쓴다 · V5 프레임 통계는 `RenderStats` · V6 가산 효과 밝기 상한 · V7 학습 텍스트 대비 4.5:1(12px 이하 7:1) · V8 동작 줄이기 분기·섬광 제한 · V9 low 품질은 추가 렌더 패스 0개 · V10 모델 교체는 충돌체·부표 좌표를 바꾸지 않는다.

## 현재 상태

- **RM0 완료(GRM0 통과).** `waterY()`·`RenderStats`·`resolveRenderPath()`·설정 `fx/hudQuiet/scenicCam`. 검사 817/817.
- **RM1 완료(GRM1 통과).** `AtmosphereDirector`(`10_atmosphere.js`)와 하늘 셰이더(`20_sky.js`)를 `// <REMASTER-CORE>` 블록에 주입했다. 소스는 `/home/claude/remaster/src/NN_*.js`, 주입은 `patches/inject.py`. 검사 824/824. 해역 분위기 고정(12분 낮밤 대체), 점등 계수 k, 점등 연출, 태양 방향 각속도 제한이 들어 있다.
- **RM2 완료(GRM2 통과).** 수면 셰이더·구멍 뚫린 원경 수면 판(`30_water.js`)이 들어갔다. 검사 828/828. 수면 메시는 법선을 재계산하지 않는다(옛 `?legacy=1` 경로의 퐁 재질만 계산).
- **RM3 완료(GRM3 통과).** `RenderPipeline`(`40_pipeline.js`)이 렌더 호출을 대신한다: 평면 반사(레이어 1) → 본 패스 → 블룸·합성 후처리. 품질별 계획은 `pipelinePlan()`이 정하고(low는 추가 패스 0개 + CSS 필터·비네트), 설정 `fx`(`auto/full/lite/off`)로 낮출 수 있다. 실패하면 `full → lite → off → 직접 렌더`로 한 단계씩 내려간다. 검사 834/834(리마스터 23/23). 소용돌이 세기만큼 반사가 줄고 세기 1에서 반사 패스를 건너뛴다.
- **RM4 완료(GRM4 통과).** `CameraDirector`(`50_camera.js`)가 `updateCamera()`를 대신한다: 조타(뒤 31·높이 6.6·FOV 53)·발견·감상(8초 무입력)·점등·타이틀 다섯 모드를 순수 함수 `cameraModeFor()`가 고른다. 해역 표제 카드가 `region-banner`를 대체했고(900/2600/900ms, 동작 줄이기는 즉시), 점등 연출은 검은 띠·4.2초 표제·5초 자동 지도 시간표(`LIGHTHOUSE_STAGE`)를 얻었으며, 타이틀은 3D 첫 프레임 뒤 포스터가 걷힌다. 점등 곡선·일정은 순수 함수(`atmosphereLightProgress`, `lighthouseLightSchedule`)다. 검사 838/838(리마스터 27/27). 옛 카메라는 `?qa=1&legacy=1`에서만 `updateCameraLegacy()`로 남는다. QA는 `__OCEAN_API__.cameraQa`(`snapshot`·`setIdle`·`noteInput`·`snap`·`occlusion`·`composition`·`steer`·`lighthouse`·`regionCard`·`lighthouseStage`).
- **RM5 완료(GRM5 통과).** `60_lanterns.js`가 `// <REMASTER-CORE>` 블록에 들어갔다: 4단 툰 재질 치환, 등불 부표(90+4삼각형·2부품·인스턴스·그림자 없음), 유리병(110+4)·시련 문(178), 배 등불(`PointLight` 0.6→1.1), 수면 사건 고리(품질별 2/4/8칸), 무드별 입자 풀(low 800·mid 1,400·high 2,000·동작 줄이기 500), 음악 연동 사상 `musicVisualPlan`(큐에 `scaleDegree`·`chordTones`·`key` 추가), 섬광 제한(초당 3회·하늘만 ≤0.35·동작 줄이기 ≤0.12·덮개 0), 그림자 대상 정책(배와 반경 72m 안의 랜드마크만). 검사 843/843(리마스터 32/32). 본 패스 삼각형이 아홉 지점에서 69,134~69,590 줄었다. 141개 용어(부표 128 + 희귀 병 13)와 병 18개 전부 수집됨. 돛 뒤 등불은 `updateLanternSailThrough`(카메라 110m 안, 카메라에서 본 배의 각 크기 안에 드는 미수집 등불에 광선 8개까지)가 `aThrough=1`을 주어 **빛 덩이만** 돛 위로 비친다(몸체는 여전히 가려짐). storm·aurora 팔레트를 보정했다(최대 편차 0.042).
- **RM6 완료(GRM6 통과).** 해역 랜드마크 아홉 종(`70_landmarks.js`, 데이터 표 `72_landmark_data.js`는 `tools/build-landmarks.cjs`가 만든다. 근경 `assets/remaster/models/landmark-r<N>-*.glb`, 원경 대역 `…-far.glb`), 배·영웅 등대의 반사·그림자 대역(≤400삼각형), 런타임 충돌체(r0 2·r5 7·r7 1·r8 3; 정적 충돌체 42개 불변), 음악 연동 노드 접두어(`Beat_` 박 · `Glow_` 발광 · `Sway_` 흔들림 · `Lantern_` 숨 쉬는 등). 검사 846/846(리마스터 35/35). 아홉 지점 모두 5.12절 최종 예산 안: 그림자 ≤ 26호출/13,552 · 반사 ≤ 41/25,100 · 본 ≤ 107/101,969 · 합계 ≤ 161/136,277. 근경이 안 보이는 거리에서는 원경 대역이, 둘 다 실패하면 원시 도형이 남는다. 모델은 **코드로 만든 절차적 GLB**다(Blender 제작 아님). 원경 대역의 발광은 쉬는 값 0.4로 고정이고, 돛 대역 색은 민트 돛 업그레이드를 따르지 않는다.
- **RM7 시작 전 알아 둘 것.**
  - RM7에서 풀 것: 점등 연출 중 "건너뛰기" 버튼과 미니맵 겹침(몰입 HUD), 세로 화면(390 폭)에서 표제 카드와 왼쪽 위 해역 알약 겹침, 타이틀의 배가 제목 카드 뒤에 가림. (해역 0 출발선 겹침은 RM6에서 해소됨 — 스캔으로 확인.)
  - 부표 128개·유리병 18개 위치는 `STATIC_WORLD_COLLIDERS`와 시드로 결정된다. 새 발자국은 이들에서 r+14 이상 떨어져야 한다(O-33).
  - 게임 시간이 실제 시계의 약 7.6%로 흐른다(소프트웨어 렌더). 튜토리얼 미완료 상태에서 원거리 해역에 두면 항구 복귀 힘이 배를 끌어당긴다 → QA는 `startSailing(page)`(prepare 기본값: 튜토리얼 완료 + 외곽 등대 점등)을 쓴다.
  - 새 글·CSS·검사에 `http://`·`https://` 문자열과 `data:` 주소를 쓰지 않는다(검사가 문서 전체에서 센다).

## 되돌리기

QA 주소 `?qa=1&legacy=1`은 리마스터 렌더 경로를 끄고 옛 한 줄 렌더로 돈다(RM9까지 유지).

## 도구

`output/playwright/qa-scripts/remaster/` — `run-tests.cjs`(전체 검사), `capture-points.cjs`(고정 촬영 지점 캡처), `capture-moods.cjs`(무드·점등 계수 캡처), `capture-rm3.cjs`(품질×fx 18장), `rm3-check.cjs`(행렬·20회 반복·컨텍스트 손실·지점별 패스), `rm3-maelstrom.cjs`(소용돌이 반사 감쇠), `perf-rm3.cjs`(참고용 프레임 시간), `render-stats.cjs`(패스별 렌더 통계), `rm4-smoke.cjs`(카메라 모드·구도 수치·동작 줄이기·표제 카드·타이틀), `rm4-occlusion.cjs`(돛 가림 게이트), `rm4-trials.cjs`(시련 4종 + 점등 연출 S1~S3), `rm4-capture.cjs`·`rm4-lighthouse-capture.cjs`(표제 카드·타이틀·조타 구도·점등 연출 캡처), `tone.py`(화면 밝기·채도), `sheet.py`(접촉 시트). RM5·RM6: `rm5-check.cjs`·`rm5-journey.cjs`·`rm5-sail.cjs`·`rm5-sync.cjs`·`rm5-tone.cjs`·`rm5-visual.cjs`, `rm6-landmark.cjs --region N`(해역별 랜드마크 게이트: 정상·실패 주입 3종·실루엣·수집 여유·출발 겹침), `rm6-music.cjs`(음악 연동 라이브 74항목), `rm6-casters.cjs`(그림자·반사 대상 목록). 소스·도구는 `game/` 밖 `/home/claude/remaster/`에 있다: `src/NN_*.js`(리마스터 코어, `patches/inject.py`가 `// <REMASTER-CORE>` 블록에 주입), `src/ui.css`(`patches/inject-ui.py`가 `<style id="remaster-ui">`로 주입), `tools/build-landmarks.cjs`·`glb-kit.cjs`·`preview-glb.cjs`·`footprint-check.py`(랜드마크), `tools/rm6-report.py`(보고서 표), `tools/dev-server.cjs <폴더> <포트>`(시험 사본 서빙 — QA에는 `BASE_URL`을 준다), `tools/rebuild-dev7.sh`(시험 사본 재구성), `tools/build-fonts.py`(서체 서브셋). 검사용 서버는 별도로 띄우지 않아도 된다: `lib.cjs`가 스크립트 안에서 게임 폴더를 `127.0.0.1:8765`로 내주고(스크립트가 끝나면 함께 닫힌다) 이미 그 포트를 쓰는 서버가 있으면 그것을 쓴다. 그래서 QA 스크립트는 **한 번에 하나씩** 돌린다. 로컬 three r128 min.js 경로는 `THREE_JS` 환경변수로 준다.

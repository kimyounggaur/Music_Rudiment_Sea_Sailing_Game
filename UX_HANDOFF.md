# 음악이론의 바다 — UX_HANDOFF

최종 작업 폴더: `D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임`

[실행 파일 index.html](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/index.html>)에 U0~U7 UX 개선을 통합했다. 게임의 단일 파일 구조, 141개 용어, 기존 796개 기능 검사와 첫 시도 점수 규칙을 보존했다. 외부 의존성 추가는 0건이며, 기존 Three.js r128 CDN 1건만 사용한다. 로컬 개발 결과이며 배포·push는 하지 않았다. 사용자가 첨부한 설계·개발서 원본도 변경하지 않았다.

사용자의 명시적 지시에 따라 GU0~GU7 진행 승인을 자율 처리했다. 기능·화면 검증은 아래에 기록한 범위에서 통과했다. 최신 v13 단독 브라우저 측정에서 UI 평균·p95와 평균 FPS는 목표 이내다. UI 최대값은 2.1ms로 목표보다 0.1ms 높아 모든 프레임의 2ms 이하 처리는 보장하지 않는다. 물리 기기와 실제 스크린리더 등 미실행 항목은 별도로 남겼다. 모든 픽셀과 연출이 설계에 100% 일치한다는 의미는 아니다.

## HANDOFF

```yaml
HANDOFF:
  track: UX
  completed_substep: U7 구현·브라우저 검증
  last_passing_gate: GU7 BROWSER_PASS # 모든 프레임 UI 2ms 이하는 보장하지 않음; 전체 실기기 DoD와 구분
  design_tokens_version: 1
  approval: U0~U7 사용자 지시에 따른 자율 승인
  current_app_state: 단일 파일 항해 게임의 HUD·학습·시련·메뉴·연출을 개선한 로컬 실행본
  functional_tests: 796/796
  ux_tests: 15/15
  screenshots_after: 240 # v14 터치 상태 강제 전량 재캡처 완료
  screenshots_before: 25
  endurance_30m: PASS # v7 본체, 1,800,014ms
  ui_repetition_v11: PASS # DOM·리스너·UI 타이머·Canvas 증가 0
  desktop_isolated_performance_v11: PASS # 10초, 123.74fps, UI 최대 2.0ms
  final_polish_v12: PASS # 811/811 회귀, 튜토리얼 완료 표시·힌트 제외 연출 확인
  ui_repetition_v12: PASS # UI 50회·시련 20회·회전 20회, 추적 자원 증가 0
  desktop_performance_v12: MEAN_P95_PASS_WITH_SPIKE # 10초, 87.36fps, UI 평균 0.938/p95 1.7/최대 2.6ms
  final_regression_v14: PASS # 811/811, Three.js 요청 1건, 실제 저장 불변
  final_touch_v14: PASS # 두 포인터 유지·해제, 72px, below44 0, 중앙 안전영역 0
  latest_performance_version: v13 single browser
  ui_mean_p95_v13: PASS # 평균 0.645ms, p95 1.3ms
  strict_ui_max_v13: NOT_MET # 최대 2.1ms, 목표보다 0.1ms 초과
  average_fps_v13: PASS # 10초 평균 97.34fps, 1% low 45.33fps
  forced_gc_heap: OBSERVED # 39.40MB → 11.48MB, 장기 누수 0을 보장하지 않음
  physical_mobile_haptics_screenreader_gpu: NOT_RUN
  unresolved_decisions: []
  first_action_next_session: 아래 실행·회귀 절차로 현재 파일과 증거를 다시 대조
  deployment: 로컬만, 배포·push 하지 않음
```

**최종 index.html SHA256:** `5BFFD92553847DB567635660733DBB187FFF146F48AB353D9282BD11CDBC1B5C`. v14 최종 회귀와 터치 재검사 후 실제 파일의 해시를 확인했다. BUILD_MANIFEST는 `U7 COMPLETE (local implementation)` / `GU7 BROWSER_PASS`이며 commit/push는 하지 않았다.

구체적인 29항목 추적표와 수치·한계는 [UX_GATE_REPORT.md](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/UX_GATE_REPORT.md>)가 기준이다. 문서와 차이가 있으면 현재 코드와 실제 재실행 결과를 우선한다.

## 실행과 재현

개발 서버가 실행 중이면 [기본 게임](http://127.0.0.1:8765/)을 연다. 서버가 종료되어 있으면 위 작업 폴더의 터미널에서 다음 명령을 실행한다.

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

- [기능·UX 전체 검사](http://127.0.0.1:8765/?test=1): 3D 플레이 없이 811개 검사를 표시한다.
- [저장 격리 QA 플레이](http://127.0.0.1:8765/?qa=1): QA 전용 준비 도구와 메뉴를 사용한다. QA 조작은 메모리 저장으로 격리되며 실제 저장 데이터는 유지된다.
- 기본 URL은 플레이어용이다. QA 탭 0개, 금지어 0개, 외부 네트워크 요청은 Three.js 1건임을 확인했다.
- 소스 변경 뒤 캐시가 남으면 QA URL에 `&v=새값`, 기본 URL에 `?v=새값`을 붙여 다시 연다.

키보드 기본 경로는 시작 → W/↑로 이동, A/D로 회전 → 빛나는 부표 발견 → 들어보기 → Esc → B로 도감 → 등대 가까이에서 E로 대화 → 시련이다. 시련은 숫자 1~4, 방향키, Enter 또는 보기 클릭으로 응답한다. 기호는 드래그하거나 기호와 용어를 차례로 클릭해 연결한다. Esc/P는 항해 메뉴, M은 지도, Space는 뱃고동이다. 터치에서는 조이스틱, 카메라 패드, 오른쪽 액션 버튼을 사용한다.

QA 재현 시 시작 버튼으로 항해에 들어간 뒤 브라우저 콘솔에서 다음 기존 API를 사용할 수 있다. 이는 상태 준비용 fixture이며, 정상 플레이 전체 과정을 검증한 결과로 대신 보고하지 않는다.

```javascript
const a = window.__OCEAN_API__;
const g = window.__OCEAN_GAME__;
a.questQa.prepare(1);
g.openKeeperDialogue(1);
// 대화의 시련 시작 버튼으로 네 문형, 복기, 점등을 확인한다.
```

항해 상태에서 B로 도감, Esc로 메뉴를 연다. 일반·히든 엔딩은 각각 `a.journeyQa.prepareNormalFinale()` 또는 `a.journeyQa.prepareHiddenFinale()`로 준비한 뒤 `g.beginFinalRoute()`를 실행한다. 각 항로는 화면 버튼으로 진행한다. `a.journeyQa.snapshot()`의 `activeMemory`와 `realStorageUnchanged`로 QA 저장 격리를 확인할 수 있다.

## 최종 터치 배치 보완

v14에서는 터치 상태에서 발견한 중앙 안전영역 위반을 수정했다. 세로 화면의 조이스틱은 88~116px로 조정하고, 수집 카운터를 바로 위에 작게 배치했다. 오른쪽은 주 액션 72px와 보조 버튼 56px 두 개를 세로로 배치한다. 가로 화면은 액션 묶음을 오른쪽 가장자리로 옮기고 카운터와 목표 칩을 하단에서 분리했다. 포인터 소유권 코드는 유지했다.

수정 후 터치 상태로 전수 촬영한 240장에서 중앙 안전영역·터치 영역·대비·가로 넘침 위반은 모두 0이었다. 이전 v13의 중앙 안전영역 위반 기록은 수정 전 이력이다.

최종 CSS 적용 후 [touch-final.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/touch-final.json>)으로 포인터 소유권도 다시 확인했다. 조이스틱과 카메라를 누른 채 액션을 입력해도 두 포인터가 유지되고, 해제 후 모두 null로 돌아왔다. 주 액션 72px, below44 0, 중앙 안전영역 위반 0, 회귀 811/811을 확인했다.

## 검증 결과와 버전 범위

- 독립 회귀 **811/811**: 기존 검사 110+564+10+8+25+48+31개와 UX 검사 15개가 통과했다. v12 마무리 검증과 **v14 최종 회귀**에서도 같은 811개가 통과했다. 최종 회귀에서 외부 요청은 Three.js 1건이었고, QA의 메모리 저장 격리와 실제 저장 불변을 확인했다.
- **v14 최종 터치 화면 검증 240장:** 필수 17상태와 보기 서랍을 연 3상태 × 6개 뷰포트(320×568, 375×812, 390×844, 844×390, 768×1024, 1440×900) × 글자 배율 1.0/1.3. 안전 영역, 44px 터치 영역, CSS 대비, 금지어, 가로 넘침 위반은 0건이었다. 터치 상태를 강제로 유지해 다시 촬영했다. 320×568/1.3배율과 844×390/1.3배율 화면도 육안 확인했다.
- 브라우저 터치 검증에서 주 액션은 **72×72px**였다. 두 터치 포인터로 조이스틱과 카메라를 누른 채 액션을 클릭해도 각 포인터의 소유권이 유지됐으며, 해제 후에는 `null`이었다. 도감 상세의 포커스 트랩도 확인했다.
- 네 시련형을 실제 키보드·클릭으로 완주했다. 일부러 틀린 첫 답이 복기에 보존됐고, 수정 후에도 점수는 **4/5**로 유지됐다. 새 항해 튜토리얼의 단계 전환, 항구 **5/5**, 무음 심해 **5/5**, 실제 마우스 드래그 완주도 확인했다. 부표 접근과 심해 준비에는 QA 좌표·데이터 fixture를 사용했다.
- **v11 UI 반복 검증:** DOM 1355→1355, 리스너 146→146, Canvas 9→9, UI 타이머 0→0. 실제 저장 데이터는 변하지 않았다.
- **v12 UI 반복 검증:** UI 50회, 시련 20회, 화면 회전 20회를 재실행했다. DOM 1355→1355, 리스너 146→146, Canvas 9→9, UI 타이머 0→0이며, 추적한 GPU 자원과 오디오 소스·타이머도 증가하지 않았다. 실제 저장 데이터는 변하지 않았고 터치 포인터 소유권과 포커스 트랩도 재확인했다. heap +11.36MB는 GC를 실행하지 않은 결과이므로 누수 0으로 단정하지 않는다.
- **v7 본체 30분 실측:** 1,800,014ms 동안 도감 50회, 메뉴 50회, 시련 20회, 화면 회전 20회를 실행했다. 오류는 0건이며 장면 자원, 오디오 타이머, Canvas 수가 유지됐다. 리스너 +1은 시험 cleanup 등록이다. GPU 초기 캐시는 10분 시점 78개에서 30분 시점 78개로 유지됐다. heap +8.33MB는 GC를 실행하지 않은 결과이므로 누수 0의 증거로 쓰지 않는다.
- **v11 단독 데스크톱 브라우저 성능:** 10초 동안 평균 **123.74fps**, 1% low **73.61fps**, UI 평균 **0.480ms** / p95 **1.0ms** / 최대 **2.0ms**, 최대 **68 draw calls / 31,968 triangles**였다. 병행 QA 창을 동시에 띄운 30분 말미의 **42.78fps**와 동시 부하 10초의 **51.96fps**는 별도 환경의 결과다.
- **v12 단독 데스크톱 브라우저 성능:** 10초, **875개 샘플**에서 평균 **87.36fps**, 1% low **50.11fps**, UI 평균 **0.938ms** / p95 **1.7ms** / 최대 **2.6ms**, **57 draw calls / 31,731 triangles**였다. UI 평균과 p95는 2ms 목표 이내지만 최대값에는 **2.6ms 스파이크**가 있었다. UI 반복 세션의 누적 최대 8.4ms는 이 단독 10초 측정과 별도다.
- **v12 최종 마무리:** 아래 네 설계 차이를 구현하고, 튜토리얼 완료 표시, 최초 방문 배너, 힌트 제외 상태를 브라우저에서 확인했다. 정오답 자막에는 선택한 용어명도 표시하도록 보완했다. v7의 30분 실측, v11의 과거 반복·성능 결과, v12의 재검증 결과는 각각 별도 실행이다.
- **v13 처리량 개선:** 목표 문구는 상태가 바뀔 때만 계산하고, 수집 여부 조회는 `Set`으로 캐시했다. 월드 라벨의 종류·투명도·숨김 속성도 값이 바뀔 때만 DOM에 쓴다. 이 변경에는 레이아웃이나 게임 기능 변경이 없다.
- **최신 대표 성능은 v13 단독 브라우저 측정:** 남아 있던 별도 QA 브라우저를 닫고 재측정했다. 10초, UI **974개**·프레임 **975개 샘플**에서 평균 **97.34fps**, 1% low **45.33fps**, UI 평균 **0.645ms** / p95 **1.3ms** / 최대 **2.1ms**, **57 draw calls / 31,901 triangles**였다. UI 평균·p95와 평균 FPS는 목표 범위로 판정한다. UI 최대값이 목표보다 **0.1ms 높아 모든 프레임의 2ms 이하 처리는 보장하지 않는다.**
- **이전 v13 동시 부하 측정:** 당시 남아 있던 예전 UX 감사 브라우저와 주 QA 브라우저, 총 두 브라우저가 GPU를 동시에 사용했다. 10초, **583개 샘플**의 평균 **58.22fps**, 1% low **27.24fps**, UI 평균 **1.136ms** / p95 **1.9ms** / 최대 **2.9ms**, **56 draw calls / 31,833 triangles**는 이 환경의 결과다. v11의 123.74fps, v12의 87.36fps와 함께 과거 환경의 기록으로 보존하며, 최신 단독 측정의 판정을 대신하지 않는다.
- **최종 강제 GC 확인:** heap은 **39.40MB→11.48MB**로 줄었다. 최종 스냅샷에서 DOM 1355개, 리스너 146개, Canvas 9개, UI 타이머 0개가 유지됐으며, 장면 자원은 객체 162개·지오메트리 111개·재질 84개·텍스처 14개였다. 렌더러 지오메트리 78개와 텍스처 2개도 기록했다. 회수 가능한 메모리를 확인한 결과이며, 모든 누수가 없음을 보장하는 장기 시험으로 해석하지 않는다.

### 완료된 마지막 설계 차이

| 항목 | 구현과 확인 근거 |
|---|---|
| 나침반 글자 | Canvas 글자를 11px로 변경했다. 전량 화면 검증 후 배치 반경을 조정했으며, 별도 화면과 회귀를 확인했다. |
| 튜토리얼 단계 완료 | ✓ 완료 문구를 표시하고 800ms 동안 퇴장한 뒤 다음 단계로 전환한다. 동작 줄이기 설정에서는 즉시 전환한다. 브라우저 기록에서 `✓ 1/6 · 완료했어요` → `2/6 · 배를 돌려 보세요`를 확인했다. |
| 최초 방문 배너 | 처음 방문한 해역의 배너에 `새 항로` 표식을 추가했다. 브라우저 기록에서 `리듬 폭풍 해역 / 새 항로 · 리듬·박자의 바다`를 확인했다. |
| 힌트로 제외한 부표 | 회색으로 가라앉는 연출과 `× 제외` 라벨을 추가하고 충돌 판정에서 제외했다. 브라우저 기록에서 색상 `#89999d`, 가라앉기 진행값 `0.987`, 제외 라벨을 확인했다. 충돌 제외 분기는 현재 소스에서 확인했다. |

회귀와 상태 기록은 [polish-validation.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/polish-validation.json>)에 있다. [튜토리얼 완료 화면](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/ux_U7_tutorial-complete_1440x900_after.png>)과 [힌트 제외 화면](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/ux_U7_hint-sink_1440x900_after.png>)도 남겼다.

최초 방문 배너와 나침반 조정 후의 811/811 회귀는 [banner-compass.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/banner-compass.json>)에 기록했다.

[대표 상태 스크린샷 갤러리](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/README.md>)에서 화면을 비교할 수 있다. 대표 증거는 다음 파일에 있다.

| 용도 | 파일 |
|---|---|
| 독립 전량 회귀 | [release-audit-regression.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/release-audit-regression.json>) |
| v14 최종 회귀·네트워크·저장 격리 | [final-regression.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/final-regression.json>) |
| 전량 화면·레이아웃·대비 | [expanded-qa.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/expanded-qa.json>) |
| v11 UI 반복·터치·포커스 | [final-validation.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/final-validation.json>) |
| v12 UI 반복·터치·포커스 | [final-validation-v12.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/final-validation-v12.json>) |
| v12 마무리 회귀·연출 상태 | [polish-validation.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/polish-validation.json>) |
| 첫 답 복기·4문형 | [interaction-qa.txt](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/interaction-qa.txt>) |
| 새 항해·무음 심해·마우스 드래그 | [journey-final.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/journey-final.json>) |
| 기본 URL·네트워크 | [player-default-audit.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/player-default-audit.json>) |
| v7 본체 30분 실측 | [endurance-final.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/endurance-final.json>) |
| v11 단독 데스크톱 성능 | [performance-isolated.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/performance-isolated.json>) |
| v12 단독 데스크톱 성능 | [performance-v12.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/performance-v12.json>) |
| v13 이전 동시 부하 성능 | [performance-v13.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/performance-v13.json>) |
| v13 최신 단독 브라우저 성능 | [performance-release.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/performance-release.json>) |
| 최종 강제 GC·자원 스냅샷 | [heap-final.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/heap-final.json>) |
| 원본 before 25장 | [baseline-fixed-qa.json](<D:/256G 1/01 레슨디자이너-반응형 웹사이트/음악이론_바다_항해_게임/output/playwright/baseline-fixed-qa.json>) |

before는 원본 5상태 × 5개 뷰포트의 대표 세트다. 각 Substep 전체에 대한 비교 세트는 아니다. after 스크린샷 이름은 `ux_U7_{state}_scale{scale}_{width}x{height}_after.png`다. [원본 백업 original-index.html](<C:/Users/kimyo/.codex/ux-work/original-index.html>)은 보관용이며, 현재 실행본을 자동으로 되돌리는 파일이 아니다.

## 남은 범위와 검증 한계

실기기 휴대폰의 주소창·노치, 물리 햅틱, 실제 스크린리더, 모바일 GPU, 세 입력 방식 각각의 독립 전체 여정, 141개 데모의 실제 청취는 **NOT_RUN**이다. 저장 리로드, 차단된 저장소, 실제 탭 복귀 후 청취는 기능 회귀와 이번 브라우저 실측 범위를 구분해 게이트 보고서에 기록했다.

대비 검사는 CSS 합성의 근사값이다. Canvas 텍스트와 월드 라벨은 제외했으며, 그라디언트는 첫 색상을 사용했다. 30분 증거는 v7 본체에서 수행했다. v11과 v12의 UI 반복·성능, v13의 동시 부하·최신 단독 성능, v14 회귀, v14의 최종 터치 전량 화면 검증은 각각 별도 증거다. 이를 “최종 빌드의 30분 전후 모든 메모리 증가 0”으로 보고하지 않는다.

다음 작업에서는 기존 사용자 문서와 세이브를 보존하고, 현재 파일의 회귀와 대표 뷰포트부터 재확인한다. 배포는 현재 완료 범위에 포함되지 않는다.

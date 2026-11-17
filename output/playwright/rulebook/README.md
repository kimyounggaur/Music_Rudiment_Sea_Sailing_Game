# 룰북 측정 증거 (RM9 이후, 별도 작업)

룰북을 넣은 빌드(`tools/buildfp.py game` = `1d63d0225acb227f`, `--norm` = `86008987adfb80e0`)를 직접 잰 값이다.
RM9 증거(`../rm9-*.json`, `../rm9ui/`)는 룰북이 없던 빌드(`8aba8b7208dc09d6`)를 잰 것이고 이 폴더가 그것을 대신하지 않는다.
요약과 해석은 `REMASTER_HANDOFF.md`·`REMASTER_GATE_REPORT.md`의 "RM9 이후: 룰북" 절에 있다.

| 파일 | 만든 도구(작업대 `tools/`·`game/output/playwright/qa-scripts/remaster/`) | 내용 |
|---|---|---|
| `qa-run.log` | 아래 도구를 한 번에 하나씩 돌린 러너의 전체 출력 | 단계별 시각·종료 코드·표준 출력 |
| `boot-sweep.json` | `boot-sweep.cjs '' 0,1` | 화면 크기 × 터치 58행: 실제 주소·`?qa=1`이 시작되는지, 배치 검사 실패 |
| `boot-sweep-scale13.json` | `TEXT_SCALE=1.3 boot-sweep.cjs '' 0` | 글자 배율 1.3에서 29행 |
| `boot-saves.json` | `boot-saves.cjs` | 저장 종류 24가지를 진짜 `localStorage`에 심고 여는 시험 |
| `survey-title.json` | `survey-title.cjs` | 타이틀 화면 108칸(두 머리 단추·카드 자리) |
| `survey-hud.json` | `survey-hud.cjs` | 항해 HUD 204칸(RM9 기준선과 같은 21칸이 위반) |
| `network.json` | `rm9-network.cjs` | 외부 origin 요청·문서 안 절대 주소 문자열 |
| `invariants.json` | `rm9-invariants.cjs` | 처음 게임과 같은 소스 블록·실행 값·저장 호환 |
| `flow.json` | `tools/rulebook/qa/rb-flow.cjs` 마지막 묶음 C(좁은 화면 터치) | 룰북 열기·닫기 흐름. A(데스크톱 키보드·포인터)·B(항해 중)는 같은 결과 파일 이름을 써서 덮였으므로 `qa-run.log`의 항목별 출력을 본다 |
| `ingame-audit.json` | `rb-ingame-audit.cjs` | 게임 자체의 대비·문구·터치 크기 검사를 룰북 23장 × 낮·밤 × 화면에 적용 |
| `hud-chip.json` | `rb-hud-chip.cjs` | 항해 HUD 룰북 칩 자리 112칸 |
| `text-scan.json` | `rb-text-scan.cjs` | 본문에 남은 표시 기호·명조 서체에 빠진 글자·삽화를 그리는 시간 |
| `pristine-boot-sweep-touch.json` | `boot-sweep.cjs`(룰북을 넣기 전 파일을 따로 내줘서) | 터치 배치 실패 4곳이 룰북 전에도 있었음을 보이는 대조 |
| `fig-contrast.json` | `tools/rulebook/qa/rb-fig-contrast.cjs` | 삽화 89점 안 글자의 대비(게임의 대비 검사가 건너뛰는 `svg` 안): 3구성 × 낮·밤 6조합, 글자 1,715개, 기준 미달 0 |
| `apply-roundtrip.txt` | `tools/rulebook/apply.py`(러너 마지막 단계) | 다시 만들기·걷기·다시 넣기 결과를 지문으로 대조 |
| `shots/*.png` | `rb-shots.cjs world·book` | 타이틀·항해 HUD(데스크톱·폰) 6장과 룰북 장면 15장, 모두 21장(`desk-worldmap-night`·`phone-chromatic-night`·`phone-syncopation-night`는 대비를 고친 삽화를 밤 종이로 찍은 것) |

그 밖에 `rb-title-buttons.cjs`(안전영역 없음·세로·가로 3벌, 각 156칸)·`rb-link-hit.cjs`·`rb-audit.cjs`(삽화 89점 감사, 폭 720·폭 390 밤)는 콘솔 출력만 `qa-run.log`에 있다.

다시 만들려면(작업대 안): `cd game && node ../tools/rulebook/qa/<이름>.cjs`, `node output/playwright/qa-scripts/remaster/<이름>.cjs`. 한 번에 하나씩 돌려야 측정이 흔들리지 않는다(헤드리스가 느려 겹쳐 돌리면 결과가 달라진다).

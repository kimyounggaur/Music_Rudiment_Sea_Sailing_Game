#!/usr/bin/env python3
"""무드 화면 값 판정: 캡처(32x18 축소 평균)와 기준 값의 차가 ±0.08 이내인지. 사용: tone-check.py <접두어> [--json 출력파일]
접두어 예: output/playwright/rm_RM5  → rm_RM5_r{0..8}-*_k1_1440x900_after.png (k=1) 과 _k0_ (있으면) 를 읽는다."""
import sys, glob, json
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from tone import tone

TARGET = {0: ('dawn', 0.45, 0.31), 1: ('golden', 0.53, 0.67), 2: ('storm', 0.35, 0.40), 3: ('deep', 0.16, 0.73), 4: ('mist', 0.65, 0.16),
          5: ('bluehour', 0.33, 0.50), 6: ('lagoon', 0.60, 0.33), 7: ('aurora', 0.15, 0.77), 8: ('starmirror', 0.30, 0.46)}
prefix = sys.argv[1]
rows, worst = [], 0.0
for i in range(9):
    files = sorted(glob.glob(f'{prefix}_r{i}-*_k1_1440x900_after.png'))
    if not files:
        print('없음', i); continue
    lum, sat = tone(files[0])
    mood, tl, ts = TARGET[i]
    dl, ds = round(lum - tl, 3), round(sat - ts, 3)
    worst = max(worst, abs(dl), abs(ds))
    # 미점등 화면: 방문했지만 점등하지 않은 해역의 점등 계수 0.35(k0.35)를 먼저 찾고, 없으면 잠긴 상태 0(k0)을 쓴다. 어느 쪽인지 줄 끝에 적는다.
    k0, klabel = [], ''
    for kk in ('0.35', '0'):
        k0 = sorted(glob.glob(f'{prefix}_r{i}-*_k{kk}_1440x900_after.png'))
        if k0:
            klabel = 'k' + kk
            break
    k0s = tone(k0[0]) if k0 else None
    rows.append([i, mood, tl, ts, lum, sat, dl, ds] + (list(k0s) + [klabel] if k0s else []))
    print(f'{i} {mood:10s} 기준 {tl:.2f}/{ts:.2f}  측정 {lum:.3f}/{sat:.3f}  오차 {dl:+.3f}·{ds:+.3f}  {"OK" if abs(dl) <= 0.08 and abs(ds) <= 0.08 else "초과"}')
print('최대 편차', round(worst, 3), '→', 'PASS' if worst <= 0.08 else 'FAIL')
if '--json' in sys.argv:
    json.dump(rows, open(sys.argv[sys.argv.index('--json') + 1], 'w'), ensure_ascii=False)

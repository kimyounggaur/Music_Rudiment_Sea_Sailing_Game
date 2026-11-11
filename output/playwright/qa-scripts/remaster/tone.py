#!/usr/bin/env python3
"""캡처를 32x18로 줄여 평균 밝기·평균 채도를 잰다(설계서 10.2절). 사용: tone.py 파일... [--json]"""
import sys, json
from PIL import Image
import numpy as np

def tone(path):
    im = Image.open(path).convert('RGB').resize((32, 18), Image.BILINEAR)
    a = np.asarray(im, dtype=np.float64) / 255.0
    lum = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]).mean()
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0).mean()
    return round(float(lum), 3), round(float(sat), 3)

if __name__ == '__main__':
    files = [f for f in sys.argv[1:] if not f.startswith('--')]
    out = {f.split('/')[-1]: tone(f) for f in files}
    if '--json' in sys.argv:
        print(json.dumps(out, ensure_ascii=False))
    else:
        for k, (l, s) in out.items():
            print(f'{k}: 밝기 {l} 채도 {s}')

"""하늘 띠(위 18%) 평균색의 프레임 간 변화. 사용: python3 skyband.py rm1-continuity.json"""
import json, sys
from PIL import Image
d = json.load(open(sys.argv[1]))
for fs in d.get('frames', []):
    prev = None; steps = []; means = []
    for f in fs['files']:
        im = Image.open(f).convert('RGB'); w, h = im.size
        band = im.crop((0, 0, w, int(h * 0.18))).resize((16, 4))
        px = list(band.getdata()); m = [sum(c[i] for c in px) / len(px) for i in range(3)]
        means.append([round(v, 1) for v in m])
        if prev: steps.append(max(abs(m[i] - prev[i]) for i in range(3)))
        prev = m
    avg = sum(steps) / len(steps)
    print(fs['pair'], 'steps', [round(s, 1) for s in steps], 'max', round(max(steps), 1), 'avg', round(avg, 1), 'max/avg', round(max(steps) / max(avg, 1e-6), 2))

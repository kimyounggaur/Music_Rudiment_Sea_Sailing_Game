#!/usr/bin/env python3
"""접촉 시트: 파일 목록을 격자로 이어 붙인다. 사용: sheet.py out.jpg cols tile_w file1 file2 ... (라벨은 파일명 일부)"""
import sys
from PIL import Image, ImageDraw
out, cols, tw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
ims = [Image.open(f).convert('RGB') for f in files]
th = int(tw * ims[0].size[1] / ims[0].size[0])
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * th), (20, 20, 24))
d = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(files, ims)):
    t = im.resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * th
    sheet.paste(t, (x, y))
    name = f.split('/')[-1].replace('rm_RM1_', '').replace('_after.png', '')
    d.rectangle([x, y, x + tw, y + 14], fill=(0, 0, 0))
    d.text((x + 3, y + 2), name, fill=(255, 255, 255))
sheet.save(out, quality=88)
print(out, sheet.size)

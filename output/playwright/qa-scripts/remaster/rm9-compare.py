#!/usr/bin/env python3
"""RM8 빌드와 RM9 빌드의 같은 고정 촬영 지점 화면을 비교한다(옛 하늘·낮밤·바다·안개벽 경로를 지운 뒤 화면이 달라졌는가).

사용:
  python3 rm9-compare.py --a <RM8 캡처 폴더> --noise <RM8 두 번째 캡처 폴더> --b <RM9 캡처 폴더> --out <json>
  (세 폴더는 capture-points.cjs가 같은 옵션으로 만든 PNG 묶음이다. 파일 이름의 순서로 짝을 맞춘다.)

배경: 장면에는 파도·입자·구름 흐름 같은 시간 의존 요소가 있어 같은 빌드를 두 번 찍어도 픽셀이 다르다. 그래서
  ① 같은 RM8 빌드를 두 번 찍은 차이(잡음 바닥)와 ② RM8·RM9 차이를 나란히 적고, 평균 밝기·채도(10.2절 기준 지표)도 함께 적는다.
  판정은 "RM8·RM9 차이가 RM8끼리의 잡음 바닥을 눈에 띄게 넘지 않고, 밝기·채도가 0.01 안에서 같다"이다.
  (이 비교는 같은 지점의 한 컷씩이라 모든 상태를 덮지 못한다. 아홉 무드 전체는 capture-moods.cjs와 tone-check.py가 잰다.)
"""
import argparse
import glob
import json
import os

import numpy as np
from PIL import Image


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(float)


def blocks(a, n=24):
    h, w, _ = a.shape
    h2, w2 = h // n * n, w // n * n
    return a[:h2, :w2].reshape(h2 // n, n, w2 // n, n, 3).mean(axis=(1, 3))


def tone(a):
    x = a / 255.0
    mx, mn = x.max(axis=2), x.min(axis=2)
    lum = float((0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]).mean())
    sat = float(np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0).mean())
    return lum, sat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--noise", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    fa, fn, fb = (sorted(glob.glob(os.path.join(d, "*.png"))) for d in (args.a, args.noise, args.b))
    if not (len(fa) == len(fn) == len(fb) and fa):
        raise SystemExit("세 폴더의 PNG 개수가 같아야 합니다: %d %d %d" % (len(fa), len(fn), len(fb)))
    rows = []
    for pa, pn, pb in zip(fa, fn, fb):
        a, n, b = load(pa), load(pn), load(pb)
        d_noise, d_build = np.abs(a - n), np.abs(n - b)
        ta, tn, tb = tone(a), tone(n), tone(b)
        row = {
            "image": os.path.basename(pa),
            "mean_abs_rm8_vs_rm8": round(float(d_noise.mean()), 3),
            "mean_abs_rm8_vs_rm9": round(float(d_build.mean()), 3),
            "block24_rm8_vs_rm8": round(float(np.abs(blocks(a) - blocks(n)).mean()), 3),
            "block24_rm8_vs_rm9": round(float(np.abs(blocks(n) - blocks(b)).mean()), 3),
            "luminance": {"rm8_a": round(ta[0], 4), "rm8_b": round(tn[0], 4), "rm9": round(tb[0], 4)},
            "saturation": {"rm8_a": round(ta[1], 4), "rm8_b": round(tn[1], 4), "rm9": round(tb[1], 4)},
        }
        row["tone_delta_max"] = round(max(abs(tb[0] - tn[0]), abs(tb[1] - tn[1])), 4)
        row["tone_delta_noise"] = round(max(abs(ta[0] - tn[0]), abs(ta[1] - tn[1])), 4)
        rows.append(row)
    worst_tone = max(r["tone_delta_max"] for r in rows)
    ratio = max(r["block24_rm8_vs_rm9"] / max(r["block24_rm8_vs_rm8"], 1e-6) for r in rows)
    result = {
        "images": len(rows),
        "rows": rows,
        "worst_tone_delta": worst_tone,
        "worst_block_ratio_vs_noise": round(float(ratio), 2),
        "pass": bool(worst_tone <= 0.01 and ratio <= 2.0),
        "criteria": "밝기·채도 차 0.01 이하, 블록(24px) 평균 차가 RM8끼리의 잡음 바닥의 2배 이하",
    }
    for r in rows:
        print("%-44s 8v8=%.2f 8v9=%.2f  밝기 %.3f→%.3f  채도 %.3f→%.3f" % (r["image"][:44], r["block24_rm8_vs_rm8"], r["block24_rm8_vs_rm9"],
                                                                    r["luminance"]["rm8_b"], r["luminance"]["rm9"], r["saturation"]["rm8_b"], r["saturation"]["rm9"]))
    print("worst tone delta %.4f · worst block ratio %.2f · %s" % (worst_tone, ratio, "PASS" if result["pass"] else "FAIL"))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()

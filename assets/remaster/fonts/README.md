# 리마스터 서체 서브셋

게임이 쓰는 글자만 남긴 woff2 네 개입니다. 원본은 모두 SIL Open Font License 1.1 입니다 (라이선스 전문은 같은 폴더의 OFL-*.txt). 두 원본 모두 예약 글꼴 이름 조항이 없어 이름을 바꾸지 않았습니다.

| 파일 | 원본 | 크기(바이트) | 담은 글자 |
|---|---|---|---|
| `ld-myeongjo-400.woff2` | Gowun Batang 400 | 96352 | 919 |
| `ld-myeongjo-700.woff2` | Gowun Batang 700 | 82912 | 919 |
| `ld-score-500i.woff2` | Cormorant Garamond 500 Italic | 20308 | 119 |
| `ld-score-600.woff2` | Cormorant Garamond 600 | 26564 | 119 |

서브셋은 `tools/build-fonts.py`로 다시 만듭니다. 문구가 바뀌어 한글 음절이 늘면 그 스크립트를 다시 돌립니다. 빠진 글자는 뒤따르는 시스템 명조로 표시되므로 깨지지 않습니다.

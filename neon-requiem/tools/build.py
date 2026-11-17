#!/usr/bin/env python3
"""NEON REQUIEM 번들러.

index.html이 불러오는 CSS·JS를 전부 인라인해 파일 하나로 만든다.
  python3 tools/build.py                      -> dist/neon-requiem.html (단독 실행용)
  python3 tools/build.py --artifact OUT.html  -> 위 파일 + 문서 골격 태그를 뺀 게시용 변형
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def inline(html: str) -> str:
    def css(m):
        body = (ROOT / m.group(1)).read_text(encoding="utf-8")
        if "</style" in body.lower():
            raise SystemExit(f"{m.group(1)}: '</style' 문자열은 인라인할 수 없습니다")
        return f"<style>\n{body}</style>"

    def js(m):
        body = (ROOT / m.group(1)).read_text(encoding="utf-8")
        if "</script" in body.lower():
            raise SystemExit(f"{m.group(1)}: '</script' 문자열은 인라인할 수 없습니다")
        return f"<script>\n{body}</script>"

    html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', css, html)
    html = re.sub(r'<script src="(js/[^"]+)"></script>', js, html)
    return html


def artifact_variant(full: str) -> str:
    """게시 시 doctype/head/body 골격이 자동으로 씌워지므로 내용만 남긴다."""
    out = full
    for pat in (r"<!doctype html>\s*", r'<html lang="ko">\s*', r"<head>\s*", r"</head>\s*", r"<body>\s*",
                r"</body>\s*", r"</html>\s*", r'<meta charset="utf-8">\s*', r'<meta name="viewport"[^>]*>\s*'):
        out = re.sub(pat, "", out, flags=re.IGNORECASE)
    return out.strip() + "\n"


def main():
    full = inline((ROOT / "index.html").read_text(encoding="utf-8"))
    dist = ROOT / "dist" / "neon-requiem.html"
    dist.parent.mkdir(exist_ok=True)
    dist.write_text(full, encoding="utf-8")
    print(f"{dist.relative_to(ROOT)}  {len(full.encode('utf-8')) / 1024:.0f} KB")
    if "--artifact" in sys.argv:
        out = pathlib.Path(sys.argv[sys.argv.index("--artifact") + 1])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(artifact_variant(full), encoding="utf-8")
        print(f"{out}  {out.stat().st_size / 1024:.0f} KB (게시용)")


if __name__ == "__main__":
    main()

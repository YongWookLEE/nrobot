"""기존·새 PDF의 금액과 쪽수를 확인하고 좌우 비교 그림을 만든다."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

import pymupdf


def compact(text):
    return re.sub(r"\s", "", text)


def compare_pair(old_path, new_path, expected, output, label, font_file, dpi=96):
    """두 문서의 모든 쪽을 검사한다. 검사 실패도 비교 그림과 보고서로 남긴다."""
    output.mkdir(parents=True, exist_ok=True)
    with pymupdf.open(old_path) as old, pymupdf.open(new_path) as new:
        old_text = compact("".join(page.get_text() for page in old))
        new_text = compact("".join(page.get_text() for page in new))
        missing_old = sorted({value for value in expected if compact(value) not in old_text})
        missing_new = sorted({value for value in expected if compact(value) not in new_text})
        images = []
        for index in range(max(len(old), len(new))):
            left = old[index] if index < len(old) else None
            right = new[index] if index < len(new) else None
            width = (left or right).rect.width
            height = max(page.rect.height for page in [left, right] if page is not None)
            with pymupdf.open() as drawing:
                page = drawing.new_page(width=width * 2, height=height + 28)
                page.insert_font(fontname="comparison", fontfile=str(font_file))
                page.insert_text((12, 18), "기존 견적서", fontname="comparison", fontsize=11)
                page.insert_text((width + 12, 18), "새 견적서", fontname="comparison", fontsize=11)
                if left is not None:
                    page.show_pdf_page(pymupdf.Rect(0, 28, width, height + 28), old, index)
                if right is not None:
                    page.show_pdf_page(pymupdf.Rect(width, 28, width * 2, height + 28), new, index)
                target = output / f"{label}-{index + 1}.png"
                page.get_pixmap(dpi=dpi).save(target)
                images.append(target.name)
        return {
            "old_pages": len(old), "new_pages": len(new),
            "missing_old_amounts": missing_old, "missing_new_amounts": missing_new,
            "images": images,
            "ok": len(old) == len(new) and not missing_old and not missing_new,
        }


def main(argv=None):
    parser = argparse.ArgumentParser(description="기존·새 PDF를 같은 입력으로 만들고 모든 쪽의 금액과 쪽수를 확인한 뒤 좌우 비교 PNG를 생성합니다. 실제 자료는 private/compare에만 저장합니다.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2], help="nrobot-web 프로젝트 폴더")
    parser.add_argument("--skip-render", action="store_true", help="PDF 생성을 생략하고 기존 private/compare/manifest.json을 사용")
    parser.add_argument("--dpi", type=int, default=96, help="비교 그림 해상도(기본 96, 72~200)")
    args = parser.parse_args(argv)
    if not 72 <= args.dpi <= 200:
        parser.error("해상도는 72~200이어야 합니다.")
    root = args.root.resolve()
    output = root / "private" / "compare"
    render_code = 0
    if not args.skip_render:
        render_code = subprocess.run(["node", str(root / "node_modules/tsx/dist/cli.mjs"), "tools/compare/render.ts"], cwd=root, check=False).returncode
        if render_code:
            print("PDF 생성을 완료하지 못했습니다. 이전 결과를 새 검증 결과로 사용하지 않습니다.", file=sys.stderr)
            return render_code
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    results = []
    for job in manifest["jobs"]:
        result = compare_pair(output / job["old"], output / job["new"], job["expected"], output / "images", job["id"], root / "assets/fonts/KoPubDotum-Medium.ttf", args.dpi)
        results.append({"id": job["id"], "source": job["source"], **result})
    report = {"results": results, "problems": manifest["problems"], "render_exit_code": render_code}
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(len(result["images"]) for result in results)
    failed = sum(not result["ok"] for result in results)
    print(f"비교 {len(results)}종·그림 {total}장 생성. 금액·쪽수 불일치 {failed}종, 입력 복원 누락 {len(manifest['problems'])}종.")
    print("상세 결과: private/compare/report.json")
    return 1 if render_code or failed or manifest["problems"] else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, KeyError):
        print("비교 자료를 만들 수 없습니다. 원본 PDF·글꼴·manifest.json을 확인하세요.", file=sys.stderr)
        sys.exit(1)

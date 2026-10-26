"""비교 도구의 실패 판정과 전체 쪽 이미지 생성을 확인한다."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("compare_pdf", ROOT / "tools/compare/pdf.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ComparePdfTest(unittest.TestCase):
    def make_pdf(self, target, pages):
        with pymupdf.open() as doc:
            for text in pages:
                page = doc.new_page()
                page.insert_text((30, 30), text)
            doc.save(target)

    def test_pages_and_amounts(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            old, new = folder / "old.pdf", folder / "new.pdf"
            self.make_pdf(old, ["1,000", "2,000"])
            self.make_pdf(new, ["1,000", "2,000"])
            result = MODULE.compare_pair(old, new, ["1,000", "2,000"], folder / "images", "case", ROOT / "assets/fonts/KoPubDotum-Medium.ttf", 72)
            self.assertTrue(result["ok"])
            self.assertEqual(len(result["images"]), 2)
            self.assertTrue(all((folder / "images" / name).is_file() for name in result["images"]))

    def test_mismatch_is_failure_but_all_pages_remain_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            old, new = folder / "old.pdf", folder / "new.pdf"
            self.make_pdf(old, ["1,000", "2,000"])
            self.make_pdf(new, ["3,000"])
            result = MODULE.compare_pair(old, new, ["1,000", "2,000"], folder / "images", "case", ROOT / "assets/fonts/KoPubDotum-Medium.ttf", 72)
            self.assertFalse(result["ok"])
            self.assertEqual(result["missing_new_amounts"], ["1,000", "2,000"])
            self.assertEqual(len(result["images"]), 2)

    def test_failed_render_does_not_use_previous_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(MODULE.subprocess, "run") as run:
                run.return_value.returncode = 1
                self.assertEqual(MODULE.main(["--root", directory]), 1)
            self.assertFalse((Path(directory) / "private/compare/report.json").exists())

    def test_amount_must_not_match_part_of_a_larger_amount(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            old, new = folder / "old.pdf", folder / "new.pdf"
            self.make_pdf(old, ["1,000"])
            self.make_pdf(new, ["11,000"])
            result = MODULE.compare_pair(old, new, ["1,000"], folder / "images", "case", ROOT / "assets/fonts/KoPubDotum-Medium.ttf", 72)
            self.assertFalse(result["ok"])
            self.assertEqual(result["missing_new_amounts"], ["1,000"])

    def test_quantity_and_price_remain_separate_numbers(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            old, new = folder / "old.pdf", folder / "new.pdf"
            self.make_pdf(old, ["1\n1,000"])
            self.make_pdf(new, ["1\n1,000"])
            result = MODULE.compare_pair(old, new, ["1,000"], folder / "images", "case", ROOT / "assets/fonts/KoPubDotum-Medium.ttf", 72)
            self.assertTrue(result["ok"])


if __name__ == "__main__":
    unittest.main()

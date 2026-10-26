import ExcelJS from "exceljs";
import { expect, it } from "vitest";
import { valueAfterLabel } from "../../tools/compare/render";

it("빈 연락처를 건너뛰어 옆 공급자 정보를 가져오지 않는다", () => {
  const sheet = new ExcelJS.Workbook().addWorksheet("견적서");
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = "참 조 :";
  sheet.mergeCells("C1:D1");
  sheet.getCell("E1").value = "주소";
  expect(valueAfterLabel(sheet, sheet.getCell("A1"))).toBe("");
  sheet.getCell("C1").value = "시험 담당자";
  expect(valueAfterLabel(sheet, sheet.getCell("A1"))).toBe("시험 담당자");
});

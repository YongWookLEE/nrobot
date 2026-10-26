// 개발용 비교 자료만 private/compare에 저장한다. 서비스 경로에서는 호출하지 않는다.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { calculate, lineAmount } from "@/domain/calculate";
import { koreanAmount, money } from "@/domain/format";
import type { QuoteInput, QuoteItem } from "@/domain/types";
import { createLoader } from "@/pricelists/load";
import { renderQuotePdfWithInfo } from "@/output/pdf";
import { loadRenderInputs, renderAllForCompare, toQuoteInput } from "../../tests/output/pdf/helpers";
import { loadXlsx } from "../../tests/output/xlsx/helpers";

interface Job { id: string; old: string; new: string; expected: string[]; source: string }
class RestoreError extends Error {}
const out = path.join(process.cwd(), "private/compare");
const directory = (name: string) => { const dir = path.join(out, name); mkdirSync(dir, { recursive: true }); return dir; };

function text(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if ("formula" in value || "sharedFormula" in value) return value.result === undefined ? "" : String(value.result);
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  return cell.text;
}

function originals(sheet: ExcelJS.Worksheet): ExcelJS.Cell[] {
  const cells: ExcelJS.Cell[] = [];
  sheet.eachRow((row) => row.eachCell((cell) => { if (cell.master.address === cell.address && text(cell)) cells.push(cell); }));
  return cells;
}

export function valueAfterLabel(sheet: ExcelJS.Worksheet, cell: ExcelJS.Cell): string {
  let column = Number(cell.col) + 1;
  while (column <= sheet.columnCount && sheet.getCell(cell.row, column).master.address === cell.address) column++;
  if (column > sheet.columnCount) throw new RestoreError("표제 다음 값 누락");
  // 빈 거래처 연락처도 원본 값이다. 공급자 표제로 넘어가지 않는다.
  return text(sheet.getCell(cell.row, column));
}

function restore(sheet: ExcelJS.Worksheet, filename: string, catalog: ReturnType<ReturnType<typeof createLoader>["loadProductCatalog"]>): QuoteInput {
  const cells = originals(sheet);
  const find = (label: string) => cells.find((cell) => text(cell) === label);
  const after = (label: string) => {
    const cell = find(label);
    if (!cell) throw new RestoreError(`필수 표제 누락: ${label}`);
    return valueAfterLabel(sheet, cell);
  };
  const product = cells.some((cell) => cell.font?.name?.includes("KoPub"));
  const quoteType = product ? /2팀/.test(filename) ? "catalog2" : /1팀/.test(filename) ? "catalog" : null : find("재료비") ? "cost" : find("부 가 세") ? "vat" : "total";
  if (!quoteType) throw new RestoreError("영업팀 구분을 원본 파일명에서 확인할 수 없습니다.");
  const header = find("품목");
  const category = find("구분");
  const unit = find("단위");
  const note = find("비고");
  if (!header || !category || !unit || !note) throw new RestoreError("품목 표 머리글 누락");
  const amountCells = cells.filter((cell) => cell.formula?.startsWith("ROUND(") && cell.formula.includes("/100"));
  const summary = cells.find((cell) => cell.row > header.row && ["합 계", "견 적 가"].includes(text(cell)));
  if (!summary || !amountCells.length) throw new RestoreError("품목 계산식이나 합계 표 누락");
  const items: QuoteItem[] = amountCells.map((amountCell, index) => {
    const local = amountCell.formula!.split(`'${sheet.name.replace(/'/g, "''")}'!`).join("");
    const match = /^ROUND\(([A-Z]+\d+)\*\(([A-Z]+\d+(?:\+[A-Z]+\d+)*)\)\*([\d.]+)\/100,0\)$/.exec(local);
    if (!match) throw new RestoreError("지원하지 않는 품목 계산식입니다.");
    const qtyCell = sheet.getCell(match[1]);
    const priceCells = match[2].split("+").map((ref) => sheet.getCell(ref));
    const first = qtyCell.row;
    const last = index + 1 < amountCells.length ? amountCells[index + 1].row : summary.row;
    const name = cells.filter((cell) => cell.row >= first && cell.row < last && Number(cell.col) === Number(header.col)).map(text).join("\n");
    const item: QuoteItem = {
      category: text(sheet.getCell(first, Number(category.col))), name,
      unit: text(sheet.getCell(first, Number(unit.col))), note: text(sheet.getCell(first, Number(note.col))),
      qty: Number(text(qtyCell)), priceRate: Number(match[3]), price: quoteType === "cost" ? 0 : Number(text(priceCells[0])),
    };
    if (quoteType === "cost") [item.material, item.labor, item.expense] = priceCells.map((cell) => Number(text(cell)));
    if (product) {
      const entries = catalog.entries.filter((entry) => entry.name === name);
      if (entries.length !== 1) throw new RestoreError(`${index + 1}번 품목의 원본 서식을 현재 가격표에서 하나로 찾을 수 없습니다.`);
      item.template = entries[0].template;
      item.imageIds = entries[0].imageIds;
    }
    if (lineAmount(item, quoteType) !== Number(text(amountCell))) throw new RestoreError(`${index + 1}번 품목의 복원 금액이 원본과 다릅니다.`);
    return item;
  });
  const date = after("작성일자 :").match(/(\d+)년\s*(\d+)월\s*(\d+)일/);
  if (!date) throw new RestoreError("원본 작성일자를 읽을 수 없습니다.");
  const title = cells.map(text).find((value) => value.startsWith("품 명 : "));
  const notes = find("* NOTE");
  if (!title || !notes) throw new RestoreError("제목이나 NOTE 누락");
  const terms = cells.map(text).filter((value) => /^(견적 유효기간|유효기간|납품|결제)\s*[:：]/.test(value));
  if (terms.length !== 3) throw new RestoreError("조건 문구 3줄을 찾을 수 없습니다.");
  const lastItem = amountCells[amountCells.length - 1].row;
  const blankRows = cells.some((cell) => cell.row > lastItem && cell.row < summary.row && Number(cell.col) === 1 && /^\d+$/.test(text(cell)));
  const quote: QuoteInput = {
    quoteType, customer: after("수 신 :"), contact: after("참 조 :"), phone: after("TEL. :"), email: after("FAX. :"),
    title: title.slice("품 명 : ".length).replace(/^"|"$/g, ""), number: after("견적번호 :"),
    date: `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`,
    validity: terms[0], delivery: terms[1], payment: terms[2],
    staffId: "reference", staffDisplay: after("담당자"), staffPhone: after("H.P"),
    notes: text(sheet.getCell(notes.row + 1, 1)),
    showFee: cells.some((cell) => cell.row < header.row && text(cell).includes("조달수수료")),
    mergeCategories: amountCells.some((cell) => sheet.getCell(cell.row, Number(category.col)).master.row !== cell.row),
    blankRows, items,
  };
  const final = cells.filter((cell) => text(cell) === "견 적 가" || text(cell) === "합 계").at(-1)!;
  const total = Number(text(cells.find((cell) => cell.row === final.row && Number(cell.col) > Number(final.col))!));
  if (calculate(items, quoteType).total !== total) throw new RestoreError("복원한 견적가가 원본과 다릅니다.");
  return quote;
}

function expected(quote: QuoteInput): string[] {
  const { subtotal, tax, total } = calculate(quote.items, quote.quoteType);
  const summary = quote.quoteType === "vat" || quote.quoteType === "cost" ? [money(subtotal), money(tax)] : [];
  return [...quote.items.map((item) => money(lineAmount(item, quote.quoteType))), ...summary, money(total), `일금${koreanAmount(total)}원정`];
}

async function main() {
  directory("new");
  const jobs: Job[] = [];
  await renderAllForCompare(false);
  for (const input of loadRenderInputs()) {
    jobs.push({ id: input.name, old: `legacy/${input.name}.pdf`, new: `new/${input.name}.pdf`, expected: expected(await toQuoteInput(input.input)), source: "synthetic" });
  }
  const loader = createLoader(path.join(process.cwd(), "generated/pricelists"));
  const catalog = loader.loadProductCatalog();
  directory("reference-new"); directory("reference-original");
  const files = readdirSync("private/reference").filter((name) => name.endsWith(".xlsx")).sort();
  const problems: Array<{ id: string; reason: string }> = [];
  if (files.length !== 5) problems.push({ id: "reference-set", reason: "실제 예시는 PDF·Excel 5쌍이 필요합니다." });
  for (const [index, filename] of files.entries()) {
    const id = `reference-${index + 1}`;
    try {
      // 원본 그림의 기본 이름공간은 ExcelJS가 읽지 못한다. 기존 회귀 검사와 같은 읽기 경계를 쓴다.
      const { wb: workbook } = await loadXlsx(readFileSync(path.join("private/reference", filename)), true);
      if (workbook.worksheets.length !== 1) throw new RestoreError("여러 시트 원본은 입력 복원이 필요합니다.");
      const quote = restore(workbook.worksheets[0], filename, catalog);
      const result = await renderQuotePdfWithInfo(quote, { getImage: loader.loadCatalogImage });
      const old = `reference-original/${id}.pdf`, file = `reference-new/${id}.pdf`;
      copyFileSync(path.join("private/reference", filename.replace(/\.xlsx$/, ".pdf")), path.join(out, old));
      writeFileSync(path.join(out, file), result.buffer);
      writeFileSync(path.join(out, "reference-new", `${id}.input.json`), JSON.stringify(quote, null, 2));
      jobs.push({ id, old, new: file, expected: expected(quote), source: "reference" });
    } catch (error) {
      // 실제 파일명·셀값은 출력하지 않는다. 자세한 복원 입력은 private 안에만 남긴다.
      problems.push({ id, reason: error instanceof RestoreError ? error.message : "원본 파일 해석에 실패했습니다. 비공개 원본 파일을 확인하세요." });
    }
  }
  writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ jobs, problems }, null, 2));
  console.log(`비교 PDF ${jobs.length}종 준비, 실제 예시 ${files.length}종 중 ${jobs.filter((job) => job.source === "reference").length}종 복원.`);
  for (const problem of problems) console.error(`${problem.id}: ${problem.reason}`);
  if (problems.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(process.cwd(), "tools/compare/render.ts")) {
  main().catch(() => { console.error("비교 PDF 준비에 실패했습니다. 원본·글꼴·가격표 파일을 확인하세요."); process.exitCode = 1; });
}

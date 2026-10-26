// 출입통제 기준가격표 해석 (기존 access_catalog.py 이식, spec 10절)
import { createHash } from "node:crypto";
import type { AccessCatalog, AccessEntry } from "@/domain/types";
import { decimalInRange, parsePyDecimal, roundHalfUpToInt } from "./decimal";
import { colLetters, listSheets, readSharedStrings } from "./workbook";
import { child, findAll, joinT, parseXml } from "./xml";
import { readZip } from "./zip";

export const ACCESS_MAX_UNCOMPRESSED = 50_000_000;
const MAX_PRICE = BigInt(100_000_000_000);
const LABOR_WORDS = ["설치", "철거", "배관배선"];

/**
 * @param buf 엑셀 파일 바이트
 * @param sheetPathLabel 오류 메시지 앞에 붙일 파일 이름(선택)
 */
export function parseAccessCatalog(buf: Buffer | Uint8Array, sheetPathLabel?: string): AccessCatalog {
  const fail = (msg: string): never => {
    throw new Error(sheetPathLabel ? `${sheetPathLabel}: ${msg}` : msg);
  };
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const zip = readZip(bytes);
  if (zip.totalSize > ACCESS_MAX_UNCOMPRESSED) fail("가격표 파일이 너무 큽니다.");
  const strings = readSharedStrings(zip);
  const entries: AccessEntry[] = [];

  for (const sheet of listSheets(zip)) {
    let headers: Map<string, string> | null = null;
    const root = parseXml(zip.read(sheet.part));
    for (const row of findAll(root, ["sheetData", "row"])) {
      const cells = new Map<string, string>();
      for (const c of row.children) {
        if (c.name !== "c") continue;
        const col = colLetters(c.attrs.r ?? "");
        let value = child(c, "v")?.text ?? "";
        if (c.attrs.t === "s") value = value ? (strings[parseInt(value, 10)] ?? fail(`${sheet.name} 공유 문자열 번호가 잘못되었습니다.`)) : "";
        else if (c.attrs.t === "inlineStr") value = joinT(c);
        cells.set(col, value.trim());
      }
      const values = new Set(cells.values());
      if (values.has("품목") && values.has("제품명") && values.has("단가")) {
        headers = new Map();
        for (const [k, v] of cells) headers.set(v, k);
        continue;
      }
      if (!headers) continue;
      const h = headers;
      const value = (name: string) => cells.get(h.get(name) ?? "") ?? "";
      const title = value("품목");
      if (!title) continue;
      const rowNo = row.attrs.r ?? "";
      const d = parsePyDecimal(value("단가").replace(/,/g, ""));
      if (!d || d.kind !== "finite" || !decimalInRange(d, BigInt(0), MAX_PRICE)) {
        fail(`${sheet.name} ${rowNo}행의 부가세 별도 단가를 확인하세요.`);
      }
      const price = roundHalfUpToInt(d as Extract<typeof d, { kind: "finite" }>);
      const labor = LABOR_WORDS.some((w) => title.includes(w));
      const model = value("제품명");
      entries.push({
        id: `${sheet.name}:${rowNo}`,
        title,
        model,
        category: value("소요군"),
        name: title + (model ? "\n" + model : ""),
        unit: labor ? "식" : "대",
        qty: 1,
        price,
        note: value("비고"),
        costBucket: labor ? "labor" : "material",
      });
    }
  }
  if (!entries.length) fail("품목·제품명·단가 열이 있는 가격표를 확인하세요.");
  return { entries, revision: createHash("sha256").update(bytes).digest("hex") };
}

// 영업팀 제품가격표 해석 (기존 catalog.py 이식, spec 11절)
import { createHash } from "node:crypto";
import type { CatalogEntry, CatalogTemplate, ProductCatalog } from "@/domain/types";
import { decimalIsInteger, decimalToInt, parsePyDecimal } from "./decimal";
import { encodeImage, type CatalogImage } from "./images";
import { pySum, sheetMetrics, Styles } from "./style";
import { listSheets, readSharedStrings, rels } from "./workbook";
import { child, descendants, findAll, firstDescendant, joinT, parseXml, prefixedAttr, type XmlElement } from "./xml";
import { readZip } from "./zip";

export interface ParsedProductCatalog {
  catalog: ProductCatalog;
  images: Map<string, CatalogImage>;
}

const NO_TABLE = "제품 표를 찾지 못했습니다. C열 품목, F열 단위, G열 수량, H열 단가 구조를 확인하세요.";
const CELL_COLS = ["A", "B", "F", "G", "H", "I", "J"] as const;

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
/** Python re: ^.*?[:：]\s* 제거 */
const afterColon = (s: string) => s.replace(/^.*?[:：]\s*/u, "");

/** 모델명 추출: 둘째 줄부터 차례로, 먼저 걸리는 줄이 이긴다 */
export function extractModel(lines: string[]): string {
  for (const line of lines.slice(1)) {
    if (line.includes("모델명")) return line.replace(/^.*?모델명\s*[:：]?\s*/u, "").split("/")[0].trim();
    if (/^[A-Za-z0-9]+-[A-Za-z0-9]/.test(line)) return line.split("/")[0].trim();
  }
  return "";
}

export function modelCode(model: string): string {
  const m = /^[A-Za-z0-9][A-Za-z0-9+_.-]*/.exec(model);
  return m ? m[0] : model;
}

function intText(el: XmlElement | null): number {
  const t = (el?.text ?? "").trim();
  if (!/^[+-]?\d+$/.test(t)) throw new Error("그림 위치 형식이 잘못되었습니다.");
  return parseInt(t, 10);
}

const intAttr = (v: string | undefined, fallback: string) => {
  const t = (v ?? fallback).trim();
  if (!/^[+-]?\d+$/.test(t)) throw new Error("그림 크기 형식이 잘못되었습니다.");
  return parseInt(t, 10);
};

/** ElementTree find('.//xfrm/ext') */
function xfrmExt(anchor: XmlElement): XmlElement | null {
  for (const x of descendants(anchor, "xfrm")) {
    const e = child(x, "ext");
    if (e) return e;
  }
  return null;
}

export async function parseProductCatalog(buf: Buffer | Uint8Array): Promise<ParsedProductCatalog> {
  const zip = readZip(buf);
  const styles = new Styles(zip);
  const shared = readSharedStrings(zip);
  const entries: CatalogEntry[] = [];
  const warnings: string[] = [];
  const sheets: Array<{ name: string; count: number }> = [];
  const images = new Map<string, CatalogImage>();
  const usedIds = new Set<string>();

  for (const { name, part } of listSheets(zip)) {
    const root = parseXml(zip.read(part));
    const cells = new Map<string, string>();
    const cellNodes = new Map<string, XmlElement>();
    const formulas = new Set<string>();
    let maxrow = 0;
    for (const c of findAll(root, ["sheetData", "row", "c"])) {
      const addr = c.attrs.r ?? "";
      let value = child(c, "v")?.text ?? "";
      if (c.attrs.t === "s") {
        if (value) {
          const s = shared[parseInt(value, 10)];
          if (s === undefined) throw new Error(`${name}!${addr}: 공유 문자열 번호가 잘못되었습니다.`);
          value = s;
        } else value = "";
      } else if (c.attrs.t === "inlineStr") value = joinT(c);
      cells.set(addr, value || "");
      cellNodes.set(addr, c);
      if (child(c, "f")) formulas.add(addr);
      const digits = /\d+/.exec(addr);
      if (digits) maxrow = Math.max(maxrow, parseInt(digits[0], 10));
      else throw new Error(`${name}: 셀 주소 형식이 잘못되었습니다.`);
    }
    const { columns, rows: rowPoints } = sheetMetrics(root);
    const rowHeight = (r: number, fallback = 15) => rowPoints.get(r) ?? fallback;
    const get = (col: string, row: number) => (cells.get(`${col}${row}`) ?? "").trim();

    const starts: number[] = [];
    for (let r = 21; r <= maxrow; r++) if (get("C", r) && get("F", r) && get("G", r)) starts.push(r);
    if (!starts.length) continue;
    let stop = maxrow + 1;
    for (let r = starts[starts.length - 1] + 1; r <= maxrow; r++) {
      if (get("A", r).replace(/ /g, "").includes("합계")) {
        stop = r;
        break;
      }
    }
    const notes: string[] = [];
    for (let r = stop + 1; r <= maxrow; r++) if (/^\p{Nd}+\./u.test(get("A", r))) notes.push(get("A", r));

    const sheetEntries: CatalogEntry[] = [];
    let category = "";
    starts.forEach((start, ix) => {
      const end = ix + 1 < starts.length ? starts[ix + 1] : stop;
      category = get("B", start) || category;
      const range: number[] = [];
      for (let r = start; r < end; r++) range.push(r);
      const lines = range.map((r) => get("C", r)).filter(Boolean);
      const model = extractModel(lines);
      let id = sha256(name + "\0" + model + "\0" + lines[0]).slice(0, 24);
      if (usedIds.has(id)) id += `-${start}`;
      usedIds.add(id);

      const raw = get("H", start);
      let price: number | null = null;
      if (formulas.has(`H${start}`)) {
        warnings.push(`${name}!H${start}: 수식 단가는 최신 계산 여부를 확인할 수 없어 직접 입력이 필요합니다.`);
      } else if (raw) {
        const d = parsePyDecimal(raw);
        if (d && d.kind === "finite" && (!d.negative || d.digits === BigInt(0)) && decimalIsInteger(d)) price = decimalToInt(d);
        else warnings.push(`${name}!H${start}: 단가 확인 필요`);
      }
      const joinCol = (col: string) => range.map((r) => get(col, r)).filter(Boolean).join("\n");

      const template: CatalogTemplate = {
        columns: [...columns],
        // 시트에 없는 행은 정수 15(기존 row_points.get(r, 15)), 있는 행은 실수다
        height: pySum(range.map((r) => ({ value: rowHeight(r), isInt: !rowPoints.has(r) }))),
        lines: range
          .filter((r) => get("C", r))
          .map((r) => ({ text: get("C", r), height: rowHeight(r), ...styles.cell(cellNodes.get(`C${r}`)) })),
        cells: Object.fromEntries(CELL_COLS.map((col) => [col, styles.cell(cellNodes.get(`${col}${start}`))])) as CatalogTemplate["cells"],
        header: styles.cell(cellNodes.get("C20")),
        headerHeight: rowHeight(20, 18),
        imageSizes: {},
      };
      const entry: CatalogEntry = {
        id,
        sheet: name,
        row: start,
        end,
        model,
        code: modelCode(model),
        title: lines[0],
        category: category || name,
        name: lines.join("\n"),
        unit: get("F", start),
        qty: get("G", start),
        price,
        note: joinCol("J"),
        internalNote: joinCol("K"),
        imageIds: [],
        terms: {
          validity: afterColon(get("D", 16)),
          delivery: afterColon(get("D", 17)),
          payment: afterColon(get("D", 18)),
          notes: [...notes],
          fee: get("J", 16),
        },
        template,
      };
      entries.push(entry);
      sheetEntries.push(entry);
    });

    const drawing = child(root, "drawing");
    if (drawing) {
      const dp = rels(zip, part).get(prefixedAttr(drawing, "id") ?? "");
      if (dp) {
        const dr = rels(zip, dp);
        for (const anchor of parseXml(zip.read(dp)).children) {
          const f = child(anchor, "from");
          const blip = firstDescendant(anchor, "blip");
          const ext = xfrmExt(anchor);
          if (!f || !blip || !ext) continue;
          const row = intText(child(f, "row")) + 1;
          const col = intText(child(f, "col")) + 1;
          if (col > 10 || intAttr(ext.attrs.cx, "0") < 100000 || intAttr(ext.attrs.cy, "0") < 100000) continue;
          const item = sheetEntries.find((e) => e.row <= row && row < e.end);
          if (!item) continue;
          const ip = dr.get(prefixedAttr(blip, "embed") ?? "");
          if (!ip) continue;
          try {
            const srcRect = firstDescendant(anchor, "srcRect");
            const crop = srcRect
              ? (Object.fromEntries(
                  (["l", "t", "r", "b"] as const).map((k) => [k, Math.max(0, intAttr(srcRect.attrs[k], "0")) / 100000]),
                ) as { l: number; t: number; r: number; b: number })
              : null;
            const img = await encodeImage(zip.read(ip), crop);
            const iid = sha256(img.data);
            images.set(iid, img);
            item.template.imageSizes[iid] = [intAttr(ext.attrs.cx, "0") / 12700, intAttr(ext.attrs.cy, "0") / 12700];
            if (!item.imageIds.includes(iid)) item.imageIds.push(iid);
          } catch {
            warnings.push(`${name}!${row}: 제품 사진 형식을 읽지 못했습니다.`);
          }
        }
      }
    }
    sheets.push({ name, count: sheetEntries.length });
  }
  if (!entries.length) throw new Error(NO_TABLE);
  const body = { entries, sheets, warnings };
  const revision = sha256(JSON.stringify(body));
  return { catalog: { ...body, revision }, images };
}

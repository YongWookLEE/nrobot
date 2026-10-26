// Excel 생성기 검사 도우미: 입력 만들기, xlsx 읽기, 작은 수식 계산기.
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { isCatalogType, validateQuote, type QuoteInput, type Staff } from "@/domain";
import { parseProductCatalog, type ParsedProductCatalog } from "@/pricelists/catalog";

export const ROOT = process.cwd();

// 시험용 가짜 담당자
export const STAFF: Staff[] = [
  { id: "a", name: "홍길동", title: "차장", phone: "010-0000-0001", start: 1 },
  { id: "b", name: "김철수", title: "차장", phone: "010-0000-0002", start: 10 },
  { id: "c", name: "이영희", title: "대리", phone: "010-0000-0003", start: 20 },
];

export interface RenderCase {
  name: string;
  input: Record<string, unknown>;
}

export const RENDER_CASES: RenderCase[] = JSON.parse(readFileSync(path.join(ROOT, "tests/golden/render_inputs.json"), "utf8"));

let parsed: Promise<ParsedProductCatalog> | null = null;
export function fixtureCatalog(): Promise<ParsedProductCatalog> {
  parsed ??= parseProductCatalog(readFileSync(path.join(ROOT, "tests/fixtures/catalog.xlsx")));
  return parsed;
}

export async function buildQuote(input: Record<string, unknown>): Promise<QuoteInput> {
  const catalog = isCatalogType(input.quoteType as QuoteInput["quoteType"]) ? (await fixtureCatalog()).catalog : undefined;
  // Python 기준 입력은 당시 변환기의 revision을 담고 있다. 출력 비교에서는
  // 같은 합성 원본을 현 변환기로 읽어 현재 revision으로 검증한다.
  const raw = catalog ? { ...input, catalogRevision: catalog.revision } : input;
  const r = validateQuote(raw, STAFF, catalog ? { catalog } : {});
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

export async function imageDeps() {
  const { images } = await fixtureCatalog();
  return {
    getImage: (id: string) => {
      const img = images.get(id);
      return img ? { data: img.data, ext: img.ext } : null;
    },
  };
}

/**
 * xlsx 읽기. 기존 파일의 그림 부분은 ExcelJS가 읽지 못하므로(기본 이름공간 사용) 지우고 읽는다.
 * 그림 개수는 따로 센다.
 */
export async function loadXlsx(buf: Buffer, stripDrawings = false): Promise<{ wb: ExcelJS.Workbook; media: number; zip: JSZip }> {
  const zip = await JSZip.loadAsync(buf);
  const media = Object.entries(zip.files).filter(([n, entry]) => n.startsWith("xl/media/") && !entry.dir).length;
  let data = buf;
  if (stripDrawings) {
    const copy = await JSZip.loadAsync(buf);
    for (const n of Object.keys(copy.files)) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) {
        const s = await copy.file(n)!.async("string");
        copy.file(n, s.replace(/<drawing [^>]*\/>/, ""));
      }
      if (n.startsWith("xl/drawings/") || /sheet\d+\.xml\.rels$/.test(n)) copy.remove(n);
    }
    data = await copy.generateAsync({ type: "nodebuffer" });
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ExcelJS.Buffer);
  return { wb, media, zip };
}

export interface FormulaCell {
  sheet: string;
  address: string;
  row: number;
  col: number;
  formula: string;
  result: unknown;
}

/** 수식 셀 (시트 순서, 행·열 순서) */
export function formulaCells(wb: ExcelJS.Workbook): FormulaCell[] {
  const out: FormulaCell[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow((row) =>
      row.eachCell((c) => {
        if (c.type === ExcelJS.ValueType.Formula && c.master === c) {
          out.push({ sheet: ws.name, address: c.address, row: c.row as unknown as number, col: c.col as unknown as number, formula: c.formula, result: c.result });
        }
      }),
    );
  }
  return out;
}

// ---- 작은 수식 계산기 (이 생성기가 쓰는 문법만: 숫자·문자열·셀 참조·+ - * / & >=·ROUND·SUM·IF·TEXT) ----

type Value = number | string | boolean;
type Token = { t: "num"; v: number } | { t: "str"; v: string } | { t: "ref"; sheet: string; addr: string } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string, defaultSheet: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " ") {
      i++;
    } else if (ch === '"') {
      let s = "";
      i++;
      while (i < src.length) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          break;
        }
        s += src[i++];
      }
      i++;
      out.push({ t: "str", v: s });
    } else if (ch === "'") {
      const end = src.indexOf("'!", i + 1);
      const sheet = src.slice(i + 1, end);
      const m = /^[A-Z]+\d+/.exec(src.slice(end + 2))!;
      out.push({ t: "ref", sheet, addr: m[0] });
      i = end + 2 + m[0].length;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Z]/.test(ch)) {
      const m = /^[A-Z]+\d*/.exec(src.slice(i))!;
      if (/\d/.test(m[0])) out.push({ t: "ref", sheet: defaultSheet, addr: m[0] });
      else out.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else if (src.startsWith(">=", i)) {
      out.push({ t: "op", v: ">=" });
      i += 2;
    } else if ("+-*/&(),".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
    } else {
      throw new Error(`수식 문자를 읽지 못했습니다: ${src.slice(i)}`);
    }
  }
  return out;
}

function excelRound(x: number, digits: number): number {
  const f = 10 ** digits;
  // Excel처럼 유효숫자 15자리로 맞춘 뒤 사사오입한다.
  const v = Number((Math.abs(x) * f).toPrecision(15));
  const r = Math.floor(v + 0.5);
  return (Math.sign(x) * r) / f;
}

function thousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function evaluate(wb: ExcelJS.Workbook, sheet: string, formula: string, seen = new Set<string>()): Value {
  const toks = tokenize(formula, sheet);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`'${v}' 필요: ${formula}`);
    p++;
  };
  const num = (v: Value) => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : Number(v));
  const refValue = (sh: string, addr: string): Value => {
    const key = `${sh}!${addr}`;
    if (seen.has(key)) throw new Error(`순환 참조: ${key}`);
    const c = wb.getWorksheet(sh)!.getCell(addr);
    if (c.type === ExcelJS.ValueType.Formula) return evaluate(wb, sh, c.formula, new Set([...seen, key]));
    const v = c.value;
    if (v === null || v === undefined) return 0;
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
    throw new Error(`알 수 없는 셀 값: ${key}`);
  };
  const args = (): Value[] => {
    expect("(");
    const out: Value[] = [];
    if (!isOp(")")) {
      out.push(cmp());
      while (isOp(",")) {
        p++;
        out.push(cmp());
      }
    }
    expect(")");
    return out;
  };
  const primary = (): Value => {
    const tok = toks[p++];
    if (!tok) throw new Error(`수식이 끝났습니다: ${formula}`);
    if (tok.t === "num" || tok.t === "str") return tok.v;
    if (tok.t === "ref") return refValue(tok.sheet, tok.addr);
    if (tok.t === "op" && tok.v === "(") {
      const v = cmp();
      expect(")");
      return v;
    }
    if (tok.t === "op" && tok.v === "-") return -num(primary());
    if (tok.t === "id") {
      const a = args();
      switch (tok.v) {
        case "SUM":
          return a.reduce<number>((s, v) => s + num(v), 0);
        case "ROUND":
          return excelRound(num(a[0]), num(a[1]));
        case "IF":
          return a[0] ? a[1] : a[2];
        case "TEXT":
          if (a[1] !== "#,##0") throw new Error(`지원하지 않는 형식: ${String(a[1])}`);
          return thousands(num(a[0]));
        default:
          throw new Error(`지원하지 않는 함수: ${tok.v}`);
      }
    }
    throw new Error(`읽지 못한 수식: ${formula}`);
  };
  const mul = (): Value => {
    let v = primary();
    while (isOp("*") || isOp("/")) {
      const op = (toks[p++] as { v: string }).v;
      const r = primary();
      v = op === "*" ? num(v) * num(r) : num(v) / num(r);
    }
    return v;
  };
  const add = (): Value => {
    let v = mul();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      const r = mul();
      v = op === "+" ? num(v) + num(r) : num(v) - num(r);
    }
    return v;
  };
  const cat = (): Value => {
    let v = add();
    while (isOp("&")) {
      p++;
      v = String(v) + String(add());
    }
    return v;
  };
  const cmp = (): Value => {
    const v = cat();
    if (isOp(">=")) {
      p++;
      return num(v) >= num(cat());
    }
    return v;
  };
  const v = cmp();
  if (p !== toks.length) throw new Error(`수식 끝에 남은 글자: ${formula}`);
  return v;
}

/** 적용률 표기(100 / 100.0) 차이를 없앤 수식 */
export function normalizeFormula(f: string): string {
  return f.replace(/(\d+)\.0(?!\d)/g, "$1");
}

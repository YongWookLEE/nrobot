// 통합문서 공용 읽기: 공유 문자열, 관계(rels), 시트 목록.
import path from "node:path";
import { findAll, joinT, parseXml, prefixedAttr } from "./xml";
import type { ZipReader } from "./zip";

/** posixpath.normpath (끝 슬래시 제거) */
export function normpath(p: string): string {
  const n = path.posix.normalize(p);
  return n.length > 1 && n.endsWith("/") ? n.slice(0, -1) : n;
}

const lstripSlash = (s: string) => s.replace(/^\/+/, "");

/** 공유 문자열: si마다 자손 t 글자를 잇는다 (기존과 같이 윗주 rPh 포함) */
export function readSharedStrings(zip: ZipReader): string[] {
  if (!zip.has("xl/sharedStrings.xml")) return [];
  return parseXml(zip.read("xl/sharedStrings.xml")).children.map(joinT);
}

/** catalog.py rels(): 외부 관계 제외, 상대 경로는 부품 위치 기준으로 푼다 */
export function rels(zip: ZipReader, part: string): Map<string, string> {
  const dir = path.posix.dirname(part);
  const name = path.posix.join(dir, "_rels", path.posix.basename(part) + ".rels");
  const out = new Map<string, string>();
  if (!zip.has(name)) return out;
  for (const e of parseXml(zip.read(name)).children) {
    if (e.attrs.TargetMode === "External") continue;
    const target = e.attrs.Target ?? "";
    out.set(e.attrs.Id ?? "", target.startsWith("/") ? lstripSlash(target) : lstripSlash(normpath(path.posix.join(dir, target))));
  }
  return out;
}

export interface SheetRef {
  name: string;
  part: string;
}

/** 통합문서 순서대로 시트 이름과 부품 경로 */
export function listSheets(zip: ZipReader): SheetRef[] {
  const book = parseXml(zip.read("xl/workbook.xml"));
  const links = rels(zip, "xl/workbook.xml");
  return findAll(book, ["sheets", "sheet"]).map((s) => {
    const name = s.attrs.name ?? "";
    const part = links.get(prefixedAttr(s, "id") ?? "");
    if (!part) throw new Error(`시트 '${name}'의 위치를 찾지 못했습니다.`);
    return { name, part };
  });
}

/** 주소의 열 문자 (A1 → A) */
export const colLetters = (addr: string) => addr.replace(/[^A-Za-z]/g, "");


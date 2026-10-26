// 골든에 없는 경계 규칙: 실패 메시지, 짝수 반올림, 사진 축소, 변환 산출물 쓰기·읽기.
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { parseAccessCatalog } from "@/pricelists/access";
import { parseProductCatalog } from "@/pricelists/catalog";
import { encodeImage, IMAGE_MAX_SIDE } from "@/pricelists/images";
import { pySum, roundHalfEven, Styles } from "@/pricelists/style";
import { emfToRaw, isEmf } from "@/pricelists/emf";
import { readZip } from "@/pricelists/zip";
import { createLoader } from "@/pricelists/load";
import { writePricelists } from "@/pricelists/prepare";

const root = process.cwd();
const accessBuf = readFileSync(path.join(root, "tests/fixtures/access.xlsx"));
const catalogBuf = readFileSync(path.join(root, "tests/fixtures/catalog.xlsx"));

async function patch(buf: Buffer, part: string, edit: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file(part)!.async("string");
  zip.file(part, edit(xml));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("짝수 반올림 (Python round)", () => {
  it("x.5는 짝수로 간다", () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(190.5)).toBe(190);
    expect(roundHalfEven(191.5)).toBe(192);
    expect(roundHalfEven(2.4999)).toBe(2);
    expect(roundHalfEven(2.5001)).toBe(3);
    expect(roundHalfEven(-0.5) === 0).toBe(true);
  });

  it("테마 색 tint 계산이 짝수 반올림을 쓴다", () => {
    // 테마 0 = FFFFFF, tint -0.5 → 255*0.5 = 127.5 → 128(짝수)
    const zip = readZip(catalogBuf);
    const styles = new Styles(zip);
    expect(styles.colorOf({ rgb: "FF7F7F7F", tint: "-0.5" }, "#000000")).toBe("#404040"); // 127*0.5=63.5 → 64
    expect(styles.colorOf({ rgb: "FF050505", tint: "-0.5" }, "#000000")).toBe("#020202"); // 2.5 → 2
  });
});

describe("행 높이 합 (Python 3.12 sum)", () => {
  it("실수는 보정 합, 정수만이면 정수 합", () => {
    const floats = Array.from({ length: 10 }, () => ({ value: 0.1, isInt: false }));
    expect(pySum(floats)).toBe(1);
    expect(pySum([{ value: 15, isInt: true }, { value: 15, isInt: true }])).toBe(30);
    expect(pySum([])).toBe(0);
  });
});

/** 2x1 24비트 비트맵 하나를 감싼 최소 EMF */
function tinyEmf(): Buffer {
  const header = Buffer.alloc(88);
  header.writeUInt32LE(1, 0);
  header.writeUInt32LE(88, 4);
  header.writeUInt32LE(0x464d4520, 40);
  const bmi = Buffer.alloc(40);
  bmi.writeUInt32LE(40, 0);
  bmi.writeInt32LE(2, 4);
  bmi.writeInt32LE(1, 8);
  bmi.writeUInt16LE(1, 12);
  bmi.writeUInt16LE(24, 14);
  const bits = Buffer.from([0, 0, 255, 255, 0, 0, 0, 0]); // 빨강, 파랑 (BGR) + 패딩
  const rec = Buffer.alloc(80);
  rec.writeUInt32LE(81, 0);
  rec.writeUInt32LE(80 + 40 + 8, 4);
  rec.writeInt32LE(2, 40);
  rec.writeInt32LE(1, 44);
  rec.writeUInt32LE(80, 48);
  rec.writeUInt32LE(40, 52);
  rec.writeUInt32LE(120, 56);
  rec.writeUInt32LE(8, 60);
  const eof = Buffer.alloc(20);
  eof.writeUInt32LE(14, 0);
  eof.writeUInt32LE(20, 4);
  return Buffer.concat([header, rec, bmi, bits, eof]);
}

describe("EMF 사진", () => {
  it("안의 비트맵을 꺼낸다", async () => {
    const emf = tinyEmf();
    expect(isEmf(emf)).toBe(true);
    const raw = emfToRaw(emf);
    expect([raw.width, raw.height]).toEqual([2, 1]);
    expect([...raw.data]).toEqual([255, 0, 0, 0, 0, 255]);
    const out = await encodeImage(emf);
    expect(out.ext).toBe("jpg");
  });

  it("비트맵이 없는 EMF는 실패한다", () => {
    const emf = tinyEmf().subarray(0, 88);
    expect(() => emfToRaw(Buffer.from(emf))).toThrow();
  });
});

describe("zip 읽기", () => {
  it("압축 해제 크기 합계를 알려 준다", () => {
    const zip = readZip(accessBuf);
    expect(zip.totalSize).toBeGreaterThan(0);
    expect(zip.has("xl/workbook.xml")).toBe(true);
    expect(zip.read("xl/workbook.xml").toString("utf8")).toContain("<sheet");
  });

  it("엑셀이 아니면 실패한다", () => {
    expect(() => readZip(Buffer.from("not a zip"))).toThrow();
  });
});

describe("출입통제 실패 규칙", () => {
  it("단가가 숫자가 아니면 시트·행을 알려 준다", async () => {
    const buf = await patch(accessBuf, "xl/worksheets/sheet1.xml", (x) => x.replace("1234567", "abc"));
    // 공유 문자열이 아닌 숫자 셀이어야 치환이 의미 있다. 치환이 안 되면 검사 자체가 무의미하므로 확인한다.
    expect(buf.equals(accessBuf)).toBe(false);
    expect(() => parseAccessCatalog(buf)).toThrow("기준가격 4행의 부가세 별도 단가를 확인하세요.");
  });

  it("단가 범위를 넘으면 실패한다", async () => {
    const buf = await patch(accessBuf, "xl/worksheets/sheet1.xml", (x) => x.replace("1234567", "100000000001"));
    expect(() => parseAccessCatalog(buf)).toThrow("기준가격 4행의 부가세 별도 단가를 확인하세요.");
  });

  it("단가는 원 단위로 사사오입한다", async () => {
    const buf = await patch(accessBuf, "xl/worksheets/sheet1.xml", (x) => x.replace("1234567", "1234567.5"));
    expect(parseAccessCatalog(buf).entries[0].price).toBe(1234568);
  });

  it("머리글이 없으면 실패한다", async () => {
    const buf = await patch(accessBuf, "xl/worksheets/sheet1.xml", (x) => x.replace(/단가/g, "가격"));
    expect(() => parseAccessCatalog(buf)).toThrow("품목·제품명·단가 열이 있는 가격표를 확인하세요.");
  });
});

describe("제품가격표 실패 규칙", () => {
  it("제품 표가 없으면 실패한다", async () => {
    let buf: Buffer = catalogBuf;
    for (const s of ["sheet1", "sheet2", "sheet3"]) {
      buf = await patch(buf, `xl/worksheets/${s}.xml`, (x) => x.replace(/<row r="(2[1-9]|[3-9]\d)"[\s\S]*?<\/row>/g, ""));
    }
    await expect(parseProductCatalog(buf)).rejects.toThrow("제품 표를 찾지 못했습니다. C열 품목, F열 단위, G열 수량, H열 단가 구조를 확인하세요.");
  });

  it("읽을 수 없는 사진은 경고를 남긴다", async () => {
    const zip = await JSZip.loadAsync(catalogBuf);
    zip.file("xl/media/image1.png", "broken");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const { catalog } = await parseProductCatalog(buf);
    expect(catalog.warnings.some((w) => w.endsWith(": 제품 사진 형식을 읽지 못했습니다."))).toBe(true);
  });
});

describe("사진 축소", () => {
  it("긴 변을 줄이고 불투명하면 JPEG", async () => {
    const src = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#336699" } }).png().toBuffer();
    const out = await encodeImage(src);
    expect(out.ext).toBe("jpg");
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(IMAGE_MAX_SIDE);
  });

  it("작은 사진은 키우지 않고, 투명하면 PNG", async () => {
    const src = await sharp({ create: { width: 100, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
    const out = await encodeImage(src);
    expect(out.ext).toBe("png");
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([100, 50]);
  });

  it("알파 채널이 있어도 모두 불투명하면 JPEG", async () => {
    const src = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    expect((await encodeImage(src)).ext).toBe("jpg");
  });
});

describe("변환 산출물 쓰기·읽기", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pricelists-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("access.json·catalog.json·images를 쓰고 로더가 읽는다", async () => {
    const access = parseAccessCatalog(accessBuf);
    const product = await parseProductCatalog(catalogBuf);
    const out = path.join(dir, "generated/pricelists");
    writePricelists(out, access, product);
    expect(readdirSync(path.join(out, "images")).length).toBe(product.images.size);

    const loader = createLoader(out);
    expect(loader.loadAccessCatalog()).toEqual(access);
    const loaded = loader.loadProductCatalog();
    expect(loaded.entries).toEqual(product.catalog.entries);
    expect(loaded.revision).toBe(product.catalog.revision);
    const [id, img] = [...product.images][0];
    expect(loader.loadCatalogImage(id)).toEqual({ data: img.data, ext: img.ext, contentType: img.ext === "png" ? "image/png" : "image/jpeg" });
    expect(loader.loadCatalogImage("없는id")).toBeNull();
    expect(loader.loadCatalogImage("../access")).toBeNull();

    // 다시 쓰면 이전 파일을 지운다
    writePricelists(out, access, { catalog: { ...product.catalog, entries: [] }, images: new Map() });
    expect(readdirSync(path.join(out, "images")).length).toBe(0);
  });

  it("변환 데이터가 없으면 한국어로 알린다", () => {
    const loader = createLoader(path.join(dir, "없음"));
    expect(existsSync(path.join(dir, "없음"))).toBe(false);
    expect(() => loader.loadAccessCatalog()).toThrow("가격표 변환 데이터가 없습니다. npm run prepare-data 를 실행하세요.");
    expect(() => loader.loadProductCatalog()).toThrow("가격표 변환 데이터가 없습니다. npm run prepare-data 를 실행하세요.");
  });
});

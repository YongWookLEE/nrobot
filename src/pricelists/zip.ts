// xlsx(zip) 최소 읽기. 중앙 디렉터리를 직접 읽어 파일 목록·압축 해제 크기를 얻는다.
import { inflateRawSync } from "node:zlib";

export interface ZipReader {
  names: string[];
  /** 압축 해제 크기 합계 (Python ZipFile file_size 합과 같음) */
  totalSize: number;
  has(name: string): boolean;
  read(name: string): Buffer;
  text(name: string): string;
}

interface ZipEntry {
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const NOT_ZIP = "엑셀(.xlsx) 파일 형식이 아닙니다.";

export function readZip(input: Buffer | Uint8Array): ZipReader {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  // End of central directory: 뒤에서부터 서명 검색 (주석 최대 65535바이트)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(NOT_ZIP);
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  // ZIP64
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== 0x07064b50) throw new Error(NOT_ZIP);
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    if (buf.readUInt32LE(z64) !== 0x06064b50) throw new Error(NOT_ZIP);
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const entries = new Map<string, ZipEntry>();
  const names: string[] = [];
  let totalSize = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error(NOT_ZIP);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const name = flags & 0x800 ? rawName.toString("utf8") : rawName.toString("latin1");
    // ZIP64 extra field
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = buf.readUInt16LE(e);
      const len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(q)); }
      }
      e += 4 + len;
    }
    if (!entries.has(name)) names.push(name);
    entries.set(name, { method, compressedSize, size, localOffset });
    totalSize += size;
    p = extraEnd + commentLen;
  }

  const read = (name: string): Buffer => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`엑셀 안에 ${name} 이(가) 없습니다.`);
    const lp = entry.localOffset;
    if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error(NOT_ZIP);
    const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
    const data = buf.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return Buffer.from(data);
    if (entry.method === 8) return inflateRawSync(data);
    throw new Error(`${name}: 지원하지 않는 압축 방식입니다.`);
  };

  return {
    names,
    totalSize,
    has: (name) => entries.has(name),
    read,
    text: (name) => read(name).toString("utf8"),
  };
}

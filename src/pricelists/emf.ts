// EMF 사진 읽기. 엑셀에 붙여 넣은 그림은 비트맵 하나를 감싼 EMF(EMR_STRETCHDIBITS)인 경우가 많다.
// 기존(PIL, Windows)은 EMF를 그려서 읽었다. sharp는 EMF를 못 읽으므로 안의 비트맵을 꺼낸다.
// 비트맵 기록이 없거나 지원하지 않는 형식이면 실패한다(→ "제품 사진 형식을 읽지 못했습니다." 경고).

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 3;
}

const EMR_HEADER = 1;
const EMR_EOF = 14;
const EMR_STRETCHDIBITS = 81;
const EMR_SETDIBITSTODEVICE = 80;

export function isEmf(buf: Buffer): boolean {
  return buf.length >= 44 && buf.readUInt32LE(0) === EMR_HEADER && buf.readUInt32LE(40) === 0x464d4520;
}

function maskShift(mask: number): { shift: number; max: number } {
  if (!mask) return { shift: 0, max: 0 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  return { shift, max: mask >>> shift };
}

/** DIB(BITMAPINFO + 픽셀) → RGB */
export function decodeDib(buf: Buffer, bmiOff: number, bitsOff: number): RawImage {
  const headerSize = buf.readUInt32LE(bmiOff);
  if (headerSize < 40) throw new Error("지원하지 않는 비트맵 머리글입니다.");
  const width = buf.readInt32LE(bmiOff + 4);
  const rawHeight = buf.readInt32LE(bmiOff + 8);
  const bpp = buf.readUInt16LE(bmiOff + 14);
  const compression = buf.readUInt32LE(bmiOff + 16);
  const clrUsed = buf.readUInt32LE(bmiOff + 32);
  const height = Math.abs(rawHeight);
  const bottomUp = rawHeight > 0;
  if (width <= 0 || height <= 0 || width * height > 50_000_000) throw new Error("비트맵 크기가 잘못되었습니다.");
  let masks: [number, number, number] | null = null;
  if (compression === 3 || compression === 6) {
    masks = headerSize >= 52
      ? [buf.readUInt32LE(bmiOff + 40), buf.readUInt32LE(bmiOff + 44), buf.readUInt32LE(bmiOff + 48)]
      : [buf.readUInt32LE(bmiOff + headerSize), buf.readUInt32LE(bmiOff + headerSize + 4), buf.readUInt32LE(bmiOff + headerSize + 8)];
  } else if (compression !== 0) {
    throw new Error("압축된 비트맵은 지원하지 않습니다.");
  }
  if (!masks && bpp === 16) masks = [0x7c00, 0x03e0, 0x001f];
  const palette: number[][] = [];
  if (bpp <= 8) {
    const count = clrUsed || 1 << bpp;
    const palOff = bmiOff + headerSize;
    for (let i = 0; i < count; i++) {
      const p = palOff + i * 4;
      palette.push([buf[p + 2], buf[p + 1], buf[p]]);
    }
  }
  const stride = Math.ceil((width * bpp) / 32) * 4;
  if (bitsOff + stride * height > buf.length) throw new Error("비트맵 데이터가 잘렸습니다.");
  const out = Buffer.alloc(width * height * 3);
  const m = masks?.map(maskShift);
  for (let y = 0; y < height; y++) {
    const row = bitsOff + (bottomUp ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      let r: number, g: number, b: number;
      if (bpp === 24 || (bpp === 32 && !m)) {
        const p = row + x * (bpp / 8);
        [b, g, r] = [buf[p], buf[p + 1], buf[p + 2]];
      } else if ((bpp === 32 || bpp === 16) && m) {
        const v = bpp === 32 ? buf.readUInt32LE(row + x * 4) : buf.readUInt16LE(row + x * 2);
        const ch = (i: number) => (m[i].max ? Math.round((((v & masks![i]) >>> m[i].shift) * 255) / m[i].max) : 0);
        [r, g, b] = [ch(0), ch(1), ch(2)];
      } else if (bpp === 8 || bpp === 4 || bpp === 1) {
        const bit = x * bpp;
        const byte = buf[row + (bit >> 3)];
        const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        [r, g, b] = palette[idx] ?? [0, 0, 0];
      } else {
        throw new Error("지원하지 않는 비트맵 색 깊이입니다.");
      }
      const o = (y * width + x) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return { data: out, width, height, channels: 3 };
}

/** EMF 안 첫 비트맵 기록을 꺼내 원본 영역(src rect)만큼 RGB로 돌려준다. */
export function emfToRaw(buf: Buffer): RawImage {
  let p = 0;
  while (p + 8 <= buf.length) {
    const type = buf.readUInt32LE(p);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8 || p + size > buf.length) break;
    if (type === EMR_STRETCHDIBITS || type === EMR_SETDIBITSTODEVICE) {
      const xSrc = buf.readInt32LE(p + 32);
      const ySrc = buf.readInt32LE(p + 36);
      const cxSrc = buf.readInt32LE(p + 40);
      const cySrc = buf.readInt32LE(p + 44);
      const offBmi = buf.readUInt32LE(p + 48);
      const offBits = buf.readUInt32LE(p + 56);
      const full = decodeDib(buf, p + offBmi, p + offBits);
      return cropRaw(full, xSrc, ySrc, cxSrc, cySrc);
    }
    if (type === EMR_EOF) break;
    p += size;
  }
  throw new Error("EMF 안에 비트맵이 없습니다.");
}

function cropRaw(img: RawImage, x: number, y: number, w: number, h: number): RawImage {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const width = Math.min(img.width - left, w);
  const height = Math.min(img.height - top, h);
  if (width <= 0 || height <= 0 || (left === 0 && top === 0 && width === img.width && height === img.height)) return img;
  const out = Buffer.alloc(width * height * 3);
  for (let r = 0; r < height; r++) {
    img.data.copy(out, r * width * 3, ((top + r) * img.width + left) * 3, ((top + r) * img.width + left + width) * 3);
  }
  return { data: out, width, height, channels: 3 };
}

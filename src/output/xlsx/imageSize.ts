// PNG·JPEG 머리말에서 픽셀 크기를 읽는다 (사진 크기 정보가 없는 직접 입력 행에서만 쓴다).

export interface PixelSize {
  width: number;
  height: number;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(data: Buffer): boolean {
  return data.length >= 8 && data.subarray(0, 8).equals(PNG_SIG);
}

/** 읽을 수 없으면 null */
export function imagePixelSize(data: Buffer): PixelSize | null {
  if (isPng(data)) {
    if (data.length < 24) return null;
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= data.length) {
    if (data[p] !== 0xff) return null;
    const marker = data[p + 1];
    if (marker === 0xff) {
      p += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    const len = data.readUInt16BE(p + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (p + 9 > data.length) return null;
      const height = data.readUInt16BE(p + 5);
      const width = data.readUInt16BE(p + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    p += 2 + len;
  }
  return null;
}

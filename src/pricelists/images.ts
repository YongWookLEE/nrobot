// 제품 사진 변환: 자르기(srcRect) → 축소 → JPEG(투명하면 PNG).
// 조정 가능한 값은 여기 한곳에 둔다.
import sharp, { type Sharp } from "sharp";
import { emfToRaw, isEmf } from "./emf";

/** 긴 변 최대 픽셀 (키우지는 않는다) */
export const IMAGE_MAX_SIDE = 600;
/** JPEG 품질 */
export const IMAGE_JPEG_QUALITY = 85;

export interface CatalogImage {
  data: Buffer;
  ext: "jpg" | "png";
}

/** srcRect 비율(0~1). 기존과 같이 l+r<1, t+b<1 일 때만 자른다. */
export interface CropRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

export async function encodeImage(src: Buffer, crop?: CropRect | null): Promise<CatalogImage> {
  // 기존(PIL)과 같이 EXIF 방향은 적용하지 않는다. 움직이는 그림은 첫 장만 쓴다.
  let img: Sharp;
  if (isEmf(src)) {
    const raw = emfToRaw(src);
    img = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels } });
  } else {
    img = sharp(src, { failOn: "error", animated: false });
  }
  const meta = await img.metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) throw new Error("사진 크기를 읽지 못했습니다.");
  if (crop && crop.l + crop.r < 1 && crop.t + crop.b < 1) {
    // PIL crop((int(w*l), int(h*t), int(w*(1-r)), int(h*(1-b))))
    const left = Math.trunc(w * crop.l);
    const top = Math.trunc(h * crop.t);
    const right = Math.trunc(w * (1 - crop.r));
    const bottom = Math.trunc(h * (1 - crop.b));
    // resize보다 먼저 부르면 원본 기준으로 자른다
    img = img.extract({ left, top, width: right - left, height: bottom - top });
  }
  img = img.resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: "inside", withoutEnlargement: true });
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = false;
  for (let i = info.channels - 1; i < data.length; i += info.channels) {
    if (data[i] < 255) {
      transparent = true;
      break;
    }
  }
  const raw = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  if (transparent) return { data: await raw.png({ compressionLevel: 9 }).toBuffer(), ext: "png" };
  return { data: await raw.removeAlpha().jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: false }).toBuffer(), ext: "jpg" };
}

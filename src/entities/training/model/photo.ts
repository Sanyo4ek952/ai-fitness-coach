import { progressPhotoSchema, type ProgressPhoto } from "./body-progress";

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
/** Inspect dimensions before invoking a decoder; only static PNG and JPEG. */
export function inspectPhoto(bytes: Uint8Array, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0; let height = 0;
  if (mime === "image/png" && bytes.length >= 33
    && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
    width = view.getUint32(16); height = view.getUint32(20);
    // Animated PNG is not an accepted progress photo.
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) throw new Error("Повреждён PNG");
      if (view.getUint32(offset + 4) === 0x6163544c) throw new Error("Выберите статичное фото");
      offset += length + 12;
    }
  } else if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 255) throw new Error("Повреждён JPEG");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || length > bytes.length - offset) throw new Error("Повреждён JPEG");
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) throw new Error("Повреждён JPEG");
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height || width > 4096 || height > 4096 || width * height > 12000000) {
    throw new Error("Нужно JPEG или PNG до 4096 пикселей по стороне и 12 Мп");
  }
  return { width, height };
}

/** Canvas creates a new JPEG: original bytes, filename and EXIF are not stored. */
export async function prepareProgressPhoto(file: Blob, id: string, createdAt: string): Promise<ProgressPhoto> {
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error("Выберите JPEG или PNG размером до 5 МиБ");
  const dimensions = inspectPhoto(new Uint8Array(await file.arrayBuffer()), file.type);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    // EXIF orientation may interchange the two axes. No other size mismatch is accepted.
    if (!(image.naturalWidth === dimensions.width && image.naturalHeight === dimensions.height)
      && !(image.naturalWidth === dimensions.height && image.naturalHeight === dimensions.width)) throw new Error("Размер фото не совпадает с заголовком");
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Браузер не смог подготовить фото");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Не удалось подготовить фото")), "image/jpeg", 0.85));
    return progressPhotoSchema.parse({ id, createdAt, mime: "image/jpeg", size: blob.size, width: canvas.width, height: canvas.height, blob });
  } finally { URL.revokeObjectURL(url); }
}

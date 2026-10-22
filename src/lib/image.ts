/** Photo decoding (incl. HEIC fallback) and the final crop render. */
import { coverScale, cropAngle, outputSize, type CropState } from "./crop";

export class ImageLoadError extends Error {}

export interface LoadedImage {
  img: HTMLImageElement;
  url: string;
  width: number;
  height: number;
  name: string;
}

/** The fixed reference photo every try-on is rendered from. */
export interface Photo {
  canvas: HTMLCanvasElement;
  imageData: ImageData;
  width: number;
  height: number;
}

const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const ACCEPTED_TYPES = "image/jpeg,image/png,image/heic,image/heif,image/webp,.jpg,.jpeg,.png,.heic,.heif,.webp";

export function isHeic(file: Blob & { name?: string }): boolean {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? "");
}

async function decodeBlob(blob: Blob, name: string): Promise<LoadedImage> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageLoadError("decode");
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new ImageLoadError("decode");
  }
  return { img, url, width: img.naturalWidth, height: img.naturalHeight, name };
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
  const looksLikeImage = file.type.startsWith("image/") || isHeic(file) || /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!looksLikeImage) {
    throw new ImageLoadError("That file isn't a photo. Please choose a JPG, PNG or HEIC image.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ImageLoadError("That photo is larger than 60 MB. Please choose a smaller one.");
  }
  try {
    return await decodeBlob(file, file.name);
  } catch {
    if (!isHeic(file)) {
      throw new ImageLoadError("We couldn't read this photo. It may be damaged or in an unsupported format.");
    }
  }
  // This browser can't decode HEIC natively (Safari can); convert locally.
  try {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob) throw new Error("empty");
    return await decodeBlob(blob, file.name);
  } catch {
    throw new ImageLoadError("This HEIC photo couldn't be converted in this browser. Try exporting it as JPG first.");
  }
}

export function releaseImage(image: LoadedImage | null): void {
  if (image) URL.revokeObjectURL(image.url);
}

/** Renders the framed region of the source image at working resolution. */
export function renderCrop(image: LoadedImage, crop: CropState): HTMLCanvasElement {
  const { width, height } = outputSize(image.width, image.height, crop);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // The working photo is read back (getImageData) for detection and editing.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new ImageLoadError("Your browser couldn't allocate memory for this photo.");
  const theta = cropAngle(crop);
  const scale = crop.zoom * coverScale(image.width, image.height, width, height, theta);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(width / 2 + crop.panX * width, height / 2 + crop.panY * width);
  ctx.rotate(theta);
  ctx.scale(scale, scale);
  ctx.drawImage(image.img, -image.width / 2, -image.height / 2);
  return canvas;
}

export function photoFromCanvas(canvas: HTMLCanvasElement): Photo {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new ImageLoadError("Your browser couldn't allocate memory for this photo.");
  return { canvas, imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), width: canvas.width, height: canvas.height };
}

export async function photoFromBlob(blob: Blob): Promise<Photo> {
  const loaded = await decodeBlob(blob, "saved");
  try {
    const canvas = document.createElement("canvas");
    canvas.width = loaded.width;
    canvas.height = loaded.height;
    canvas.getContext("2d")?.drawImage(loaded.img, 0, 0);
    return photoFromCanvas(canvas);
  } finally {
    releaseImage(loaded);
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), type, quality);
  });
}

/** Releases a canvas's backing store promptly (important on iOS Safari's tight canvas budget). */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

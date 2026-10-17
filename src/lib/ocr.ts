import { invoke } from "@tauri-apps/api/core";

/** Checked per call (not at module load) so tests can flip the environment. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True when on-device OCR is available (macOS desktop app). */
export function ocrAvailable(): boolean {
  return isTauri();
}

/**
 * Recognize text in one image with macOS's built-in Vision framework via the
 * Rust shell (src-tauri/src/lib.rs `ocr_image`) — on-device, nothing to
 * install. `imageDataUrl` is a `data:image/…;base64,…` URL (as produced by
 * pdfPagesToDataUrls) or a bare base64 payload. Returns the recognized text
 * ("" when the image holds none).
 */
export async function ocrImageDataUrl(imageDataUrl: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("On-device OCR is only available in the desktop app.");
  }
  return invoke<string>("ocr_image", { imageBase64: imageDataUrl });
}

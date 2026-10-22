// Client-side export helpers for inline diagrams (```mermaid / ```chart /
// ```svg fences): download as SVG or PNG, copy as PNG to the clipboard.
//
// Rasterization goes SVG → <img> → <canvas>, filled white first so the image
// matches the white card the diagram sits on (a transparent PNG would lose
// its dark text on dark backgrounds). The clipboard only accepts image/png —
// ClipboardItem.supports("image/jpeg") is false in WebKit and Chromium — so
// the copy is PNG-only. SVG markup containing <foreignObject> (mermaid's
// htmlLabels mode) taints the canvas — "Tainted canvases may not be
// exported" — so callers must hand over pure-SVG markup (the mermaid block
// re-renders with htmlLabels:false for export).

/** Fixed render size used when the markup declares none (matches the browser default). */
const DEFAULT_DIAGRAM_WIDTH = 800;
const DEFAULT_DIAGRAM_HEIGHT = 600;
/** Rasterize at 2x for crisp text; cap the longest canvas side (WKWebView dies well before its canvas limits). */
const RASTER_SCALE = 2;
const MAX_CANVAS_SIDE = 4096;

/**
 * Reads the intended pixel size from the SVG root: numeric width/height
 * attributes win, otherwise the viewBox (mermaid emits width="100%" plus a
 * max-width style, so the viewBox is the real size there).
 */
export function svgDimensions(markup: string): { width: number; height: number } {
  const openTag = /<svg[^>]*>/i.exec(markup)?.[0] ?? "";
  const viewBox =
    /viewBox\s*=\s*["']\s*[-\d.eE]+[\s,]+[-\d.eE]+[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)\s*["']/i.exec(
      openTag,
    );
  const attr = (name: string): number => {
    const match = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(openTag);
    if (!match || match[1].includes("%")) return NaN;
    const value = parseFloat(match[1]);
    return Number.isFinite(value) && value > 0 ? value : NaN;
  };
  let width = attr("width");
  let height = attr("height");
  if (viewBox) {
    if (!(width > 0)) width = parseFloat(viewBox[1]);
    if (!(height > 0)) height = parseFloat(viewBox[2]);
  }
  return {
    width: width > 0 ? width : DEFAULT_DIAGRAM_WIDTH,
    height: height > 0 ? height : DEFAULT_DIAGRAM_HEIGHT,
  };
}

/**
 * Resolves percentage sizes (mermaid emits width="100%" plus a max-width
 * style) to the intrinsic pixel size, so saved files and rasterized images
 * render the same everywhere.
 */
export function normalizeSvgSize(markup: string): string {
  const { width, height } = svgDimensions(markup);
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== "svg") {
    throw new Error("Diagram is not an SVG document");
  }
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  const style = root.getAttribute("style");
  if (style) {
    const cleaned = style.replace(/max-width\s*:[^;]+;?/i, "").trim();
    if (cleaned) root.setAttribute("style", cleaned);
    else root.removeAttribute("style");
  }
  return new XMLSerializer().serializeToString(root);
}

/**
 * Rasterizes SVG markup to a white-backed PNG blob — the background is baked
 * in so the copy/save looks like the white card the diagram is displayed on.
 * The SVG is re-sized to its own pixel dimensions first: a width="100%"
 * attribute would otherwise leave the loaded image without an intrinsic size.
 */
export async function rasterizeSvgToPng(markup: string): Promise<Blob> {
  const { width, height } = svgDimensions(markup);
  const normalized = normalizeSvgSize(markup);
  const url = URL.createObjectURL(
    new Blob([normalized], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Diagram image failed to load"));
      image.src = url;
    });
    const scale = Math.min(RASTER_SCALE, MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Diagram image could not be encoded"))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadDiagramSvg(markup: string, name: string): void {
  let out = markup;
  try {
    out = normalizeSvgSize(markup);
  } catch {
    // Not parseable as an SVG document — save the markup as-is.
  }
  downloadBlob(new Blob([out], { type: "image/svg+xml;charset=utf-8" }), `${name}.svg`);
}

export async function downloadDiagramPng(markup: string, name: string): Promise<void> {
  downloadBlob(await rasterizeSvgToPng(markup), `${name}.png`);
}

/** Copies the diagram to the clipboard as a white-backed PNG. */
export async function copyDiagramPng(markup: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("The clipboard is not available");
  }
  const png = await rasterizeSvgToPng(markup);
  await clipboard.write([new ClipboardItem({ "image/png": png })]);
}

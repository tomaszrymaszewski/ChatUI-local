// Client-side export helpers for inline diagrams (```mermaid / ```chart /
// ```svg fences): download as SVG or PNG, copy as PNG to the clipboard.
//
// Rasterization goes SVG → <img> → <canvas>, filled white first so the image
// is a light page in any viewer (a transparent PNG would lose the dark text
// on dark viewers). The clipboard only accepts image/png —
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

/** Viewbox of an SVG root, or its width/height attributes when it has no viewBox. */
interface SvgCanvas {
  x: number;
  y: number;
  width: number;
  height: number;
}

function svgCanvas(root: Element): SvgCanvas | null {
  const parts = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isFinite(part)) &&
    parts[2] > 0 &&
    parts[3] > 0
  ) {
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
  }
  const rawWidth = root.getAttribute("width") ?? "";
  const rawHeight = root.getAttribute("height") ?? "";
  if (rawWidth.includes("%") || rawHeight.includes("%")) return null;
  const width = parseFloat(rawWidth);
  const height = parseFloat(rawHeight);
  return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : null;
}

/** True for a rect that paints across the whole canvas: a background, not part of the drawing. */
function isCanvasBackground(rect: Element, canvas: SvgCanvas): boolean {
  const style = rect.getAttribute("style") ?? "";
  const fill = (
    rect.getAttribute("fill") ??
    /(?:^|;)\s*fill\s*:\s*([^;]+)/.exec(style)?.[1] ??
    ""
  )
    .trim()
    .toLowerCase();
  if (fill === "none" || fill === "transparent") return false;
  if (parseFloat(rect.getAttribute("fill-opacity") ?? "1") === 0) return false;
  const read = (name: string): number | undefined => {
    const raw = (rect.getAttribute(name) ?? "").trim();
    if (raw === "") return undefined;
    if (raw === "100%") return Infinity;
    if (raw.endsWith("%")) return undefined;
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const width = read("width");
  const height = read("height");
  if (width === undefined || height === undefined) return false;
  const x = read("x") ?? 0;
  const y = read("y") ?? 0;
  const slack = Math.max(canvas.width, canvas.height) * 0.02;
  return (
    x <= canvas.x + slack &&
    y <= canvas.y + slack &&
    x + width >= canvas.x + canvas.width - slack &&
    y + height >= canvas.y + canvas.height - slack
  );
}

/**
 * Removes the solid background a diagram paints behind itself: a full-canvas
 * rect (the first element of the root or of a top-level group) and a
 * background declared on the root <svg>. Diagrams then sit directly on the
 * chat background. Markup without an <svg> root comes back unchanged.
 */
export function stripSvgBackground(markup: string): string {
  if (typeof DOMParser === "undefined") return markup;
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const root = doc.body.querySelector("svg");
  if (!root) return markup;

  const canvas = svgCanvas(root);
  if (canvas) {
    const candidates: Element[] = [];
    for (const child of Array.from(root.children)) {
      if (child.tagName.toLowerCase() === "rect") {
        candidates.push(child);
      } else if (child.tagName.toLowerCase() === "g") {
        const first = child.firstElementChild;
        if (first && first.tagName.toLowerCase() === "rect") candidates.push(first);
      }
    }
    for (const rect of candidates) {
      if (isCanvasBackground(rect, canvas)) rect.remove();
    }
  }

  const style = root.getAttribute("style");
  if (style !== null) {
    const kept = style
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(
        (declaration) =>
          declaration.length > 0 && !/^background(-color)?\s*:/i.test(declaration),
      );
    if (kept.length > 0) root.setAttribute("style", kept.join("; "));
    else root.removeAttribute("style");
  }
  return root.outerHTML;
}

/**
 * Rasterizes SVG markup to a white-backed PNG blob. The background is baked
 * in, so the copy or save reads the same in any viewer.
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

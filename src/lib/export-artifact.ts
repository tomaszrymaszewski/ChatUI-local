import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import katexCss from "katex/dist/katex.min.css?inline";

export type ExportFormat = "md" | "html" | "pdf" | "docx" | "svg" | "py" | "txt";

interface ExportableArtifact {
  title: string;
  language: string;
  content: string;
}

function slugify(title: string): string {
  return title.replace(/\s+/g, "-").replace(/[^\w.-]/g, "").toLowerCase() || "artifact";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const EXPORT_BASE_CSS = `
  *, *::before, *::after { border-color: #ddd; color: inherit; background-color: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
         max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #111; }
  h1, h2, h3, h4 { line-height: 1.25; margin-top: 1.25em; margin-bottom: 0.5em; }
  pre { background: #f5f5f5; padding: 0.75rem; border-radius: 6px; overflow-x: auto; font-size: 0.85em; }
  code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 4px; font-size: 0.9em; }
  pre code { background: transparent; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  th { background: #f5f5f5; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 1rem; color: #555; }
  img { max-width: 100%; }
`;

/** Render markdown to HTML without any theme/provider-dependent components. */
export function markdownToHtml(md: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [rehypeKatex],
      },
      md,
    ),
  );
}

function wrapHtmlDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${katexCss}</style>
<style>${EXPORT_BASE_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function artifactBodyHtml(artifact: ExportableArtifact): string {
  const lang = artifact.language.toLowerCase();
  if (lang === "markdown" || lang === "md") {
    return markdownToHtml(artifact.content);
  }
  if (lang === "svg") {
    return `<div style="display:flex;align-items:center;justify-content:center;min-height:60vh">${artifact.content}</div>`;
  }
  if (lang === "html") {
    return artifact.content;
  }
  return `<pre>${escapeHtml(artifact.content)}</pre>`;
}

function buildExportHtml(artifact: ExportableArtifact): string {
  const lang = artifact.language.toLowerCase();
  if (lang === "html") {
    return artifact.content;
  }
  return wrapHtmlDocument(artifact.title, artifactBodyHtml(artifact));
}

/**
 * Print layout injected into the PDF render frame. A canvas has no
 * scrolling: anything that overflows horizontally (overflow-x: auto code
 * blocks, wide tables, long unbroken strings) is simply clipped off the
 * page. Force everything to wrap inside the frame width instead.
 */
const PDF_PRINT_CSS = `
  pre { white-space: pre-wrap; word-wrap: break-word; overflow-x: visible; }
  code { word-wrap: break-word; overflow-wrap: break-word; }
  table { width: 100%; table-layout: fixed; }
  th, td { word-wrap: break-word; overflow-wrap: break-word; }
  img, svg, video { max-width: 100% !important; height: auto; }
`;

function buildPdfDocument(artifact: ExportableArtifact): string {
  // Full HTML documents pass through (minus scripts — they would execute in
  // the hidden render frame, hitting the network and stalling the export);
  // everything else gets the same standalone shell as the HTML export.
  const raw =
    artifact.language.toLowerCase() === "html" && /<html[\s>]/i.test(artifact.content)
      ? artifact.content
      : wrapHtmlDocument(artifact.title, artifactBodyHtml(artifact));
  const stripped = raw
    .replace(/<script[\s>][\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*\/>/gi, "");
  const printStyle = `<style>${PDF_PRINT_CSS}</style>`;
  return /<\/head\s*>/i.test(stripped)
    ? stripped.replace(/<\/head\s*>/i, `${printStyle}</head>`)
    : `${printStyle}${stripped}`;
}

/**
 * Override injected into html2canvas's render clone. The render happens
 * inside the hidden export frame, so the app's stylesheets never reach it —
 * but the artifact's OWN html can still use modern color functions
 * (oklch, color-mix) that html2canvas throws on ("unsupported color
 * function"). These !important rules force every color-valued property it
 * reads into plain hex it understands, mirroring the export palette.
 */
const PDF_CLONE_OVERRIDE_CSS = `
* { color: #111111 !important; background-color: transparent !important; background-image: none !important; border-top-color: #dddddd !important; border-right-color: #dddddd !important; border-bottom-color: #dddddd !important; border-left-color: #dddddd !important; text-decoration-color: #1a0dab !important; box-shadow: none !important; text-shadow: none !important; }
a, a * { color: #1a0dab !important; }
pre { background-color: #f5f5f5 !important; }
code { background-color: #f0f0f0 !important; }
pre code { background-color: transparent !important; }
th { background-color: #f5f5f5 !important; }
blockquote { color: #555555 !important; }
`;

const VEGA_LANGS = new Set(["chart", "vega", "vega-lite", "vegalite"]);

function codeFenceLang(el: HTMLElement): string {
  for (const cls of Array.from(el.classList)) {
    if (cls.startsWith("language-")) return cls.slice("language-".length).toLowerCase();
  }
  return "";
}

/**
 * The export markdown pipeline is plain ReactMarkdown — it has no
 * MermaidBlock/VegaBlock/SvgBlock components, so diagram fences reach the
 * render frame as raw code blocks. Render each one to SVG here (same
 * libraries, options and sanitization as the chat renderer) and swap it in
 * place of the code. A diagram that fails to parse stays a code block, as
 * in the chat UI.
 */
async function renderDiagramsInFrame(frameDoc: Document): Promise<void> {
  const blocks = Array.from(frameDoc.querySelectorAll<HTMLElement>("pre > code")).filter(
    (el) => {
      const lang = codeFenceLang(el);
      return lang === "mermaid" || lang === "svg" || VEGA_LANGS.has(lang);
    },
  );
  if (blocks.length === 0) return;
  let mermaid: typeof import("mermaid").default | undefined;
  let vegaEmbed: typeof import("vega-embed").default | undefined;
  for (let i = 0; i < blocks.length; i++) {
    const code = blocks[i];
    const pre = code.parentElement;
    if (!pre) continue;
    const lang = codeFenceLang(code);
    const text = code.textContent ?? "";
    try {
      let svg: string;
      if (lang === "svg") {
        // Raw SVG markup — sanitize exactly like the chat renderer's
        // SvgBlock (scripts and foreignObject out, rest untouched).
        svg = text
          .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
          .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "");
        if (!/<svg[\s>]/i.test(svg)) throw new Error("not an svg document");
      } else if (lang === "mermaid") {
        mermaid ??= (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        ({ svg } = await mermaid.render(`pdf-export-mermaid-${i}`, text));
      } else {
        vegaEmbed ??= (await import("vega-embed")).default;
        // vega-embed needs a laid-out container; render in a hidden div in
        // the MAIN document (the frame has no vega runtime) and lift the
        // resulting SVG markup across.
        const host = document.createElement("div");
        host.style.position = "fixed";
        host.style.left = "-10000px";
        host.style.top = "0";
        host.style.width = "720px";
        host.style.background = "#ffffff";
        document.body.appendChild(host);
        try {
          const result = await vegaEmbed(host, JSON.parse(text), {
            actions: false,
            renderer: "svg",
          });
          svg = await result.view.toSVG();
          result.finalize();
        } finally {
          host.remove();
        }
        svg = svg.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
      }
      const holder = frameDoc.createElement("div");
      holder.setAttribute("style", "margin:0.5em 0;text-align:center");
      holder.innerHTML = svg;
      holder.querySelectorAll("svg").forEach((s) => {
        s.setAttribute("style", "max-width:100%;height:auto");
      });
      pre.replaceWith(holder);
    } catch {
      // Leave the code block in place — same fallback as the chat UI.
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

// A4 portrait (210x297mm) minus the 10mm jsPDF margin on every side.
const PDF_PAGE_WIDTH_MM = 190;
const PDF_PAGE_HEIGHT_MM = 277;
const PDF_FRAME_WIDTH_PX = 760;
const PDF_PAGE_HEIGHT_PX = Math.floor(
  (PDF_FRAME_WIDTH_PX * PDF_PAGE_HEIGHT_MM) / PDF_PAGE_WIDTH_MM,
);

async function exportPdf(artifact: ExportableArtifact): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  // The source is measured at export width in a hidden same-origin frame so
  // the app layout is never disturbed. html2canvas clones the element's OWN
  // document, so rendering inside the frame also isolates styles: the app's
  // Tailwind theme (oklch/color-mix) never reaches the render clone.
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-10000px";
  frame.style.top = "0";
  frame.style.width = `${PDF_FRAME_WIDTH_PX}px`;
  frame.style.height = "600px";
  frame.style.border = "0";
  frame.style.background = "#ffffff";
  document.body.appendChild(frame);
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        frame.onload = () => resolve();
        frame.onerror = () => reject(new Error("PDF export failed: could not render the document"));
        frame.srcdoc = buildPdfDocument(artifact);
      }),
      15000,
      "PDF export timed out while rendering the document",
    );
    const frameDoc = frame.contentDocument;
    const body = frameDoc?.body;
    if (!frameDoc || !body || !body.innerHTML.trim()) {
      throw new Error("PDF export failed: nothing to render");
    }
    try {
      // Mermaid/vega fences arrive here as plain code blocks — render them
      // to SVG before the page is measured (bounded; a broken diagram must
      // not sink the whole export, it just stays a code block).
      await withTimeout(renderDiagramsInFrame(frameDoc), 30000, "diagrams");
    } catch {
      // Render whatever diagrams made it in time.
    }
    try {
      // Bound font waiting — a hung webfont must not stall the export.
      await withTimeout(
        Promise.resolve(frameDoc.fonts.ready).then(() => undefined),
        3000,
        "fonts",
      );
    } catch {
      // System fallback fonts render fine without the webfonts.
    }
    try {
      // Images that finish loading AFTER the height is measured expand the
      // document and the tail gets chopped off the last page — wait for
      // them (bounded) before measuring.
      await withTimeout(
        Promise.all(
          Array.from(frameDoc.images).map((img) => img.decode().catch(() => undefined)),
        ).then(() => undefined),
        10000,
        "images",
      );
    } catch {
      // Whatever loaded by now is what gets measured.
    }
    const contentHeight = Math.max(
      body.scrollHeight,
      frameDoc.documentElement.scrollHeight,
      1,
    );
    frame.style.height = `${contentHeight + 40}px`;
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageCount = Math.max(1, Math.ceil(contentHeight / PDF_PAGE_HEIGHT_PX));
    await withTimeout(
      (async () => {
        for (let page = 0; page < pageCount; page++) {
          const chunkHeight = Math.min(
            PDF_PAGE_HEIGHT_PX,
            contentHeight - page * PDF_PAGE_HEIGHT_PX,
          );
          // Render one page-sized slice at a time. A single canvas for the
          // whole document exceeds WKWebView's canvas size limits (~8192px
          // per side) and silently comes back blank — which is exactly the
          // empty-PDF failure this replaces.
          const canvas = await html2canvas(body, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            imageTimeout: 15000,
            logging: false,
            x: 0,
            y: page * PDF_PAGE_HEIGHT_PX,
            width: PDF_FRAME_WIDTH_PX,
            height: chunkHeight,
            windowWidth: PDF_FRAME_WIDTH_PX,
            windowHeight: contentHeight + 40,
            scrollX: 0,
            scrollY: 0,
            onclone: (clone: Document) => {
              const style = clone.createElement("style");
              style.textContent = PDF_CLONE_OVERRIDE_CSS;
              clone.head.appendChild(style);
            },
          });
          if (page > 0) pdf.addPage();
          pdf.addImage(
            canvas,
            "JPEG",
            10,
            10,
            PDF_PAGE_WIDTH_MM,
            (chunkHeight * PDF_PAGE_WIDTH_MM) / PDF_FRAME_WIDTH_PX,
            undefined,
            "FAST",
          );
        }
      })(),
      120000,
      "PDF export timed out while generating the file",
    );
    pdf.save(`${slugify(artifact.title)}.pdf`);
  } finally {
    frame.remove();
  }
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");
}

async function exportDocx(artifact: ExportableArtifact): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

  const children: InstanceType<typeof Paragraph>[] = [];
  const lines = artifact.content.split("\n");
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      const headingLevels = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
        HeadingLevel.HEADING_5,
        HeadingLevel.HEADING_6,
      ];
      children.push(
        new Paragraph({
          heading: headingLevels[level - 1],
          children: [new TextRun(stripInlineMarkdown(heading[2]))],
        }),
      );
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun(stripInlineMarkdown(bullet[1]))],
        }),
      );
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      children.push(
        new Paragraph({
          children: [new TextRun(stripInlineMarkdown(numbered[1]))],
        }),
      );
      continue;
    }
    if (line.trim() === "") continue;
    children.push(new Paragraph({ children: [new TextRun(stripInlineMarkdown(line))] }));
  }
  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun("")] }));
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${slugify(artifact.title)}.docx`);
}

export function exportFormatsFor(language: string): ExportFormat[] {
  const lang = language.toLowerCase();
  if (lang === "markdown" || lang === "md") return ["md", "html", "pdf", "docx"];
  if (lang === "html") return ["html", "pdf"];
  if (lang === "svg") return ["svg", "pdf"];
  if (lang === "python" || lang === "py") return ["py"];
  return ["txt"];
}

export async function exportArtifact(
  artifact: ExportableArtifact,
  format: ExportFormat,
): Promise<void> {
  const slug = slugify(artifact.title);
  switch (format) {
    case "md":
      downloadBlob(new Blob([artifact.content], { type: "text/markdown" }), `${slug}.md`);
      return;
    case "svg":
      downloadBlob(new Blob([artifact.content], { type: "image/svg+xml" }), `${slug}.svg`);
      return;
    case "py":
      downloadBlob(new Blob([artifact.content], { type: "text/x-python" }), `${slug}.py`);
      return;
    case "txt":
      downloadBlob(new Blob([artifact.content], { type: "text/plain" }), `${slug}.txt`);
      return;
    case "html": {
      const html = buildExportHtml(artifact);
      downloadBlob(new Blob([html], { type: "text/html" }), `${slug}.html`);
      return;
    }
    case "pdf":
      await exportPdf(artifact);
      return;
    case "docx":
      await exportDocx(artifact);
      return;
  }
}

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

async function exportPdf(artifact: ExportableArtifact): Promise<void> {
  const { default: html2pdf } = await import("html2pdf.js");
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "760px";
  container.style.background = "#fff";
  container.style.color = "#111";
  const style = document.createElement("style");
  style.textContent = `${katexCss}${EXPORT_BASE_CSS}`;
  container.appendChild(style);
  const body = document.createElement("div");
  body.innerHTML = artifactBodyHtml(artifact);
  container.appendChild(body);
  document.body.appendChild(container);
  try {
    await html2pdf()
      .set({
        margin: 10,
        filename: `${slugify(artifact.title)}.pdf`,
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(container)
      .save();
  } finally {
    container.remove();
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

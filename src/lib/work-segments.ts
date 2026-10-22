// Text/working-phase interleaving helpers shared by the message renderer.

import type { WorkSegment } from "@/lib/agent/types";

/**
 * Splits finished assistant content at the end offsets of its work blocks:
 * the text generated after each working phase becomes its own part. A
 * boundary sits where a work block ended (`endTextOffset`, falling back to
 * its start offset — no text can stream while work is in flight), so
 * boundaries at 0, past the end, or duplicated by consecutive blocks are
 * ignored and whitespace-only parts are dropped.
 */
/**
 * Splits streaming markdown into chunks at safe block boundaries: blank
 * lines outside fenced code blocks and $$ math blocks, each chunk at least
 * `minChars` long. A boundary decision depends only on the text before it,
 * so boundaries never move as content grows — a memoized per-chunk renderer
 * then skips every completed chunk and only the live tail re-parses per
 * streaming tick. Re-parsing the whole message through remark + KaTeX +
 * Prism on every tick instead is superlinear in length (seconds past
 * ~100KB of math-heavy text), saturating the main thread: the app freezes
 * mid-run while scrolling — which is composited — keeps working.
 */
export function chunkStreamingMarkdown(content: string, minChars = 1500): string[] {
  if (content.length < minChars * 2) return [content];
  const chunks: string[] = [];
  let chunkStart = 0;
  let fenceChar = "";
  let fenceLen = 0;
  let inMathBlock = false;
  let lineStart = 0;
  while (lineStart < content.length) {
    const newline = content.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? content.length : newline;
    const line = content.slice(lineStart, lineEnd);
    const trimmed = line.trimStart();
    const fence = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      if (fenceChar === "") {
        fenceChar = fence[1][0];
        fenceLen = fence[1].length;
      } else if (fence[1][0] === fenceChar && fence[1].length >= fenceLen) {
        fenceChar = "";
        fenceLen = 0;
      }
    } else if (fenceChar === "") {
      // An odd $$ count on a line opens or closes a display-math block.
      const pairs = line.match(/\$\$/g);
      if (pairs && pairs.length % 2 === 1) inMathBlock = !inMathBlock;
    }
    if (fenceChar === "" && !inMathBlock && trimmed === "" && lineStart - chunkStart >= minChars) {
      chunks.push(content.slice(chunkStart, lineStart));
      chunkStart = lineEnd + 1;
    }
    if (newline === -1) break;
    lineStart = lineEnd + 1;
  }
  if (chunkStart < content.length) chunks.push(content.slice(chunkStart));
  return chunks;
}

export function splitTextAtWorkEnds(content: string, segments: WorkSegment[]): string[] {
  const boundaries = Array.from(
    new Set(
      segments
        .map((segment) => segment.endTextOffset ?? segment.textOffset)
        .filter((offset) => offset > 0 && offset < content.length),
    ),
  ).sort((a, b) => a - b);
  const parts: string[] = [];
  let last = 0;
  for (const boundary of boundaries) {
    parts.push(content.slice(last, boundary));
    last = boundary;
  }
  parts.push(content.slice(last));
  return parts.filter((part) => part.trim().length > 0);
}

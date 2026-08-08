import type { Provider } from "@/types";
import type { ContentPart } from "@/lib/llm";
import {
  isImageFile,
  isTextLikeFile,
  extractFileText,
  fileToDataUrl,
  chunkText,
} from "@/lib/files";
import { embed, embedQuery, cosineSimilarity } from "@/lib/embeddings";
import { getModelCapabilities } from "@/lib/model-capabilities";

interface Attachable {
  name: string;
  type: string;
  file?: File;
}

export interface PreparedAttachmentContext {
  content: string | ContentPart[];
  blocked: boolean;
  warning?: string;
}

const INLINE_THRESHOLD = 6000;
const MAX_INLINE_CHARS = 12000;
const RAG_TOP_K = 4;

/**
 * Prepare attachment content for an outgoing chat message.
 * - Images: blocked if the model lacks vision; otherwise base64 image_url parts.
 * - Documents (text/PDF/DOCX): inlined if small, else chunked + embedded + top-K retrieved.
 */
export async function prepareAttachmentContext(
  files: Attachable[],
  userText: string,
  provider: Provider,
  modelName: string,
  modelLabel?: string,
): Promise<PreparedAttachmentContext> {
  const images = files.filter((f) => isImageFile(f) && f.file);
  const documents = files.filter((f) => !isImageFile(f) && f.file);

  if (images.length > 0) {
    const caps = await getModelCapabilities(provider, modelName);
    if (!caps.vision) {
      return {
        content: userText,
        blocked: true,
        warning: `${modelLabel ?? modelName} doesn't support image input. Remove the image or switch to a vision-capable model.`,
      };
    }
  }

  let docContext = "";
  for (const doc of documents) {
    const text = await extractFileText(doc.file!);
    if (!text) {
      if (!isTextLikeFile(doc)) {
        // Unsupported binary file (e.g. xlsx) — note it
        docContext += `\n\n--- ${doc.name} ---\n[File content could not be extracted]`;
      }
      continue;
    }
    if (text.length <= INLINE_THRESHOLD) {
      docContext += `\n\n--- ${doc.name} ---\n${text.slice(0, MAX_INLINE_CHARS)}`;
    } else {
      const chunks = chunkText(text);
      const chunkEmbeds = await embed(chunks);
      const queryVec = await embedQuery(userText || doc.name);
      const ranked = chunks
        .map((c, i) => ({ c, s: cosineSimilarity(queryVec, chunkEmbeds[i] ?? []) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, RAG_TOP_K);
      docContext += `\n\n--- ${doc.name} (relevant excerpts) ---\n${ranked.map((r) => r.c).join("\n…\n")}`;
    }
  }

  const fullText = docContext ? userText + docContext : userText;

  if (images.length > 0) {
    const imageUrls = await Promise.all(images.map((f) => fileToDataUrl(f.file!)));
    const content: ContentPart[] = [
      { type: "text", text: fullText },
      ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    ];
    return { content, blocked: false };
  }

  return { content: fullText, blocked: false };
}

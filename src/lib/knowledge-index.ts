// Persistent knowledge index for RAG. Scans past chats, uploaded files and
// images, skills, connectors and memories into chunk docs, embeds them ONCE
// (local transformers.js model or a configured OpenAI-compatible /v1/embeddings
// endpoint) and stores them in the sqlite-vec index managed by the Rust shell
// (~/Documents/chatUI/index.db). Retrieval helpers live in
// knowledge-retrieval.ts; the agent-facing search_knowledge tool consumes it.

import { invoke } from "@tauri-apps/api/core";
import type { Provider, UserSettings } from "@/types";
import { loadUserSettings } from "@/hooks/use-user-settings";
import {
  embedForIndex,
  embedQueryForIndex,
  getIndexEmbedder,
} from "@/lib/embeddings";
import { chunkText, extractFileText, fileToDataUrl, normalizeImageFile } from "@/lib/files";
import { getFileBlob, getFileText, setFileText } from "@/lib/attachment-store";
import {
  getBundledSkillContent,
  getCuratedSkillContent,
  listBundledSkills,
  listCuratedSkills,
  listInstalledSkills,
} from "@/lib/skills-library";
import { MCP_CATALOG } from "@/lib/mcp-catalog";
import { hasToken, readMcpAuth } from "@/lib/mcp-auth";
import { ensureMcpMigrated, isConnected } from "@/lib/mcp-store";
import { getConnectorToolInfo, type RemoteToolSummary } from "@/lib/mcp-discovery";
import { loadAgentDefinitions } from "@/lib/agents";
import { fetchProviders, type ChatCompletionMessage } from "@/lib/llm";
import { getModelCapabilities } from "@/lib/model-capabilities";

export type KnowledgeSourceType =
  | "chat"
  | "file"
  | "image"
  | "skill"
  | "skill_doc"
  | "connector"
  | "memory";

export const ALL_KNOWLEDGE_SOURCE_TYPES: KnowledgeSourceType[] = [
  "chat",
  "file",
  "image",
  "skill",
  "skill_doc",
  "connector",
  "memory",
];

/**
 * Source types indexed regardless of the Knowledge Index settings — every
 * agent discovers skills and connectors through the index out of the box,
 * with no toggles and no explicit discovery calls.
 */
export const ALWAYS_ON_KNOWLEDGE_TYPES: KnowledgeSourceType[] = [
  "skill",
  "skill_doc",
  "connector",
];

/**
 * Map the per-source settings toggles to index source types. Skills and
 * connectors are always included (ALWAYS_ON_KNOWLEDGE_TYPES); the master
 * toggle gates only the user-data types (chats/files/images/memories).
 */
export function enabledKnowledgeSourceTypes(settings: UserSettings): KnowledgeSourceType[] {
  const t = settings.knowledgeSources;
  const types: KnowledgeSourceType[] = [];
  if (settings.knowledgeEnabled) {
    if (t.chats) types.push("chat");
    if (t.files) types.push("file");
    if (t.images) types.push("image");
    if (t.memories) types.push("memory");
  }
  types.push(...ALWAYS_ON_KNOWLEDGE_TYPES);
  return types;
}

// ─── Store client (Tauri commands, see src-tauri/src/lib.rs) ───────────────

interface VecUpsertDoc {
  id: string;
  sourceType: string;
  sourceRef: string;
  sourceTitle: string | null;
  chunkIndex: number;
  text: string;
  contentHash: string;
  extra: string | null;
  embedding: number[];
}

export interface KnowledgeHit {
  id: string;
  sourceType: KnowledgeSourceType;
  sourceRef: string;
  sourceTitle: string | null;
  chunkIndex: number;
  text: string;
  extra: Record<string, unknown> | null;
  distance: number;
}

interface VecSourceState {
  sourceType: string;
  sourceRef: string;
  contentHash: string;
  chunkCount: number;
}

export interface KnowledgeIndexStats {
  totalChunks: number;
  bySource: Record<string, number>;
  embeddingModel: string | null;
  dims: number | null;
}

async function vecInit(embeddingModel: string, dims: number): Promise<{ rebuilt: boolean }> {
  return invoke("vec_init", { embeddingModel, dims });
}

async function vecUpsert(docs: VecUpsertDoc[]): Promise<void> {
  if (docs.length > 0) await invoke("vec_upsert", { docs });
}

async function vecDeleteSources(sourceType: string, sourceRefs: string[]): Promise<void> {
  if (sourceRefs.length > 0) await invoke("vec_delete_sources", { sourceType, sourceRefs });
}

async function vecSearch(
  queryEmbedding: number[],
  limit: number,
  sourceTypes: KnowledgeSourceType[],
  sourceRefs: string[] | null,
  excludeIds: string[] | null,
): Promise<KnowledgeHit[]> {
  const raw = await invoke<
    Array<Omit<KnowledgeHit, "extra"> & { extra: string | null }>
  >("vec_search", {
    queryEmbedding,
    limit,
    sourceTypes,
    sourceRefs,
    excludeIds,
  });
  return raw.map((h) => ({
    ...h,
    sourceType: h.sourceType as KnowledgeSourceType,
    extra: parseExtra(h.extra),
  }));
}

async function vecGetState(sourceType: KnowledgeSourceType): Promise<VecSourceState[]> {
  return invoke("vec_get_state", { sourceType });
}

export async function getKnowledgeIndexStats(): Promise<KnowledgeIndexStats | null> {
  try {
    return await invoke<KnowledgeIndexStats>("vec_stats");
  } catch {
    return null;
  }
}

function parseExtra(extra: string | null): Record<string, unknown> | null {
  if (!extra) return null;
  try {
    return JSON.parse(extra) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Change detection ──────────────────────────────────────────────────────

/** FNV-1a + length — cheap but sufficient change detection for re-embedding. */
export function hashKnowledgeText(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + ":" + input.length.toString(16);
}

export interface RawSourceDoc {
  sourceType: KnowledgeSourceType;
  /** Unique within sourceType (message id, storageId, skill name, …). */
  sourceRef: string;
  sourceTitle: string | null;
  /** One entry per chunk. */
  texts: string[];
  extra?: Record<string, unknown>;
  /** Hash over everything that should trigger a re-embed. */
  hash: string;
}

export interface SourceDiff {
  changed: RawSourceDoc[];
  removedRefs: string[];
}

/**
 * Diff freshly scanned docs against the index state. `unchangedRefs` are refs
 * this sweep skipped (e.g. sessions whose updatedAt didn't move) — they are
 * neither re-embedded nor treated as deleted.
 */
export function diffSourceDocs(
  docs: RawSourceDoc[],
  state: VecSourceState[],
  skippedRefs: Set<string>,
): SourceDiff {
  const stateByRef = new Map(state.map((s) => [s.sourceRef, s]));
  const docHashes = new Map(docs.map((d) => [d.sourceRef, d.hash]));
  const changed: RawSourceDoc[] = [];
  for (const doc of docs) {
    const prev = stateByRef.get(doc.sourceRef);
    if (!prev || prev.contentHash !== doc.hash || prev.chunkCount !== doc.texts.length) {
      changed.push(doc);
    }
  }
  const removedRefs: string[] = [];
  for (const ref of stateByRef.keys()) {
    if (skippedRefs.has(ref)) continue;
    if (!docHashes.has(ref)) removedRefs.push(ref);
  }
  return { changed, removedRefs };
}

// ─── Source scanners ───────────────────────────────────────────────────────

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const SWEEP_STATE_KEY = "chatui:knowledge:sweeps";
const CAPTIONS_KEY = "chatui:knowledge:captions";
const MAX_TEXT_CHARS = 100_000;

interface SweepBookkeeping {
  sessions?: Record<string, string>;
  lastSweepAt?: string;
}

function loadBookkeeping(): SweepBookkeeping {
  return readJson<SweepBookkeeping>(SWEEP_STATE_KEY, {});
}

function saveBookkeeping(state: SweepBookkeeping) {
  try {
    localStorage.setItem(SWEEP_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

interface ChatScan {
  docs: RawSourceDoc[];
  /** attachment/image refs discovered in the scanned sessions */
  storageIds: Array<{ storageId: string; name: string; type: string }>;
  /** sessions scanned this sweep, by id → updatedAt */
  scannedSessions: Record<string, string>;
  /** session ids that no longer exist */
  deletedSessionIds: Set<string>;
}

/**
 * Scan non-temporary sessions into message-level docs. Sessions whose
 * updatedAt matches the last sweep are skipped entirely (their docs stay as
 * indexed) — parsing every message JSON on every sweep would dominate sweep
 * cost for long-time users.
 */
function scanChats(bookkeeping: SweepBookkeeping): ChatScan {
  type StoredSession = { id?: string; title?: string; updatedAt?: string; isTemporary?: boolean };
  const sessions = readJson<StoredSession[]>("chatui:sessions", []).filter(
    (s) => s && typeof s.id === "string" && !s.isTemporary,
  );
  const priorSessions = bookkeeping.sessions ?? {};
  const docs: RawSourceDoc[] = [];
  const storageIds: Array<{ storageId: string; name: string; type: string }> = [];
  const scannedSessions: Record<string, string> = {};
  const currentIds = new Set(sessions.map((s) => s.id as string));

  for (const session of sessions) {
    const id = session.id as string;
    const updatedAt = typeof session.updatedAt === "string" ? session.updatedAt : "";
    if (priorSessions[id] && priorSessions[id] === updatedAt) {
      // Unchanged session: its docs stay as indexed; mark it so the diff
      // neither re-embeds nor deletes its refs.
      scannedSessions[id] = updatedAt;
      continue;
    }
    scannedSessions[id] = updatedAt;
    const messages = readJson<Array<Record<string, unknown>>>(`chatui:messages:${id}`, []);
    for (const m of messages) {
      const role = m.role as string;
      const content = typeof m.content === "string" ? m.content.trim() : "";
      const msgId = typeof m.id === "string" ? m.id : null;
      if (!content || !msgId || (role !== "user" && role !== "assistant")) continue;
      const text = content.slice(0, MAX_TEXT_CHARS);
      docs.push({
        sourceType: "chat",
        sourceRef: `${id}:${msgId}`,
        sourceTitle: (session.title as string) ?? null,
        texts: chunkText(text),
        extra: { role, ts: m.timestamp ?? null, sessionId: id },
        hash: hashKnowledgeText(`${session.title ?? ""}|${role}|${text}`),
      });
      const attachments = Array.isArray(m.attachments) ? m.attachments : [];
      for (const a of attachments as Array<Record<string, unknown>>) {
        if (typeof a.storageId === "string" && typeof a.name === "string") {
          storageIds.push({
            storageId: a.storageId,
            name: a.name,
            type: typeof a.type === "string" ? a.type : "",
          });
        }
      }
    }
  }

  const deleted = new Set(Object.keys(priorSessions).filter((id) => !currentIds.has(id)));
  return {
    docs,
    storageIds,
    scannedSessions,
    deletedSessionIds: deleted,
  };
}

/**
 * Collect file/image refs from projects and saved agents (message
 * attachments come in via scanChats). Refs are deduped by storageId.
 */
function scanProjectAndAgentRefs(): Array<{ storageId: string; name: string; type: string }> {
  const refs = new Map<string, { storageId: string; name: string; type: string }>();
  const add = (storageId: unknown, name: unknown, type: unknown) => {
    if (typeof storageId === "string" && typeof name === "string") {
      if (!refs.has(storageId)) {
        refs.set(storageId, {
          storageId,
          name,
          type: typeof type === "string" ? type : "",
        });
      }
    }
  };
  const projects = readJson<Array<Record<string, unknown>>>("chatui:projects", []);
  for (const p of projects) {
    for (const f of (p.files ?? []) as Array<Record<string, unknown>>) {
      add(f.storageId, f.name, f.type);
    }
    for (const i of (p.images ?? []) as Array<Record<string, unknown>>) {
      add(i.storageId, i.name, "image");
    }
  }
  for (const agent of loadAgentDefinitions()) {
    for (const a of agent.attachments ?? []) {
      add(a.storageId, a.name, a.type);
    }
  }
  return Array.from(refs.values());
}

async function fileDoc(
  ref: { storageId: string; name: string; type: string },
): Promise<RawSourceDoc | null> {
  let text = await getFileText(ref.storageId);
  if (!text) {
    const blob = await getFileBlob(ref.storageId);
    if (!blob) return null;
    text = await extractFileText(new File([blob], ref.name, { type: ref.type || "application/octet-stream" }));
    if (text) void setFileText(ref.storageId, text);
  }
  const clipped = text.slice(0, MAX_TEXT_CHARS);
  if (!clipped.trim()) return null;
  return {
    sourceType: "file",
    sourceRef: ref.storageId,
    sourceTitle: ref.name,
    texts: chunkText(clipped),
    extra: { kind: "file" },
    hash: hashKnowledgeText(`${ref.name}|${clipped}`),
  };
}

// ─── Image captions (caption-then-embed via the active chat model) ─────────

const CAPTIONS_PER_SWEEP = 20;

interface CaptionRecord {
  caption: string;
  /** blob size + name — cheap "the image changed" signal */
  identity: string;
}

function loadCaptions(): Record<string, CaptionRecord> {
  return readJson<Record<string, CaptionRecord>>(CAPTIONS_KEY, {});
}

function saveCaptions(captions: Record<string, CaptionRecord>) {
  try {
    localStorage.setItem(CAPTIONS_KEY, JSON.stringify(captions));
  } catch {
    // ignore
  }
}

async function resolveCaptionModel(): Promise<{ provider: Provider; modelName: string } | null> {
  const modelName = loadUserSettings().defaultModel;
  if (!modelName) return null;
  const providers = await fetchProviders();
  const provider = providers.find((p) => p.models.some((m) => m.name === modelName));
  return provider ? { provider, modelName } : null;
}

async function captionImage(
  provider: Provider,
  modelName: string,
  dataUrl: string,
): Promise<string> {
  const { streamChatCompletion } = await import("@/lib/llm");
  const messages: ChatCompletionMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Describe this image factually in one short paragraph for a search index. Cover the main subject, any readable text, and notable details.",
        },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];
  let out = "";
  for await (const chunk of streamChatCompletion(provider, modelName, messages)) {
    out += chunk.content ?? "";
  }
  return out.trim();
}

/**
 * Produce image docs for refs that already have captions, and caption up to
 * CAPTIONS_PER_SWEEP uncaptioned images per sweep using the user's default
 * (vision-capable) chat model. Images stay unindexed until a caption exists.
 */
async function imageDocs(
  refs: Array<{ storageId: string; name: string; type: string }>,
): Promise<{ docs: RawSourceDoc[]; captionsGenerated: number }> {
  const imageRefs = refs.filter((r) => r.type.startsWith("image/"));
  if (imageRefs.length === 0) return { docs: [], captionsGenerated: 0 };
  const captions = loadCaptions();
  const docs: RawSourceDoc[] = [];
  const model = await resolveCaptionModel();
  const vision =
    model && (await getModelCapabilities(model.provider, model.modelName).catch(() => null));
  let captioned = 0;
  for (const ref of imageRefs) {
    const identity = `${ref.name}:${ref.storageId}`;
    let record = captions[ref.storageId];
    if (record && record.identity === identity) {
      // current caption
    } else if (model && vision?.vision && captioned < CAPTIONS_PER_SWEEP) {
      const blob = await getFileBlob(ref.storageId);
      if (!blob) continue;
      try {
        const file = await normalizeImageFile(new File([blob], ref.name, { type: blob.type || ref.type || "image/png" }));
        const dataUrl = await fileToDataUrl(file);
        const caption = await captionImage(model.provider, model.modelName, dataUrl);
        if (caption) {
          record = { caption, identity };
          captions[ref.storageId] = record;
          captioned += 1;
        }
      } catch {
        // best-effort: retry on the next sweep
        continue;
      }
    } else {
      continue;
    }
    if (!record) continue;
    docs.push({
      sourceType: "image",
      sourceRef: ref.storageId,
      sourceTitle: ref.name,
      texts: [record.caption],
      extra: { kind: "image" },
      hash: hashKnowledgeText(`${ref.name}|${record.caption}`),
    });
  }
  if (captioned > 0) saveCaptions(captions);
  return { docs, captionsGenerated: captioned };
}

async function skillDocs(): Promise<RawSourceDoc[]> {
  const docs: RawSourceDoc[] = [];
  for (const s of listCuratedSkills()) {
    const text = `${s.title}. ${s.description} Category: ${s.category}. Source: ${s.sourceLabel}.`;
    docs.push({
      sourceType: "skill",
      sourceRef: s.name,
      sourceTitle: s.title,
      texts: [text],
      extra: { kind: "catalog" },
      hash: hashKnowledgeText(text),
    });
  }
  for (const s of listBundledSkills()) {
    const text = `${s.description} Source: bundled skill.`;
    docs.push({
      sourceType: "skill",
      sourceRef: s.name,
      sourceTitle: s.name,
      texts: [text],
      extra: { kind: "catalog" },
      hash: hashKnowledgeText(text),
    });
    const content = getBundledSkillContent(s.name);
    if (content) {
      const clipped = content.slice(0, MAX_TEXT_CHARS);
      docs.push({
        sourceType: "skill_doc",
        sourceRef: `bundled:${s.name}`,
        sourceTitle: s.name,
        texts: chunkText(clipped),
        extra: { kind: "bundled" },
        hash: hashKnowledgeText(clipped),
      });
    }
  }
  // Installed skills' SKILL.md bodies (Tauri only; skipped elsewhere).
  let installedNames = new Set<string>();
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const installed = await listInstalledSkills("global");
    installedNames = new Set(installed.map((sk) => sk.name));
    for (const sk of installed) {
      try {
        const md = await invoke<string>("read_text_file", { path: `${sk.path}/SKILL.md` });
        if (!md.trim()) continue;
        const clipped = md.slice(0, MAX_TEXT_CHARS);
        docs.push({
          sourceType: "skill_doc",
          sourceRef: `installed:${sk.name}`,
          sourceTitle: sk.name,
          texts: chunkText(clipped),
          extra: { kind: "installed" },
          hash: hashKnowledgeText(clipped),
        });
      } catch {
        // skill without a readable SKILL.md — skip
      }
    }
  } catch {
    // not running under Tauri
  }
  // Curated skills' full SKILL.md bodies (prefetched by
  // ensureCuratedSkillContent) — full instructions are searchable before any
  // install; an installed skill's on-disk doc is the source of truth.
  for (const s of listCuratedSkills()) {
    if (installedNames.has(s.name)) continue;
    const content = getCuratedSkillContent(s.name);
    if (!content?.trim()) continue;
    const clipped = content.slice(0, MAX_TEXT_CHARS);
    docs.push({
      sourceType: "skill_doc",
      sourceRef: `curated:${s.name}`,
      sourceTitle: s.title,
      texts: chunkText(clipped),
      extra: { kind: "curated" },
      hash: hashKnowledgeText(clipped),
    });
  }
  return docs;
}

/**
 * Connector docs: one summary per catalog entry (with connection state and
 * propose-to-connect guidance baked into the text) plus one doc per tool
 * description fetched from the remote server, so requests match against what
 * each connector can actually do.
 */
async function connectorDocs(): Promise<RawSourceDoc[]> {
  await ensureMcpMigrated();
  const toolInfo = await getConnectorToolInfo().catch(() => ({} as Record<string, RemoteToolSummary[]>));
  const authData = await readMcpAuth().catch(() => ({}));
  const docs: RawSourceDoc[] = [];
  for (const e of MCP_CATALOG) {
    const keywords = e.keywords?.length ? ` Keywords: ${e.keywords.join(", ")}.` : "";
    // OAuth entries need a stored token from the native sign-in, not just a
    // catalog entry, before their tools are really available.
    const connected =
      e.auth === "oauth" ? isConnected(e.id) && hasToken(authData, e.id) : isConnected(e.id);
    const state = connected
      ? "Connected — its mcp__ tools are available to the agent."
      : "Not connected yet.";
    const guidance = connected
      ? ""
      : " If this would help with the user's request, propose connecting it with the suggest tool (kind=connector) — the user can connect and sign in with one click.";
    const summary = `${e.name}. ${e.tagline} Category: ${e.category}. Vendor: ${e.vendor}. Auth: ${e.auth}.${keywords} ${state}${guidance}`;
    docs.push({
      sourceType: "connector",
      sourceRef: e.id,
      sourceTitle: e.name,
      texts: [summary],
      extra: { auth: e.auth, connected },
      hash: hashKnowledgeText(summary),
    });
    const tools = toolInfo[e.id] ?? [];
    for (const tool of tools) {
      const text =
        `${e.name} (${e.category}) — tool "${tool.name}": ${tool.description} ` +
        `Provided by the ${e.name} connector (MCP).${connected ? "" : guidance}`;
      docs.push({
        sourceType: "connector",
        sourceRef: `${e.id}::${tool.name}`,
        sourceTitle: `${e.name} · ${tool.name}`,
        texts: [text],
        extra: { auth: e.auth, connected, connectorId: e.id },
        hash: hashKnowledgeText(text),
      });
    }
  }
  return docs;
}

const MEMORY_GLOBAL_KEY = "chatui:memory:global";
const MEMORY_PROJECT_PREFIX = "chatui:memory:project:";

function memoryDocs(): RawSourceDoc[] {
  interface StoredMemory {
    id?: string;
    text?: string;
  }
  const docs: RawSourceDoc[] = [];
  const push = (scope: string, entries: StoredMemory[]) => {
    for (const e of entries) {
      const text = typeof e.text === "string" ? e.text.trim() : "";
      if (!text || typeof e.id !== "string") continue;
      docs.push({
        sourceType: "memory",
        sourceRef: e.id,
        sourceTitle: null,
        texts: [text],
        extra: { scope },
        hash: hashKnowledgeText(text),
      });
    }
  };
  push("global", readJson<StoredMemory[]>(MEMORY_GLOBAL_KEY, []));
  const projects = readJson<Array<Record<string, unknown>>>("chatui:projects", []);
  for (const p of projects) {
    if (typeof p.id === "string") {
      push(p.id, readJson<StoredMemory[]>(`${MEMORY_PROJECT_PREFIX}${p.id}`, []));
    }
  }
  return docs;
}

// ─── Sweep ─────────────────────────────────────────────────────────────────

export interface KnowledgeSweepResult {
  scannedSources: number;
  upsertedSources: number;
  removedSources: number;
  captionsGenerated: number;
  error?: string;
}

const EMBED_BATCH = 32;
const UPSERT_BATCH_CHUNKS = 128;

async function embedDocs(docs: RawSourceDoc[]): Promise<Map<RawSourceDoc, number[][]>> {
  const flat: Array<{ doc: RawSourceDoc; text: string }> = [];
  for (const doc of docs) {
    for (const text of doc.texts) flat.push({ doc, text });
  }
  const vectors = new Map<RawSourceDoc, number[][]>();
  for (let i = 0; i < flat.length; i += EMBED_BATCH) {
    const slice = flat.slice(i, i + EMBED_BATCH);
    const vecs = await embedForIndex(slice.map((f) => f.text));
    vecs.forEach((vec, j) => {
      const doc = slice[j].doc;
      const list = vectors.get(doc) ?? [];
      list.push(vec);
      vectors.set(doc, list);
    });
  }
  return vectors;
}

/** Build chunk rows grouped per source; a source's rows must reach vec_upsert
 * together (the command replaces a source atomically), so batches flush on
 * source boundaries. */
async function upsertDocs(docs: RawSourceDoc[], vectors: Map<RawSourceDoc, number[][]>): Promise<void> {
  let pending: VecUpsertDoc[] = [];
  let pendingSource: string | null = null;
  const flush = async () => {
    await vecUpsert(pending);
    pending = [];
    pendingSource = null;
  };
  for (const doc of docs) {
    const vecs = vectors.get(doc);
    if (!vecs || vecs.length !== doc.texts.length) continue;
    const sourceKey = `${doc.sourceType}:${doc.sourceRef}`;
    if (pendingSource && pendingSource !== sourceKey && pending.length + doc.texts.length > UPSERT_BATCH_CHUNKS) {
      await flush();
    }
    for (let i = 0; i < doc.texts.length; i++) {
      pending.push({
        id: `${doc.sourceType}:${doc.sourceRef}:${i}`,
        sourceType: doc.sourceType,
        sourceRef: doc.sourceRef,
        sourceTitle: doc.sourceTitle,
        chunkIndex: i,
        text: doc.texts[i],
        contentHash: doc.hash,
        extra: doc.extra ? JSON.stringify(doc.extra) : null,
        embedding: vecs[i],
      });
    }
    pendingSource = sourceKey;
  }
  await flush();
}

let sweepPromise: Promise<KnowledgeSweepResult> | null = null;
let sweepTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * One index sweep: scan → diff → embed only what changed → upsert, and purge
 * source types the user disabled. Single-flight; concurrent calls share the
 * running sweep.
 */
export function runKnowledgeSweep(): Promise<KnowledgeSweepResult> {
  if (sweepPromise) return sweepPromise;
  sweepPromise = doSweep().finally(() => {
    sweepPromise = null;
  });
  return sweepPromise;
}

/** Debounced sweep trigger — coalesces post-run and startup triggers. */
export function scheduleKnowledgeSweep(delayMs = 20_000): void {
  if (sweepTimer) clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    void runKnowledgeSweep().catch(() => {});
  }, delayMs);
}

async function doSweep(): Promise<KnowledgeSweepResult> {
  const result: KnowledgeSweepResult = {
    scannedSources: 0,
    upsertedSources: 0,
    removedSources: 0,
    captionsGenerated: 0,
  };
  try {
    const settings = loadUserSettings();
    // Skills and connectors are always indexed (ALWAYS_ON_KNOWLEDGE_TYPES);
    // the master toggle only gates the user-data types.

    const embedder = getIndexEmbedder();
    // Probe the dims (and warm the endpoint/model) before init: API embedding
    // sizes aren't known until the first response.
    const probe = await embedQueryForIndex("knowledge index warm-up");
    const init = await vecInit(embedder.id, probe.length);

    const bookkeeping = loadBookkeeping();
    if (init.rebuilt) {
      // The index was wiped (model/dims change) — everything must re-embed,
      // including "unchanged" sessions.
      bookkeeping.sessions = {};
    }
    const enabled = new Set(enabledKnowledgeSourceTypes(settings));

    // Purge source types the user disabled.
    for (const type of ALL_KNOWLEDGE_SOURCE_TYPES) {
      if (enabled.has(type)) continue;
      const state = await vecGetState(type);
      if (state.length > 0) {
        await vecDeleteSources(type, state.map((s) => s.sourceRef));
        result.removedSources += state.length;
      }
    }

    // Chats (+ their attachment refs).
    const chatScan = scanChats(bookkeeping);
    const projectAgentRefs = scanProjectAndAgentRefs();
    const allRefs = [...chatScan.storageIds, ...projectAgentRefs];
    const uniqueRefs = new Map(allRefs.map((r) => [r.storageId, r]));

    const docSets = new Map<KnowledgeSourceType, RawSourceDoc[]>();
    const skippedByType = new Map<KnowledgeSourceType, Set<string>>();

    if (enabled.has("chat")) {
      docSets.set("chat", chatScan.docs);
      // Unchanged sessions keep their indexed message refs exactly as-is.
      const priorSessions = bookkeeping.sessions ?? {};
      const unchangedIds = new Set(
        Object.keys(priorSessions).filter(
          (id) =>
            !chatScan.deletedSessionIds.has(id) &&
            chatScan.scannedSessions[id] === priorSessions[id],
        ),
      );
      const skips = new Set<string>();
      if (unchangedIds.size > 0) {
        const chatState = await vecGetState("chat");
        for (const s of chatState) {
          const sessionId = s.sourceRef.slice(0, s.sourceRef.indexOf(":"));
          if (unchangedIds.has(sessionId)) skips.add(s.sourceRef);
        }
      }
      skippedByType.set("chat", skips);
    }

    // Files + images (refs from messages, projects, agents).
    const fileRefs = Array.from(uniqueRefs.values()).filter((r) => !r.type.startsWith("image/"));
    if (enabled.has("file")) {
      const fileDocs: RawSourceDoc[] = [];
      for (const ref of fileRefs) {
        const doc = await fileDoc(ref);
        if (doc) fileDocs.push(doc);
      }
      docSets.set("file", fileDocs);
    }
    if (enabled.has("image")) {
      const imageRefs = Array.from(uniqueRefs.values()).filter((r) => r.type.startsWith("image/"));
      const { docs: imgDocs, captionsGenerated } = await imageDocs(imageRefs);
      result.captionsGenerated = captionsGenerated;
      docSets.set("image", imgDocs);
    }

    if (enabled.has("skill")) {
      const skills = await skillDocs();
      docSets.set(
        "skill",
        skills.filter((d) => d.sourceType === "skill"),
      );
      docSets.set(
        "skill_doc",
        skills.filter((d) => d.sourceType === "skill_doc"),
      );
    }
    if (enabled.has("connector")) docSets.set("connector", await connectorDocs());
    if (enabled.has("memory")) docSets.set("memory", memoryDocs());

    for (const [type, docs] of docSets) {
      const state = await vecGetState(type);
      const diff = diffSourceDocs(docs, state, skippedByType.get(type) ?? new Set());
      result.scannedSources += docs.length;
      result.removedSources += diff.removedRefs.length;
      if (diff.removedRefs.length > 0) {
        await vecDeleteSources(type, diff.removedRefs);
      }
      if (diff.changed.length === 0) continue;
      const vectors = await embedDocs(diff.changed);
      await upsertDocs(diff.changed, vectors);
      result.upsertedSources += diff.changed.length;
    }

    bookkeeping.sessions = chatScan.scannedSessions;
    bookkeeping.lastSweepAt = new Date().toISOString();
    saveBookkeeping(bookkeeping);
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

/** Manual "Rebuild index": wipe everything and sweep from scratch. */
export async function rebuildKnowledgeIndex(): Promise<KnowledgeSweepResult> {
  if (sweepPromise) await sweepPromise.catch(() => {});
  try {
    localStorage.removeItem(SWEEP_STATE_KEY);
  } catch {
    // ignore
  }
  await invoke("vec_clear");
  return runKnowledgeSweep();
}

// ─── Search ────────────────────────────────────────────────────────────────

export interface KnowledgeSearchOptions {
  limit?: number;
  sourceTypes?: KnowledgeSourceType[];
  sourceRefs?: string[];
  excludeIds?: string[];
}

/**
 * Semantic search over the persistent index. Returns [] when the index is
 * empty or unavailable (non-Tauri, endpoint down, dims mismatch) — callers
 * treat it as "no knowledge", never an error. With the Knowledge Index
 * master toggle off, only the always-on types (skills, connectors) are
 * searched.
 */
export async function searchKnowledgeIndex(
  query: string,
  opts: KnowledgeSearchOptions = {},
): Promise<KnowledgeHit[]> {
  if (!query.trim()) return [];
  const settings = loadUserSettings();
  const requested = opts.sourceTypes ?? enabledKnowledgeSourceTypes(settings);
  const types = requested.filter(
    (t) => settings.knowledgeEnabled || ALWAYS_ON_KNOWLEDGE_TYPES.includes(t),
  );
  if (types.length === 0) return [];
  try {
    const vec = await embedQueryForIndex(query);
    return await vecSearch(vec, opts.limit ?? 5, types, opts.sourceRefs ?? null, opts.excludeIds ?? null);
  } catch (err) {
    console.warn("[knowledge] index search failed:", err);
    return [];
  }
}

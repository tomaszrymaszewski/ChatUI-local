import type { ActivityItem, SharedFile } from "@/lib/agent/types";

/**
 * One contributor to the session files widget: files the agent shared for
 * download (verified to exist at share time) plus tool-activity file traces
 * (write_local_file results — unverified claims about paths the model typed).
 */
export interface SessionFileSource {
  shares: SharedFile[];
  activities: ActivityItem[];
}

/**
 * Merges every contributor into the files-widget list.
 *
 * - Same path merges into one row; a later entry with a known size wins.
 * - Same name on different paths collapses: share-verified entries win over
 *   activity traces. write_local_file records the raw path the model typed
 *   (~/…, ./…), so before path normalization it routinely described the very
 *   file share_files later shared — showing both meant the same file twice,
 *   with the stale trace often stuck at 0 bytes. A trace with no same-named
 *   share is still the only record of an unshared file, so it is kept.
 */
export function mergeSessionFiles(sources: SessionFileSource[]): SharedFile[] {
  const byPath = new Map<string, SharedFile>();
  const add = (f: SharedFile) => {
    const prev = byPath.get(f.path);
    byPath.set(f.path, prev ? { ...prev, ...f, size: f.size ?? prev.size } : f);
  };
  for (const s of sources) for (const f of s.shares) add(f);
  const sharedPathsByName = new Map<string, Set<string>>();
  for (const f of byPath.values()) {
    let set = sharedPathsByName.get(f.name);
    if (!set) sharedPathsByName.set(f.name, (set = new Set()));
    set.add(f.path);
  }
  const fromActivities = (acts: ActivityItem[]) => {
    for (const a of acts) {
      if (!a.file || a.status === "error") continue;
      const knownPaths = sharedPathsByName.get(a.file.name);
      if (knownPaths && !knownPaths.has(a.file.path)) continue;
      const shared: SharedFile = { path: a.file.path, name: a.file.name };
      if (a.file.bytes !== undefined) shared.size = a.file.bytes;
      add(shared);
    }
  };
  for (const s of sources) fromActivities(s.activities);
  return Array.from(byPath.values());
}

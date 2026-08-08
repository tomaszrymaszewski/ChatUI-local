export interface RegistryServer {
  id: string;
  title: string;
  description: string;
  remoteUrl?: string;
  packageName?: string;
  packageRegistry?: string;
}

interface RegistryResponse {
  servers: Array<{
    server: {
      name?: string;
      title?: string;
      description?: string;
      remotes?: Array<{ type: string; url: string }>;
      packages?: Array<{ name: string; registry: string }>;
    };
  }>;
  metadata?: { count: number; nextCursor?: string };
}

export async function searchMcpRegistry(query: string): Promise<RegistryServer[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetch(
      `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(query)}&limit=30`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as RegistryResponse;
    return data.servers.map((s) => ({
      id: s.server.name ?? s.server.title ?? "unknown",
      title: s.server.title ?? s.server.name ?? "unknown",
      description: s.server.description ?? "",
      remoteUrl: s.server.remotes?.[0]?.url,
      packageName: s.server.packages?.[0]?.name,
      packageRegistry: s.server.packages?.[0]?.registry,
    }));
  } catch {
    return [];
  }
}

import { useEffect, useState, useCallback } from "react";
import type { Provider, ProviderModel } from "@/types";
import {
  fetchProviders,
  createProvider as createProviderRPC,
  updateProvider as updateProviderRPC,
  deleteProvider as deleteProviderRPC,
} from "@/lib/llm";

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const data = await fetchProviders();
      setProviders(data);
    } catch (err) {
      console.error("Error fetching providers:", err);
    }
    setLoading(false);
  }, []);

  const createProvider = useCallback(
    async (
      name: string,
      baseUrl: string,
      apiKey: string,
      models: ProviderModel[]
    ) => {
      await createProviderRPC(name, baseUrl, apiKey, models);
      await loadProviders();
    },
    [loadProviders]
  );

  const updateProvider = useCallback(
    async (
      providerId: string,
      name: string,
      baseUrl: string,
      apiKey: string,
      models: ProviderModel[]
    ) => {
      await updateProviderRPC(providerId, name, baseUrl, apiKey, models);
      await loadProviders();
    },
    [loadProviders]
  );

  const deleteProvider = useCallback(
    async (providerId: string) => {
      await deleteProviderRPC(providerId);
      await loadProviders();
    },
    [loadProviders]
  );

  return {
    providers,
    loading,
    createProvider,
    updateProvider,
    deleteProvider,
    refetch: loadProviders,
  };
}

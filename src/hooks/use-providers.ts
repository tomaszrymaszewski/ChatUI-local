import { useEffect, useState, useCallback } from "react";
import type { Provider, ProviderModel } from "@/types";
import {
  fetchProviders,
  createProvider as createProviderRPC,
  updateProvider as updateProviderRPC,
  deleteProvider as deleteProviderRPC,
  addModelToProvider as addModelRPC,
  removeModelFromProvider as removeModelRPC,
  updateModelDisplayName as updateDisplayNameRPC,
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
      models: ProviderModel[],
      builtinKey?: string,
    ) => {
      await createProviderRPC(name, baseUrl, apiKey, models, builtinKey);
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
      models: ProviderModel[],
      builtinKey?: string,
    ) => {
      await updateProviderRPC(providerId, name, baseUrl, apiKey, models, builtinKey);
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

  const addModel = useCallback(
    async (providerId: string, model: ProviderModel) => {
      await addModelRPC(providerId, model);
      await loadProviders();
    },
    [loadProviders]
  );

  const removeModel = useCallback(
    async (providerId: string, modelId: string) => {
      await removeModelRPC(providerId, modelId);
      await loadProviders();
    },
    [loadProviders]
  );

  const updateModelDisplayName = useCallback(
    async (providerId: string, modelId: string, displayName: string) => {
      await updateDisplayNameRPC(providerId, modelId, displayName);
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
    addModel,
    removeModel,
    updateModelDisplayName,
    refetch: loadProviders,
  };
}

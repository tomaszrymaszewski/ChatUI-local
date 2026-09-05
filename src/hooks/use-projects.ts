import { useEffect, useRef, useState, useCallback } from "react";
import type { Project, ProjectFile, ProjectImage } from "@/types";
import { extractFileText } from "@/lib/files";
import { getFileBlob, putFileBlob, deleteFileBlob } from "@/lib/attachment-store";

const STORAGE_KEY = "chatui:projects";

interface StoredProject {
  id: string;
  name: string;
  description: string;
  instructions: string;
  files: ProjectFile[];
  images: ProjectImage[];
}

function loadProjects(): StoredProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredProject[];
  } catch {
    return [];
  }
}

function saveProjects(projects: StoredProject[]) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      // Blob URLs are runtime-only — never persist them.
      projects.map((p) => ({
        ...p,
        images: p.images.map(({ url: _url, ...img }) => img),
      })),
    ),
  );
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const hydratedImgIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    setProjects(loadProjects());
    setLoading(false);
  }, []);

  // Rehydrate image previews (blob URLs) from the persistent file store —
  // they die on reload, so previews are rebuilt from the stored bytes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const project of projects) {
        for (const img of project.images) {
          if (img.url || !img.storageId || hydratedImgIds.current.has(img.id)) continue;
          hydratedImgIds.current.add(img.id);
          const blob = await getFileBlob(img.storageId);
          if (cancelled || !blob) continue;
          const url = URL.createObjectURL(blob);
          setProjects((prev) =>
            prev.map((p) =>
              p.id === project.id
                ? { ...p, images: p.images.map((i) => (i.id === img.id ? { ...i, url } : i)) }
                : p,
            ),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const createProject = useCallback(
    async (name: string, description: string, instructions: string) => {
      const project: StoredProject = {
        id: crypto.randomUUID(),
        name,
        description,
        instructions,
        files: [],
        images: [],
      };
      setProjects((prev) => {
        const next = [project, ...prev];
        saveProjects(next);
        return next;
      });
      return project;
    },
    [],
  );

  const updateProject = useCallback(
    async (id: string, updates: { name?: string; description?: string; instructions?: string; directory?: string | null }) => {
      setProjects((prev) => {
        const next = prev.map((p) => (p.id === id ? { ...p, ...updates } : p));
        saveProjects(next);
        return next;
      });
    },
    [],
  );

  const deleteProject = useCallback(async (id: string) => {
    setProjects((prev) => {
      const target = prev.find((p) => p.id === id);
      // Clean up the project's stored file bytes.
      if (target) {
        for (const f of target.files) void deleteFileBlob(f.id);
        for (const img of target.images) {
          if (img.url) URL.revokeObjectURL(img.url);
          void deleteFileBlob(img.id);
        }
      }
      const next = prev.filter((p) => p.id !== id);
      saveProjects(next);
      return next;
    });
  }, []);

  const addProjectFile = useCallback(
    async (projectId: string, file: File) => {
      const fileId = crypto.randomUUID();
      const newFile: ProjectFile = {
        id: fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        storageId: fileId,
      };
      // Persist the bytes + eagerly extracted text so every conversation in
      // the project can use the file, across restarts.
      void extractFileText(file)
        .then((text) => putFileBlob(fileId, file, { extractedText: text }))
        .catch(() => {});
      setProjects((prev) => {
        const next = prev.map((p) =>
          p.id === projectId ? { ...p, files: [...p.files, newFile] } : p,
        );
        saveProjects(next);
        return next;
      });
    },
    [],
  );

  const deleteProjectFile = useCallback(
    async (projectId: string, fileId: string) => {
      void deleteFileBlob(fileId);
      setProjects((prev) => {
        const next = prev.map((p) =>
          p.id === projectId
            ? { ...p, files: p.files.filter((f) => f.id !== fileId) }
            : p,
        );
        saveProjects(next);
        return next;
      });
    },
    [],
  );

  const addProjectImage = useCallback(
    async (projectId: string, file: File) => {
      const fileId = crypto.randomUUID();
      const url = URL.createObjectURL(file);
      void putFileBlob(fileId, file);
      const newImage: ProjectImage = { id: fileId, name: file.name, url, storageId: fileId };
      setProjects((prev) => {
        const next = prev.map((p) =>
          p.id === projectId ? { ...p, images: [...p.images, newImage] } : p,
        );
        saveProjects(next);
        return next;
      });
    },
    [],
  );

  const deleteProjectImage = useCallback(
    async (projectId: string, imageId: string) => {
      void deleteFileBlob(imageId);
      setProjects((prev) => {
        const next = prev.map((p) =>
          p.id === projectId
            ? { ...p, images: p.images.filter((i) => i.id !== imageId) }
            : p,
        );
        saveProjects(next);
        return next;
      });
    },
    [],
  );

  const refetch = useCallback(() => {
    setProjects(loadProjects());
  }, []);

  return {
    projects,
    loading,
    createProject,
    updateProject,
    deleteProject,
    addProjectFile,
    deleteProjectFile,
    addProjectImage,
    deleteProjectImage,
    refetch,
  };
}

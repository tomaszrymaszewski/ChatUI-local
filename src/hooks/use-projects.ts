import { useEffect, useState, useCallback } from "react";
import type { Project, ProjectFile, ProjectImage } from "@/types";

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setProjects(loadProjects());
    setLoading(false);
  }, []);

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
      const next = prev.filter((p) => p.id !== id);
      saveProjects(next);
      return next;
    });
  }, []);

  const addProjectFile = useCallback(
    async (projectId: string, file: File) => {
      const fileId = crypto.randomUUID();
      const newFile: ProjectFile = { id: fileId, name: file.name, size: file.size, type: file.type };
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
      const newImage: ProjectImage = { id: fileId, name: file.name, url };
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

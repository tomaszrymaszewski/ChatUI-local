import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Project, ProjectFile, ProjectImage } from "@/types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = useCallback(async () => {
    const [{ data: projectData, error: projectError }, { data: fileData }, { data: imageData }] =
      await Promise.all([
        supabase.from("projects").select("id, name, description, instructions").order("created_at", { ascending: false }),
        supabase.from("project_files").select("id, project_id, name, size, type"),
        supabase.from("project_images").select("id, project_id, name, url"),
      ]);

    if (projectError) {
      console.error("Error fetching projects:", projectError);
      setLoading(false);
      return;
    }

    const files = fileData ?? [];
    const images = imageData ?? [];

    setProjects(
      (projectData ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        instructions: p.instructions,
        files: files
          .filter((f) => f.project_id === p.id)
          .map((f) => ({ id: f.id, name: f.name, size: f.size, type: f.type })),
        images: images
          .filter((i) => i.project_id === p.id)
          .map((i) => ({ id: i.id, name: i.name, url: i.url })),
      })),
    );
    setLoading(false);
  }, []);

  const createProject = useCallback(
    async (name: string, description: string, instructions: string) => {
      const { data, error } = await supabase
        .from("projects")
        .insert({ name, description, instructions })
        .select("id, name, description, instructions")
        .single();

      if (error) throw error;

      const project: Project = {
        id: data.id,
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        files: [],
        images: [],
      };
      setProjects((prev) => [project, ...prev]);
      return project;
    },
    [],
  );

  const updateProject = useCallback(
    async (id: string, updates: { name?: string; description?: string; instructions?: string }) => {
      const { error } = await supabase.from("projects").update(updates).eq("id", id);
      if (error) throw error;

      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      );
    },
    [],
  );

  const deleteProject = useCallback(async (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) {
      fetchProjects();
      throw error;
    }
  }, [fetchProjects]);

  const addProjectFile = useCallback(
    async (projectId: string, file: File) => {
      const fileId = crypto.randomUUID();
      const { error } = await supabase.from("project_files").insert({
        id: fileId,
        project_id: projectId,
        name: file.name,
        size: file.size,
        type: file.type,
      });
      if (error) throw error;

      const newFile: ProjectFile = { id: fileId, name: file.name, size: file.size, type: file.type };
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, files: [...p.files, newFile] } : p,
        ),
      );
    },
    [],
  );

  const deleteProjectFile = useCallback(
    async (projectId: string, fileId: string) => {
      const { error } = await supabase.from("project_files").delete().eq("id", fileId);
      if (error) throw error;

      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, files: p.files.filter((f) => f.id !== fileId) }
            : p,
        ),
      );
    },
    [],
  );

  const addProjectImage = useCallback(
    async (projectId: string, file: File) => {
      const fileId = crypto.randomUUID();
      const { error: uploadError } = await supabase.storage
        .from("project-images")
        .upload(`${projectId}/${fileId}`, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("project-images")
        .getPublicUrl(`${projectId}/${fileId}`);

      const { error } = await supabase.from("project_images").insert({
        id: fileId,
        project_id: projectId,
        name: file.name,
        url: urlData.publicUrl,
      });
      if (error) throw error;

      const newImage: ProjectImage = { id: fileId, name: file.name, url: urlData.publicUrl };
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, images: [...p.images, newImage] } : p,
        ),
      );
    },
    [],
  );

  const deleteProjectImage = useCallback(
    async (projectId: string, imageId: string) => {
      await supabase.storage
        .from("project-images")
        .remove([`${projectId}/${imageId}`]);

      const { error } = await supabase.from("project_images").delete().eq("id", imageId);
      if (error) throw error;

      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, images: p.images.filter((i) => i.id !== imageId) }
            : p,
        ),
      );
    },
    [],
  );

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
    refetch: fetchProjects,
  };
}

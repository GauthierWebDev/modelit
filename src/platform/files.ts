import { FILE_EXTENSION } from "@core/index";
import { isTauri } from "@tauri-apps/api/core";
import type { FileAccess, FileFilter, OpenedFile } from "@/app/fileAccess";

/**
 * Accès aux fichiers, isolé ici pour que le reste de l'application ignore la plateforme.
 * - Tauri : dialogues natifs et système de fichiers.
 * - Navigateur (`pnpm dev` sans Tauri) : sélecteur de fichier et téléchargement.
 */

/** Filtre des dialogues natifs ; `name` est le libellé traduit (« Modèle »). */
const filters = (name: string) => [{ name, extensions: [FILE_EXTENSION] }];

async function openModelFile(filterName: string): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, directory: false, filters: filters(filterName) });
    if (typeof path !== "string") {
      return null;
    }
    return { path, content: await readTextFile(path) };
  }
  return browserPickFile(`.${FILE_EXTENSION},application/json`);
}

/** Ouvre un fichier texte quelconque (ex. script SQL pour la rétroconception). */
async function openTextFile(filter: FileFilter): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, directory: false, filters: [filter] });
    if (typeof path !== "string") {
      return null;
    }
    return { path, content: await readTextFile(path) };
  }
  return browserPickFile(filter.extensions.map((e) => `.${e}`).join(","));
}

/**
 * Enregistre `content`. Sans `path` (ou pour « Enregistrer sous »), demande un emplacement.
 * Renvoie le chemin utilisé, ou `null` si l'utilisateur a annulé.
 */
async function saveModelFile(
  content: string,
  path: string | null,
  suggestedName: string,
  filterName: string,
): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const target = path ?? (await save({ defaultPath: suggestedName, filters: filters(filterName) }));
    if (!target) {
      return null;
    }
    await writeTextFile(target, content);
    return target;
  }
  const name = path ?? suggestedName;
  browserDownload(name, content);
  return name;
}

/**
 * Enregistre un fichier exporté (image, script…) : dialogue natif sous Tauri,
 * téléchargement dans le navigateur. Renvoie le chemin, ou `null` si annulé.
 */
async function saveExportFile(data: Blob, suggestedName: string, filter: FileFilter): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const target = await save({ defaultPath: suggestedName, filters: [filter] });
    if (!target) {
      return null;
    }
    await writeFile(target, new Uint8Array(await data.arrayBuffer()));
    return target;
  }
  const url = URL.createObjectURL(data);
  const a = Object.assign(document.createElement("a"), { href: url, download: suggestedName });
  a.click();
  URL.revokeObjectURL(url);
  return suggestedName;
}

function browserPickFile(accept: string): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { path: file.name, content: await file.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function browserDownload(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Modèle désigné par son chemin : autorisé pour la session par la coquille (`allow_model_file`, qui n'accepte que
 * les `.mcd`), puis lu ; lecture et enregistrement passent ensuite par le plugin fs comme après un dialogue.
 */
async function readModelFile(path: string): Promise<OpenedFile | null> {
  if (!isTauri()) {
    throw new Error("paths cannot be read in a browser");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
  await invoke("allow_model_file", { path });
  if (!(await exists(path))) {
    return null;
  }
  return { path, content: await readTextFile(path) };
}

/** Adaptateur du port `FileAccess` (`app/fileAccess.ts`). */
export const platformFiles: FileAccess = {
  openModel: openModelFile,
  openText: openTextFile,
  saveModel: saveModelFile,
  saveExport: saveExportFile,
  readModel: readModelFile,
  readsPaths: isTauri(),
};

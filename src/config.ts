import * as vscode from 'vscode';

export type ViewStyle = 'tree' | 'webview';

const SECTION = 'taskExplorer';

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

/** Render style — global (application) scope. */
export function getViewStyle(): ViewStyle {
  return cfg().get<ViewStyle>('viewStyle', 'tree');
}

export async function setViewStyle(style: ViewStyle): Promise<void> {
  await cfg().update('viewStyle', style, vscode.ConfigurationTarget.Global);
}

/** When true, clicking a task opens its definition instead of showing output. */
export function getOpenDefinitionOnClick(): boolean {
  return cfg().get<boolean>('openDefinitionOnClick', true);
}

export async function setOpenDefinitionOnClick(on: boolean): Promise<void> {
  await cfg().update('openDefinitionOnClick', on, vscode.ConfigurationTarget.Global);
}

/** Hidden category sources — workspace scope (current folder). */
export function getHiddenCategories(): string[] {
  return cfg().get<string[]>('hiddenCategories', []);
}

/** Hidden task ids (see taskId) — workspace scope. */
export function getHiddenTasks(): string[] {
  return cfg().get<string[]>('hiddenTasks', []);
}

export function isCategoryHidden(source: string): boolean {
  return getHiddenCategories().includes(source);
}

export function isTaskHidden(id: string): boolean {
  return getHiddenTasks().includes(id);
}

export async function setCategoryHidden(source: string, hidden: boolean): Promise<void> {
  await toggleInList('hiddenCategories', source, hidden);
}

export async function setTaskHidden(id: string, hidden: boolean): Promise<void> {
  await toggleInList('hiddenTasks', id, hidden);
}

/** Favorited task ids — workspace scope (current folder). */
export function getFavorites(): string[] {
  return cfg().get<string[]>('favorites', []);
}

export function isFavorite(id: string): boolean {
  return getFavorites().includes(id);
}

export async function setFavorite(id: string, fav: boolean): Promise<void> {
  await toggleInList('favorites', id, fav);
}

async function toggleInList(key: string, value: string, present: boolean): Promise<void> {
  const current = cfg().get<string[]>(key, []);
  const set = new Set(current);
  if (present) {
    set.add(value);
  } else {
    set.delete(value);
  }
  // Persist to the workspace so visibility is per-folder.
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await cfg().update(key, [...set], target);
}

/** True when a change event touches any taskExplorer setting. */
export function affectsConfig(e: vscode.ConfigurationChangeEvent): boolean {
  return e.affectsConfiguration(SECTION);
}

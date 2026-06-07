import * as vscode from 'vscode';

/** One script file found in the workspace. */
export interface ScriptFile {
  uri: vscode.Uri;
  name: string;
  /** Workspace-relative path, used for stable ids and tooltips. */
  relPath: string;
}

/** A folder in a category's tree. The category root is a folder with name ''. */
export interface ScriptFolderNode {
  name: string;
  /** Workspace-relative folder path ('' for the category root). */
  path: string;
  folders: ScriptFolderNode[];
  files: ScriptFile[];
}

/** A script type (PowerShell, Shell, …) with its file tree. */
export interface ScriptCategory {
  id: string;
  label: string;
  /** ThemeIcon id for the category row (tree view). */
  icon: string;
  /** ThemeColor id used to tint the category icon. */
  color: string;
  root: ScriptFolderNode;
  count: number;
}

interface CategoryDef {
  id: string;
  label: string;
  icon: string;
  color: string;
  exts: string[];
}

/** Script categories, in display order. Extensions are matched case-insensitively. */
const CATEGORIES: CategoryDef[] = [
  { id: 'powershell', label: 'PowerShell', icon: 'terminal-powershell', color: 'charts.blue', exts: ['ps1', 'psm1', 'psd1'] },
  { id: 'shell', label: 'Shell', icon: 'terminal-bash', color: 'charts.green', exts: ['sh', 'bash', 'zsh', 'ksh'] },
  { id: 'batch', label: 'Batch', icon: 'terminal-cmd', color: 'charts.yellow', exts: ['bat', 'cmd'] },
];

const EXT_TO_CATEGORY = new Map<string, CategoryDef>();
for (const c of CATEGORIES) {
  for (const e of c.exts) {
    EXT_TO_CATEGORY.set(e, c);
  }
}

const DEFAULT_EXCLUDE =
  '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/.venv/**,**/venv/**}';

/**
 * Scan the workspace for script files and group them by type, each as a nested
 * folder tree. Returns only non-empty categories, in CATEGORIES order.
 */
export async function scanScripts(maxResults = 2000): Promise<ScriptCategory[]> {
  if (!vscode.workspace.workspaceFolders?.length) {
    return [];
  }

  const allExts = [...EXT_TO_CATEGORY.keys()].join(',');
  const include = `**/*.{${allExts}}`;
  const uris = await vscode.workspace.findFiles(include, DEFAULT_EXCLUDE, maxResults);

  // One root folder node per category, created lazily.
  const roots = new Map<string, { def: CategoryDef; root: ScriptFolderNode; count: number }>();

  for (const uri of uris) {
    const ext = extOf(uri.path);
    const def = ext && EXT_TO_CATEGORY.get(ext);
    if (!def) {
      continue;
    }
    const relPath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    const segments = relPath.split('/');
    const fileName = segments.pop()!;

    let entry = roots.get(def.id);
    if (!entry) {
      entry = { def, root: { name: '', path: '', folders: [], files: [] }, count: 0 };
      roots.set(def.id, entry);
    }
    entry.count++;

    // Walk/create the folder chain, then drop the file at the leaf.
    let node = entry.root;
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let child = node.folders.find((f) => f.name === seg);
      if (!child) {
        child = { name: seg, path: acc, folders: [], files: [] };
        node.folders.push(child);
      }
      node = child;
    }
    node.files.push({ uri, name: fileName, relPath });
  }

  const result: ScriptCategory[] = [];
  for (const def of CATEGORIES) {
    const entry = roots.get(def.id);
    if (!entry) {
      continue;
    }
    sortFolder(entry.root);
    result.push({
      id: def.id,
      label: def.label,
      icon: def.icon,
      color: def.color,
      root: entry.root,
      count: entry.count,
    });
  }
  return result;
}

/** Lowercase extension without the dot, or undefined when there is none. */
function extOf(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (dot <= slash) {
    return undefined;
  }
  return path.slice(dot + 1).toLowerCase();
}

/** Sort folders before files, each alphabetically; recurse. */
function sortFolder(node: ScriptFolderNode): void {
  node.folders.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));
  for (const f of node.folders) {
    sortFolder(f);
  }
}

/** Glob covering every scanned script extension (for FileSystemWatcher). */
export function scriptWatchGlob(): string {
  return `**/*.{${[...EXT_TO_CATEGORY.keys()].join(',')}}`;
}

/** All script files across categories, flattened and sorted by relative path. */
export function flattenScripts(categories: ScriptCategory[]): ScriptFile[] {
  const out: ScriptFile[] = [];
  const walk = (n: ScriptFolderNode) => {
    out.push(...n.files);
    n.folders.forEach(walk);
  };
  categories.forEach((c) => walk(c.root));
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

/** vscode.Task definition type used for scripts run from the explorer. */
export const SCRIPT_TASK_TYPE = 'taskExplorerScript';

/**
 * Build a Task that runs a script file with the right interpreter for its type.
 * The definition carries `scriptUri` so task start/end events map back to the row.
 */
export function buildScriptTask(uri: vscode.Uri): vscode.Task {
  const ext = extOf(uri.path) ?? '';
  // Run from the script's own directory and reference it by name, so no
  // absolute path (backslashes on Windows mangle bash) is passed to the shell.
  const cwd = vscode.Uri.joinPath(uri, '..').fsPath;
  const fileName = uri.path.split('/').pop() ?? uri.fsPath;
  const isWin = process.platform === 'win32';
  // Strong-quote the script name so spaces survive shell parsing.
  const quoted = (s: string) => ({ value: s, quoting: vscode.ShellQuoting.Strong });

  // ShellExecution (not ProcessExecution): the interpreter is resolved via the
  // shell's PATH. ProcessExecution would join the command with cwd and look for
  // e.g. "<cwd>\bash", which doesn't exist.
  let exec: vscode.ShellExecution;
  if (['ps1', 'psm1', 'psd1'].includes(ext)) {
    const pwsh = isWin ? 'powershell' : 'pwsh';
    exec = new vscode.ShellExecution(
      pwsh,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', quoted(`./${fileName}`)],
      { cwd }
    );
  } else if (['bat', 'cmd'].includes(ext)) {
    exec = new vscode.ShellExecution('cmd', ['/c', quoted(fileName)], { cwd });
  } else {
    // sh / bash / zsh / ksh — match the shell to the extension where sensible.
    const shell = ext === 'sh' ? 'bash' : ext;
    exec = new vscode.ShellExecution(shell, [quoted(fileName)], { cwd });
  }

  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const name = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
  const task = new vscode.Task(
    { type: SCRIPT_TASK_TYPE, scriptUri: uri.toString() },
    folder ?? vscode.TaskScope.Workspace,
    name,
    'Workspace Scripts',
    exec
  );
  return task;
}

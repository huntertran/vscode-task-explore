import * as vscode from 'vscode';
import { TaskExplorerProvider, taskId } from './taskProvider';
import {
  isCategoryHidden,
  isTaskHidden,
  isFavorite,
  setFavorite,
  getShowWorkspaceScripts,
  isScriptCategoryHidden,
  SCRIPTS_SOURCE,
} from './config';
import { loadWebviewHtml } from './webviewHtml';
import { ScriptCategory, ScriptFolderNode } from './scriptScanner';

/** Serializable view model for one task row in the webview. */
interface TaskVM {
  id: string;
  name: string;
  detail: string;
  source: string;
  running: boolean;
  favorite: boolean;
  /** epoch ms when the task started; only set when running. */
  startedAt?: number;
}

interface GroupVM {
  source: string;
  label: string;
  tasks: TaskVM[];
}

interface ScriptFileVM {
  id: string;
  name: string;
  relPath: string;
  running: boolean;
  startedAt?: number;
}

/** Serializable folder node for the scripts tree. */
interface ScriptFolderVM {
  name: string;
  path: string;
  folders: ScriptFolderVM[];
  files: ScriptFileVM[];
}

interface ScriptCategoryVM {
  id: string;
  label: string;
  icon: string;
  /** CSS color for the category icon, e.g. var(--vscode-charts-blue). */
  color: string;
  count: number;
  tree: ScriptFolderVM;
}

/** The whole "Workspace Scripts" section; null when empty/disabled. */
interface ScriptsVM {
  label: string;
  categories: ScriptCategoryVM[];
}

/** Total files in a folder VM subtree. */
function countFiles(node: ScriptFolderVM): number {
  return node.files.length + node.folders.reduce((n, f) => n + countFiles(f), 0);
}

/**
 * Richer webview rendering of the task list. Reads running state from the
 * shared TaskExplorerProvider so both views stay in sync, and re-renders on
 * its change event. Elapsed time ticks locally in the webview from startedAt.
 */
export class WebviewTaskProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'taskExplorer.tasksWebview';

  private view: vscode.WebviewView | undefined;
  /** id -> Task, rebuilt on each render so messages can resolve a Task. */
  private taskById = new Map<string, vscode.Task>();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: TaskExplorerProvider
  ) {
    // Re-post state whenever running state / tasks change.
    this.disposables.push(
      this.store.onDidChangeTreeData(() => void this.postState())
    );
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = await loadWebviewHtml(
      webviewView.webview,
      this.extensionUri,
      'webview'
    );

    webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg), undefined, this.disposables);
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.postState();
      }
    }, undefined, this.disposables);

    void this.postState();
  }

  private async onMessage(msg: { type: string; id?: string; fav?: boolean }): Promise<void> {
    if (msg.type === 'ready' || msg.type === 'refresh') {
      this.store.refresh();
      await this.postState();
      return;
    }
    if (msg.id && (msg.type === 'openScript' || msg.type === 'runScript' || msg.type === 'stopScript')) {
      const uri = vscode.Uri.parse(msg.id);
      if (msg.type === 'openScript') {
        await vscode.commands.executeCommand('vscode.open', uri);
      } else {
        await vscode.commands.executeCommand(`taskExplorer.${msg.type}`, { uri });
      }
      return;
    }
    const task = msg.id ? this.taskById.get(msg.id) : undefined;
    if (!task) {
      return;
    }
    // Reuse the same commands the tree view uses; they only read item.task.
    const item = { task } as unknown as Parameters<typeof vscode.commands.executeCommand>[1];
    switch (msg.type) {
      case 'toggleFavorite':
        await setFavorite(taskId(task), !!msg.fav);
        break;
      case 'rowClick':
        await vscode.commands.executeCommand('taskExplorer.itemClick', item);
        break;
      case 'run':
        await vscode.commands.executeCommand('taskExplorer.runTask', item);
        break;
      case 'stop':
        await vscode.commands.executeCommand('taskExplorer.stopTask', item);
        break;
      case 'showOutput':
        await vscode.commands.executeCommand('taskExplorer.showOutput', item);
        break;
    }
  }

  private toVM(t: vscode.Task, source: string): TaskVM {
    const running = this.store.getRunning(t);
    return {
      id: taskId(t),
      name: t.name,
      detail: t.detail ?? '',
      source,
      running: !!running,
      favorite: isFavorite(taskId(t)),
      startedAt: running?.startedAt,
    };
  }

  private async buildGroups(): Promise<GroupVM[]> {
    const tasks = await vscode.tasks.fetchTasks();
    this.taskById = new Map(tasks.map((t) => [taskId(t), t]));

    const sources = [...new Set(tasks.map((t) => t.source))]
      .filter((s) => !isCategoryHidden(s));
    sources.sort((a, b) => {
      if (a === 'Workspace') return -1;
      if (b === 'Workspace') return 1;
      return a.localeCompare(b);
    });

    const groups: GroupVM[] = sources.map((source) => ({
      source,
      label: source === 'Workspace' ? 'VSCode Tasks' : source,
      tasks: tasks
        .filter((t) => t.source === source && !isTaskHidden(taskId(t)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => this.toVM(t, source)),
    }));

    // Favorites pinned at the top (shown regardless of category/task hiding).
    const favs = tasks
      .filter((t) => isFavorite(taskId(t)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => this.toVM(t, '__fav__'));
    if (favs.length) {
      groups.unshift({ source: '__fav__', label: 'Favorites', tasks: favs });
    }

    return groups;
  }

  /** Build a folder VM, dropping hidden scripts and folders left empty. */
  private folderToVM(node: ScriptFolderNode): ScriptFolderVM {
    return {
      name: node.name,
      path: node.path,
      folders: node.folders
        .map((f) => this.folderToVM(f))
        .filter((v) => v.folders.length || v.files.length),
      files: node.files
        .filter((f) => !isTaskHidden(f.uri.toString()))
        .map((f) => {
          const running = this.store.getScriptRunning(f.uri);
          return {
            id: f.uri.toString(),
            name: f.name,
            relPath: f.relPath,
            running: !!running,
            startedAt: running?.startedAt,
          };
        }),
    };
  }

  private buildScripts(): ScriptsVM | null {
    if (!getShowWorkspaceScripts() || isCategoryHidden(SCRIPTS_SOURCE)) {
      return null;
    }
    // Trigger scan if idle; no-op when deferred or already running.
    this.store.ensureScanStarted();
    const allCategories = this.store.getScriptCategoriesIfReady();
    if (!allCategories) {
      return null; // scan deferred, in-progress, or not yet started
    }
    const categories = allCategories.filter((c) => !isScriptCategoryHidden(c.id));
    const vms = categories
      .map((c) => {
        const tree = this.folderToVM(c.root);
        // 'charts.blue' -> 'var(--vscode-charts-blue)'
        const color = `var(--vscode-${c.color.replace(/\./g, '-')})`;
        return { id: c.id, label: c.label, icon: c.icon, color, count: countFiles(tree), tree };
      })
      .filter((c) => c.count > 0);
    if (!vms.length) {
      return null;
    }
    return { label: SCRIPTS_SOURCE, categories: vms };
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }
    const [groups] = await Promise.all([this.buildGroups()]);
    const scripts = this.buildScripts();
    void this.view.webview.postMessage({ type: 'state', groups, scripts });
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

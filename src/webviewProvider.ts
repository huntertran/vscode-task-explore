import * as vscode from 'vscode';
import { TaskExplorerProvider, taskId } from './taskProvider';
import { isCategoryHidden, isTaskHidden, isFavorite, setFavorite } from './config';
import { loadWebviewHtml } from './webviewHtml';

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

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }
    const groups = await this.buildGroups();
    void this.view.webview.postMessage({ type: 'state', groups });
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

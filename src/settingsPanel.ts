import * as vscode from 'vscode';
import { taskId } from './taskProvider';
import { loadWebviewHtml } from './webviewHtml';
import {
  getViewStyle,
  setViewStyle,
  getHiddenCategories,
  getHiddenTasks,
  setCategoryHidden,
  setTaskHidden,
  getOpenDefinitionOnClick,
  setOpenDefinitionOnClick,
  getFavorites,
  setFavorite,
  affectsConfig,
  ViewStyle,
} from './config';

interface TaskRow {
  id: string;
  name: string;
  hidden: boolean;
  favorite: boolean;
}
interface CategoryRow {
  source: string;
  label: string;
  hidden: boolean;
  tasks: TaskRow[];
}
interface SettingsState {
  viewStyle: ViewStyle;
  openDefinitionOnClick: boolean;
  categories: CategoryRow[];
}

/** Singleton settings webview panel. */
export class SettingsPanel {
  private static current: SettingsPanel | undefined;
  public static readonly viewType = 'taskExplorer.settings';

  static show(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal(column);
      void SettingsPanel.current.post();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'Task Explorer Settings',
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] }
    );
    SettingsPanel.current = new SettingsPanel(panel, extensionUri);
  }

  private disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri
  ) {
    void loadWebviewHtml(panel.webview, extensionUri, 'settings').then((html) => {
      panel.webview.html = html;
    });
    panel.webview.onDidReceiveMessage((m) => this.onMessage(m), undefined, this.disposables);
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    // Reflect external config edits live.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (affectsConfig(e)) {
          void this.post();
        }
      })
    );
  }

  private async onMessage(msg: { type: string; style?: ViewStyle; source?: string; id?: string; hidden?: boolean; on?: boolean; fav?: boolean }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.post();
        break;
      case 'setViewStyle':
        if (msg.style) {
          await setViewStyle(msg.style);
        }
        break;
      case 'setOpenDefinitionOnClick':
        await setOpenDefinitionOnClick(!!msg.on);
        break;
      case 'setCategory':
        if (msg.source !== undefined) {
          await setCategoryHidden(msg.source, !!msg.hidden);
        }
        break;
      case 'setTask':
        if (msg.id !== undefined) {
          await setTaskHidden(msg.id, !!msg.hidden);
        }
        break;
      case 'setFavorite':
        if (msg.id !== undefined) {
          await setFavorite(msg.id, !!msg.fav);
        }
        break;
    }
  }

  private async buildState(): Promise<SettingsState> {
    const tasks = await vscode.tasks.fetchTasks();
    const hiddenCats = new Set(getHiddenCategories());
    const hiddenTasks = new Set(getHiddenTasks());
    const favorites = new Set(getFavorites());

    const sources = [...new Set(tasks.map((t) => t.source))];
    sources.sort((a, b) => {
      if (a === 'Workspace') return -1;
      if (b === 'Workspace') return 1;
      return a.localeCompare(b);
    });

    const categories: CategoryRow[] = sources.map((source) => ({
      source,
      label: source === 'Workspace' ? 'VSCode Tasks' : source,
      hidden: hiddenCats.has(source),
      tasks: tasks
        .filter((t) => t.source === source)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t): TaskRow => ({
          id: taskId(t),
          name: t.name,
          hidden: hiddenTasks.has(taskId(t)),
          favorite: favorites.has(taskId(t)),
        })),
    }));

    return {
      viewStyle: getViewStyle(),
      openDefinitionOnClick: getOpenDefinitionOnClick(),
      categories,
    };
  }

  private async post(): Promise<void> {
    const state = await this.buildState();
    void this.panel.webview.postMessage({ type: 'state', state });
  }

  dispose(): void {
    SettingsPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

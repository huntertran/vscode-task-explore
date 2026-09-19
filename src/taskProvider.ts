import * as vscode from 'vscode';
import { isCategoryHidden, isTaskHidden, isFavorite, getShowWorkspaceScripts, isScriptCategoryHidden, SCRIPTS_SOURCE } from './config';
import { scanScripts, ScriptCategory, ScriptFolderNode, ScriptFile } from './scriptScanner';

/** Stable identity for a task across fetch / start / end events. */
export function taskId(task: vscode.Task): string {
  return `${task.source}::${task.name}::${task.definition.type}`;
}

interface RunningInfo {
  execution: vscode.TaskExecution;
  startedAt: number;
}

type ScriptScanState = 'deferred' | 'idle' | 'scanning' | 'done';

type Node =
  | SourceGroupItem
  | FavoritesGroupItem
  | TaskItem
  | ScriptsRootItem
  | ScriptScanningItem
  | ScriptCategoryItem
  | ScriptFolderItem
  | ScriptFileItem;

export class SourceGroupItem extends vscode.TreeItem {
  constructor(public readonly source: string) {
    super(
      source === 'Workspace' ? 'VSCode Tasks' : source,
      vscode.TreeItemCollapsibleState.Expanded
    );
    this.contextValue = 'sourceGroup';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class FavoritesGroupItem extends vscode.TreeItem {
  constructor() {
    super('Favorites', vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'favoritesGroup';
    this.iconPath = new vscode.ThemeIcon('star-full');
  }
}

/** Top-level "Workspace Scripts" group, sibling of the task source groups. */
export class ScriptsRootItem extends vscode.TreeItem {
  constructor() {
    super(SCRIPTS_SOURCE, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'scriptsRoot';
    this.iconPath = new vscode.ThemeIcon('file-code');
  }
}

/** Placeholder shown while the workspace script scan is pending or in progress. */
class ScriptScanningItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'scriptScanning';
  }
}

/** A script type (PowerShell, Shell, …) under Workspace Scripts. */
export class ScriptCategoryItem extends vscode.TreeItem {
  constructor(public readonly category: ScriptCategory, count = category.count) {
    super(category.label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `script-cat:${category.id}`;
    this.contextValue = 'scriptCategory';
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon(category.icon, new vscode.ThemeColor(category.color));
  }
}

/** True when a folder subtree has any non-hidden script. */
function folderHasVisibleScript(node: ScriptFolderNode): boolean {
  return (
    node.files.some((f) => !isTaskHidden(f.uri.toString())) ||
    node.folders.some(folderHasVisibleScript)
  );
}

/** Count of non-hidden scripts in a folder subtree. */
function visibleScriptCount(node: ScriptFolderNode): number {
  let n = node.files.reduce((acc, f) => acc + (isTaskHidden(f.uri.toString()) ? 0 : 1), 0);
  for (const f of node.folders) {
    n += visibleScriptCount(f);
  }
  return n;
}

/** A folder within a script category's tree. */
export class ScriptFolderItem extends vscode.TreeItem {
  constructor(
    public readonly node: ScriptFolderNode,
    public readonly categoryId: string
  ) {
    super(node.name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `script-dir:${categoryId}:${node.path}`;
    this.contextValue = 'scriptFolder';
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

/** A single script file; clicking opens it, inline buttons run/stop it. */
export class ScriptFileItem extends vscode.TreeItem {
  private readonly startedAt?: number;

  constructor(
    public readonly file: ScriptFile,
    categoryId: string,
    /** epoch ms when the run started; undefined when idle. */
    startedAt?: number,
    /** ThemeColor id of the owning category, used to tint the file icon. */
    color?: string
  ) {
    super(file.name, vscode.TreeItemCollapsibleState.None);
    this.id = `script-file:${categoryId}:${file.relPath}`;
    this.resourceUri = file.uri;
    this.tooltip = file.relPath;
    this.command = {
      command: 'vscode.open',
      title: 'Open Script',
      arguments: [file.uri],
    };
    if (startedAt !== undefined) {
      this.startedAt = startedAt;
      this.contextValue = 'scriptFileRunning';
      this.description = formatElapsed(Date.now() - startedAt);
      this.iconPath = new vscode.ThemeIcon('debug-stop', new vscode.ThemeColor('charts.red'));
    } else {
      this.contextValue = 'scriptFile';
      // Explicit code-file icon (tinted by type) instead of the file-icon theme,
      // which often leaves script extensions as a blank page.
      this.iconPath = new vscode.ThemeIcon(
        'file-code',
        color ? new vscode.ThemeColor(color) : undefined
      );
    }
  }

  /** True while running; updates the elapsed description in place. */
  tickElapsed(): boolean {
    if (this.startedAt === undefined) {
      return false;
    }
    this.description = formatElapsed(Date.now() - this.startedAt);
    return true;
  }
}

export class TaskItem extends vscode.TreeItem {
  private readonly startedAt?: number;

  constructor(
    public readonly task: vscode.Task,
    running: RunningInfo | undefined,
    favorite = false,
    /** Distinguishes the copy shown in the Favorites group (tree ids must be unique). */
    idPrefix = ''
  ) {
    super(task.name, vscode.TreeItemCollapsibleState.None);
    this.id = idPrefix + taskId(task);
    this.command = {
      command: 'taskExplorer.itemClick',
      title: 'Open',
      arguments: [this],
    };
    const favSuffix = favorite ? 'Fav' : '';
    if (running) {
      this.startedAt = running.startedAt;
      this.contextValue = 'taskRunning' + favSuffix;
      this.description = formatElapsed(Date.now() - running.startedAt);
      this.iconPath = new vscode.ThemeIcon(
        'debug-stop',
        new vscode.ThemeColor('charts.red')
      );
      this.tooltip = `${task.name} — running`;
    } else {
      this.contextValue = 'task' + favSuffix;
      this.description = task.detail;
      this.iconPath = new vscode.ThemeIcon(
        'play',
        new vscode.ThemeColor('charts.green')
      );
      this.tooltip = task.detail ?? task.name;
    }
  }

  /** True while running; updates the elapsed description in place. */
  tickElapsed(): boolean {
    if (this.startedAt === undefined) {
      return false;
    }
    this.description = formatElapsed(Date.now() - this.startedAt);
    return true;
  }
}

/** Format milliseconds as mm:ss or h:mm:ss. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export class TaskExplorerProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Fires with the new running count (tasks + scripts) whenever it changes. */
  private _onDidChangeRunningCount = new vscode.EventEmitter<number>();
  readonly onDidChangeRunningCount = this._onDidChangeRunningCount.event;

  private running = new Map<string, RunningInfo>();
  private tickTimer: NodeJS.Timeout | undefined;
  /**
   * Rendered TaskItems per taskId, so ticks update every copy (a task can appear
   * in both the Favorites group and its source group). Keyed by taskId.
   */
  private items = new Map<string, TaskItem[]>();

  /**
   * Task list cache — populated on first fetch, reused on subsequent renders.
   * Stale-while-revalidate: subsequent getChildren calls return this immediately
   * and kick off a background re-fetch; only re-render when tasks actually change.
   */
  private cachedTasks: vscode.Task[] = [];
  private taskCachePopulated = false;
  private taskCacheDirty = false;
  private taskFetchInFlight = false;

  /** Script tree cached after scan completes; children navigation reads from it. */
  private scriptCategories: ScriptCategory[] = [];
  private scriptScanState: ScriptScanState = 'idle';
  private scanGen = 0;
  /** The live ScriptsRootItem so targeted refresh can update just its children. */
  private cachedScriptsRoot: ScriptsRootItem | undefined;
  /** Running scripts keyed by uri.toString(). */
  private runningScripts = new Map<string, { execution: vscode.TaskExecution; startedAt: number }>();
  /** Rendered running ScriptFileItems per uri, so ticks update the live copy. */
  private scriptItems = new Map<string, ScriptFileItem[]>();

  private trackScriptItem(item: ScriptFileItem, key: string): ScriptFileItem {
    const list = this.scriptItems.get(key);
    if (list) {
      list.push(item);
    } else {
      this.scriptItems.set(key, [item]);
    }
    return item;
  }

  /**
   * Folder children: subfolders first, then files (each pre-sorted by scanner).
   * Hidden scripts (uri in hiddenTasks) are dropped, as are folders left empty.
   */
  private scriptChildren(node: ScriptFolderNode, categoryId: string): Node[] {
    const color = this.scriptCategories.find((c) => c.id === categoryId)?.color;
    return [
      ...node.folders
        .filter((f) => folderHasVisibleScript(f))
        .map((f) => new ScriptFolderItem(f, categoryId)),
      ...node.files
        .filter((f) => !isTaskHidden(f.uri.toString()))
        .map((f) => {
          const key = f.uri.toString();
          const item = new ScriptFileItem(f, categoryId, this.runningScripts.get(key)?.startedAt, color);
          return this.runningScripts.has(key) ? this.trackScriptItem(item, key) : item;
        }),
    ];
  }

  /** Non-hidden categories with at least one non-hidden script, with visible count. */
  private visibleScriptCategories(): { category: ScriptCategory; count: number }[] {
    return this.scriptCategories
      .filter((category) => !isScriptCategoryHidden(category.id))
      .map((category) => ({ category, count: visibleScriptCount(category.root) }))
      .filter((c) => c.count > 0);
  }

  private trackItem(item: TaskItem, id: string): TaskItem {
    const list = this.items.get(id);
    if (list) {
      list.push(item);
    } else {
      this.items.set(id, [item]);
    }
    return item;
  }

  refresh(): void {
    this.taskCacheDirty = true;
    if (this.scriptScanState !== 'deferred') {
      this.scriptScanState = 'idle';
      this.scanGen++;
    }
    this._onDidChangeTreeData.fire();
  }

  deferScriptScan(): void {
    this.scriptScanState = 'deferred';
  }

  enableScriptScan(): void {
    this.scriptScanState = 'idle';
    if (this.cachedScriptsRoot) {
      this._onDidChangeTreeData.fire(this.cachedScriptsRoot);
    } else {
      this._onDidChangeTreeData.fire();
    }
  }

  /** Start scan if idle (no-op if deferred, scanning, or done). */
  ensureScanStarted(): void {
    if (this.scriptScanState === 'idle') {
      void this._runScan();
    }
  }

  /**
   * Returns cached categories once scan is complete, null while pending.
   * Lets the webview share the tree's scan cache without re-scanning.
   */
  getScriptCategoriesIfReady(): ScriptCategory[] | null {
    return this.scriptScanState === 'done' ? this.scriptCategories : null;
  }

  private _taskSignature(tasks: vscode.Task[]): string {
    return tasks.map((t) => taskId(t)).sort().join('\0');
  }

  private async _backgroundFetchTasks(): Promise<void> {
    if (this.taskFetchInFlight) {
      return; // already in-flight
    }
    this.taskFetchInFlight = true;
    try {
      const tasks = await vscode.tasks.fetchTasks();
      const changed = this._taskSignature(tasks) !== this._taskSignature(this.cachedTasks);
      this.cachedTasks = tasks;
      this.taskCacheDirty = false;
      if (changed) {
        this._onDidChangeTreeData.fire();
      }
    } finally {
      this.taskFetchInFlight = false;
    }
  }

  private async _runScan(): Promise<void> {
    const gen = ++this.scanGen;
    this.scriptScanState = 'scanning';
    const categories = await scanScripts();
    if (gen !== this.scanGen) {
      return; // superseded by a newer scan request
    }
    this.scriptCategories = categories;
    this.scriptScanState = 'done';
    // Targeted refresh is more efficient (avoids re-fetching tasks).
    // Fall back to full refresh when: no cached root (webview-only mode)
    // or no scripts found (need to remove ScriptsRootItem from root).
    if (this.cachedScriptsRoot && categories.length > 0) {
      this._onDidChangeTreeData.fire(this.cachedScriptsRoot);
    } else {
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      // Root rebuild: reset the per-id item tracking.
      this.items.clear();
      this.scriptItems.clear();

      if (!this.taskCachePopulated) {
        // Cold start: must await — no cache to serve yet.
        this.cachedTasks = await vscode.tasks.fetchTasks();
        this.taskCachePopulated = true;
        this.taskCacheDirty = false;
      } else if (this.taskCacheDirty) {
        // Stale-while-revalidate: serve cached tasks immediately, re-fetch in background.
        void this._backgroundFetchTasks();
      }
      const tasks = this.cachedTasks;
      const hasFavorites = tasks.some((t) => isFavorite(taskId(t)));
      const sources = [...new Set(tasks.map((t) => t.source))]
        .filter((s) => !isCategoryHidden(s));
      sources.sort((a, b) => {
        // Workspace (tasks.json) first, then alphabetical.
        if (a === 'Workspace') return -1;
        if (b === 'Workspace') return 1;
        return a.localeCompare(b);
      });
      const groups: Node[] = sources.map((s) => new SourceGroupItem(s));

      this.cachedScriptsRoot = undefined;
      if (getShowWorkspaceScripts() && !isCategoryHidden(SCRIPTS_SOURCE)) {
        // Show ScriptsRootItem unless scan is done and found nothing.
        if (this.scriptScanState !== 'done' || this.visibleScriptCategories().length > 0) {
          const root = new ScriptsRootItem();
          this.cachedScriptsRoot = root;
          groups.push(root);
        }
      } else {
        // Scripts disabled — reset so a rescan runs when re-enabled.
        if (this.scriptScanState !== 'deferred') {
          this.scriptScanState = 'idle';
          this.scanGen++;
        }
        this.scriptCategories = [];
      }

      // Favorites pinned at the very top.
      return hasFavorites ? [new FavoritesGroupItem(), ...groups] : groups;
    }

    if (element instanceof ScriptsRootItem) {
      if (this.scriptScanState === 'deferred') {
        return [new ScriptScanningItem('Scan delayed…')];
      }
      if (this.scriptScanState === 'idle') {
        void this._runScan();
        return [new ScriptScanningItem('Scanning scripts…')];
      }
      if (this.scriptScanState === 'scanning') {
        return [new ScriptScanningItem('Scanning scripts…')];
      }
      return this.visibleScriptCategories().map(
        ({ category, count }) => new ScriptCategoryItem(category, count)
      );
    }

    if (element instanceof ScriptCategoryItem) {
      return this.scriptChildren(element.category.root, element.category.id);
    }

    if (element instanceof ScriptFolderItem) {
      return this.scriptChildren(element.node, element.categoryId);
    }

    if (element instanceof FavoritesGroupItem) {
      return this.cachedTasks
        .filter((t) => isFavorite(taskId(t)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => {
          const id = taskId(t);
          return this.trackItem(
            new TaskItem(t, this.running.get(id), true, 'fav:'),
            id
          );
        });
    }

    if (element instanceof SourceGroupItem) {
      return this.cachedTasks
        .filter((t) => t.source === element.source && !isTaskHidden(taskId(t)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => {
          const id = taskId(t);
          return this.trackItem(
            new TaskItem(t, this.running.get(id), isFavorite(id)),
            id
          );
        });
    }

    return [];
  }

  // --- running state -------------------------------------------------------

  /** Number of tasks and workspace scripts currently running. */
  get runningCount(): number {
    return this.running.size + this.runningScripts.size;
  }

  /** Fire onDidChangeRunningCount only when the count actually moved. */
  private notifyRunningCount(previous: number): void {
    const current = this.runningCount;
    if (current !== previous) {
      this._onDidChangeRunningCount.fire(current);
    }
  }

  isRunning(task: vscode.Task): boolean {
    return this.running.has(taskId(task));
  }

  getRunning(task: vscode.Task): RunningInfo | undefined {
    return this.running.get(taskId(task));
  }

  markStarted(execution: vscode.TaskExecution): void {
    const before = this.runningCount;
    const id = taskId(execution.task);
    if (!this.running.has(id)) {
      this.running.set(id, { execution, startedAt: Date.now() });
    } else {
      // Keep original startedAt but ensure execution handle is current.
      this.running.get(id)!.execution = execution;
    }
    this.ensureTicking();
    this.notifyRunningCount(before);
    this.refresh();
  }

  markEnded(execution: vscode.TaskExecution): void {
    const before = this.runningCount;
    this.running.delete(taskId(execution.task));
    this.ensureTicking();
    this.notifyRunningCount(before);
    this.refresh();
  }

  // --- running scripts -----------------------------------------------------

  isScriptRunning(uri: vscode.Uri): boolean {
    return this.runningScripts.has(uri.toString());
  }

  getScriptRunning(uri: vscode.Uri): { execution: vscode.TaskExecution; startedAt: number } | undefined {
    return this.runningScripts.get(uri.toString());
  }

  markScriptStarted(uri: vscode.Uri, execution: vscode.TaskExecution): void {
    const before = this.runningCount;
    const key = uri.toString();
    if (!this.runningScripts.has(key)) {
      this.runningScripts.set(key, { execution, startedAt: Date.now() });
    } else {
      this.runningScripts.get(key)!.execution = execution;
    }
    this.ensureTicking();
    this.notifyRunningCount(before);
    this.refresh();
  }

  markScriptEnded(uri: vscode.Uri): void {
    const before = this.runningCount;
    this.runningScripts.delete(uri.toString());
    this.ensureTicking();
    this.notifyRunningCount(before);
    this.refresh();
  }

  private ensureTicking(): void {
    const active = this.running.size > 0 || this.runningScripts.size > 0;
    if (active && !this.tickTimer) {
      this.tickTimer = setInterval(() => this.tickElapsed(), 1000);
    } else if (!active && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
  }

  /**
   * Update only the running task nodes' elapsed time. Firing the change event
   * with specific elements re-runs getTreeItem (sync) but NOT getChildren, so
   * the tree doesn't show a loading indicator each second.
   */
  private tickElapsed(): void {
    for (const id of this.running.keys()) {
      const list = this.items.get(id);
      if (!list) {
        continue;
      }
      for (const item of list) {
        if (item.tickElapsed()) {
          this._onDidChangeTreeData.fire(item);
        }
      }
    }
    for (const key of this.runningScripts.keys()) {
      const list = this.scriptItems.get(key);
      if (!list) {
        continue;
      }
      for (const item of list) {
        if (item.tickElapsed()) {
          this._onDidChangeTreeData.fire(item);
        }
      }
    }
  }

  dispose(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
    this._onDidChangeTreeData.dispose();
    this._onDidChangeRunningCount.dispose();
  }
}

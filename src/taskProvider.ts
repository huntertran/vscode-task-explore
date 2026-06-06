import * as vscode from 'vscode';
import { isCategoryHidden, isTaskHidden, isFavorite } from './config';

/** Stable identity for a task across fetch / start / end events. */
export function taskId(task: vscode.Task): string {
  return `${task.source}::${task.name}::${task.definition.type}`;
}

interface RunningInfo {
  execution: vscode.TaskExecution;
  startedAt: number;
}

type Node = SourceGroupItem | FavoritesGroupItem | TaskItem;

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

  private running = new Map<string, RunningInfo>();
  private tickTimer: NodeJS.Timeout | undefined;
  /**
   * Rendered TaskItems per taskId, so ticks update every copy (a task can appear
   * in both the Favorites group and its source group). Keyed by taskId.
   */
  private items = new Map<string, TaskItem[]>();

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
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      // Root rebuild: reset the per-id item tracking.
      this.items.clear();
      const tasks = await vscode.tasks.fetchTasks();
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
      // Favorites pinned at the very top.
      return hasFavorites ? [new FavoritesGroupItem(), ...groups] : groups;
    }

    if (element instanceof FavoritesGroupItem) {
      const tasks = await vscode.tasks.fetchTasks();
      return tasks
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
      const tasks = await vscode.tasks.fetchTasks();
      return tasks
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

  isRunning(task: vscode.Task): boolean {
    return this.running.has(taskId(task));
  }

  getRunning(task: vscode.Task): RunningInfo | undefined {
    return this.running.get(taskId(task));
  }

  markStarted(execution: vscode.TaskExecution): void {
    const id = taskId(execution.task);
    if (!this.running.has(id)) {
      this.running.set(id, { execution, startedAt: Date.now() });
    } else {
      // Keep original startedAt but ensure execution handle is current.
      this.running.get(id)!.execution = execution;
    }
    this.ensureTicking();
    this.refresh();
  }

  markEnded(execution: vscode.TaskExecution): void {
    this.running.delete(taskId(execution.task));
    this.ensureTicking();
    this.refresh();
  }

  private ensureTicking(): void {
    if (this.running.size > 0 && !this.tickTimer) {
      this.tickTimer = setInterval(() => this.tickElapsed(), 1000);
    } else if (this.running.size === 0 && this.tickTimer) {
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
  }

  dispose(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
    this._onDidChangeTreeData.dispose();
  }
}

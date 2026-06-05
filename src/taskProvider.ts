import * as vscode from 'vscode';

/** Stable identity for a task across fetch / start / end events. */
export function taskId(task: vscode.Task): string {
  return `${task.source}::${task.name}::${task.definition.type}`;
}

interface RunningInfo {
  execution: vscode.TaskExecution;
  startedAt: number;
}

type Node = SourceGroupItem | TaskItem;

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

export class TaskItem extends vscode.TreeItem {
  constructor(
    public readonly task: vscode.Task,
    running: RunningInfo | undefined
  ) {
    super(task.name, vscode.TreeItemCollapsibleState.None);
    this.id = taskId(task);
    if (running) {
      this.contextValue = 'taskRunning';
      this.description = formatElapsed(Date.now() - running.startedAt);
      this.iconPath = new vscode.ThemeIcon(
        'debug-stop',
        new vscode.ThemeColor('charts.red')
      );
      this.tooltip = `${task.name} — running`;
    } else {
      this.contextValue = 'task';
      this.description = task.detail;
      this.iconPath = new vscode.ThemeIcon(
        'play',
        new vscode.ThemeColor('charts.green')
      );
      this.tooltip = task.detail ?? task.name;
    }
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

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      const tasks = await vscode.tasks.fetchTasks();
      const sources = [...new Set(tasks.map((t) => t.source))];
      sources.sort((a, b) => {
        // Workspace (tasks.json) first, then alphabetical.
        if (a === 'Workspace') return -1;
        if (b === 'Workspace') return 1;
        return a.localeCompare(b);
      });
      return sources.map((s) => new SourceGroupItem(s));
    }

    if (element instanceof SourceGroupItem) {
      const tasks = await vscode.tasks.fetchTasks();
      return tasks
        .filter((t) => t.source === element.source)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => new TaskItem(t, this.running.get(taskId(t))));
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
      this.tickTimer = setInterval(() => this.refresh(), 1000);
    } else if (this.running.size === 0 && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
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

import * as vscode from 'vscode';
import { TaskExplorerProvider, TaskItem } from './taskProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new TaskExplorerProvider();

  const treeView = vscode.window.createTreeView('taskExplorer.tasksView', {
    treeDataProvider: provider,
  });

  context.subscriptions.push(
    treeView,
    provider,

    vscode.commands.registerCommand('taskExplorer.refresh', () => provider.refresh()),

    vscode.commands.registerCommand('taskExplorer.runTask', async (item?: TaskItem) => {
      if (!item) {
        return;
      }
      try {
        const execution = await vscode.tasks.executeTask(item.task);
        // Seed running state immediately for instant UI feedback;
        // onDidStartTask is an idempotent backup for tasks started elsewhere.
        provider.markStarted(execution);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to run task "${item.task.name}": ${err}`);
      }
    }),

    vscode.commands.registerCommand('taskExplorer.stopTask', (item?: TaskItem) => {
      if (!item) {
        return;
      }
      const info = provider.getRunning(item.task);
      if (info) {
        info.execution.terminate();
      }
    }),

    vscode.commands.registerCommand('taskExplorer.showOutput', async (item?: TaskItem) => {
      if (!item) {
        return;
      }
      const name = item.task.name;
      // VSCode names task terminals after the task (often "Task - <name>").
      const term = vscode.window.terminals.find(
        (t) => t.name === name || t.name.includes(name)
      );
      if (term) {
        term.show();
      } else {
        await vscode.commands.executeCommand('workbench.action.terminal.focus');
      }
    }),

    // Keep running state in sync with the real task lifecycle.
    vscode.tasks.onDidStartTask((e) => provider.markStarted(e.execution)),
    vscode.tasks.onDidEndTask((e) => provider.markEnded(e.execution)),

    // Re-fetch when tasks change (e.g. tasks.json edited).
    vscode.tasks.onDidStartTaskProcess(() => provider.refresh())
  );

  // Exposed for integration tests.
  return { provider };
}

export function deactivate() {
  // Provider disposed via context.subscriptions.
}

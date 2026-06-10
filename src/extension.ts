import * as vscode from 'vscode';
import { TaskExplorerProvider, TaskItem } from './taskProvider';
import { WebviewTaskProvider } from './webviewProvider';
import { SettingsPanel } from './settingsPanel';
import { affectsConfig, getOpenDefinitionOnClick, setFavorite, getScriptScanDelay } from './config';
import { taskId } from './taskProvider';
import { scriptWatchGlob, buildScriptTask, SCRIPT_TASK_TYPE } from './scriptScanner';

export function activate(context: vscode.ExtensionContext) {
  const provider = new TaskExplorerProvider();

  const treeView = vscode.window.createTreeView('taskExplorer.tasksView', {
    treeDataProvider: provider,
  });

  // Webview alternative; only the view matching taskExplorer.viewStyle is shown
  // (gated by `when` clauses in package.json), but both providers are registered.
  const webviewProvider = new WebviewTaskProvider(context.extensionUri, provider);

  // Delayed script scan: defer until after the configured delay so large repos
  // don't block the sidebar on first open.
  const scanDelay = getScriptScanDelay();
  if (scanDelay > 0) {
    provider.deferScriptScan();
    setTimeout(() => provider.enableScriptScan(), scanDelay);
  }

  // Keep the Workspace Scripts tree current as script files are added/removed/renamed.
  const scriptWatcher = vscode.workspace.createFileSystemWatcher(scriptWatchGlob());
  const onScriptChange = () => provider.refresh();
  scriptWatcher.onDidCreate(onScriptChange);
  scriptWatcher.onDidDelete(onScriptChange);

  context.subscriptions.push(
    scriptWatcher,
    treeView,
    provider,
    webviewProvider,

    vscode.window.registerWebviewViewProvider(
      WebviewTaskProvider.viewId,
      webviewProvider
    ),

    vscode.commands.registerCommand('taskExplorer.refresh', () => provider.refresh()),

    vscode.commands.registerCommand('taskExplorer.openSettings', () =>
      SettingsPanel.show(context.extensionUri)
    ),

    vscode.commands.registerCommand('taskExplorer.addFavorite', async (item?: { task: vscode.Task }) => {
      if (item?.task) {
        await setFavorite(taskId(item.task), true);
      }
    }),

    vscode.commands.registerCommand('taskExplorer.removeFavorite', async (item?: { task: vscode.Task }) => {
      if (item?.task) {
        await setFavorite(taskId(item.task), false);
      }
    }),

    // Hidden category/task lists changed -> re-render both views.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (affectsConfig(e)) {
        provider.refresh();
      }
    }),

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

    // Single-click on a task row. Behavior depends on the setting.
    vscode.commands.registerCommand('taskExplorer.itemClick', async (item?: { task: vscode.Task }) => {
      if (!item?.task) {
        return;
      }
      if (getOpenDefinitionOnClick()) {
        await openTaskDefinition(item.task);
      } else {
        await vscode.commands.executeCommand('taskExplorer.showOutput', item);
      }
    }),

    vscode.commands.registerCommand('taskExplorer.goToDefinition', async (item?: { task: vscode.Task }) => {
      if (item?.task) {
        await openTaskDefinition(item.task);
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

    vscode.commands.registerCommand('taskExplorer.runScript', async (item?: ScriptArg) => {
      const uri = scriptUriOf(item);
      if (!uri) {
        return;
      }
      try {
        const execution = await vscode.tasks.executeTask(buildScriptTask(uri));
        provider.markScriptStarted(uri, execution);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to run script "${uri.fsPath}": ${err}`);
      }
    }),

    vscode.commands.registerCommand('taskExplorer.stopScript', (item?: ScriptArg) => {
      const uri = scriptUriOf(item);
      if (uri) {
        provider.getScriptRunning(uri)?.execution.terminate();
      }
    }),

    // Keep running state in sync with the real task lifecycle. Script tasks
    // (run from the explorer) carry their uri in the definition.
    vscode.tasks.onDidStartTask((e) => {
      const uri = scriptTaskUri(e.execution.task);
      if (uri) {
        provider.markScriptStarted(uri, e.execution);
      } else {
        provider.markStarted(e.execution);
      }
    }),
    vscode.tasks.onDidEndTask((e) => {
      const uri = scriptTaskUri(e.execution.task);
      if (uri) {
        provider.markScriptEnded(uri);
      } else {
        provider.markEnded(e.execution);
      }
    }),

    // Re-fetch when tasks change (e.g. tasks.json edited).
    vscode.tasks.onDidStartTaskProcess(() => provider.refresh())
  );

  // On first install, open the settings page once so users discover the options.
  const WELCOMED_KEY = 'taskExplorer.welcomed';
  if (!context.globalState.get<boolean>(WELCOMED_KEY)) {
    void context.globalState.update(WELCOMED_KEY, true);
    void vscode.commands.executeCommand('taskExplorer.openSettings');
  }

  // Exposed for integration tests.
  return { provider };
}

export function deactivate() {
  // Provider disposed via context.subscriptions.
}

/** Run/stop commands accept a tree ScriptFileItem ({file.uri}) or {uri}. */
type ScriptArg = { file?: { uri: vscode.Uri }; uri?: vscode.Uri };

function scriptUriOf(item?: ScriptArg): vscode.Uri | undefined {
  return item?.file?.uri ?? item?.uri;
}

/** Extract the script uri from a task we created via buildScriptTask, else undefined. */
function scriptTaskUri(task: vscode.Task): vscode.Uri | undefined {
  const def = task.definition as { type?: string; scriptUri?: string };
  return def?.type === SCRIPT_TASK_TYPE && def.scriptUri
    ? vscode.Uri.parse(def.scriptUri)
    : undefined;
}

/**
 * Open the file that defines a task and reveal its line. Best-effort: handles
 * tasks.json (Workspace tasks) and package.json (npm scripts); falls back to a
 * name search. Shows an info message when the source can't be located.
 */
async function openTaskDefinition(task: vscode.Task): Promise<void> {
  const folder =
    task.scope && typeof task.scope === 'object' && 'uri' in task.scope
      ? (task.scope as vscode.WorkspaceFolder)
      : vscode.workspace.workspaceFolders?.[0];

  if (!folder) {
    vscode.window.showInformationMessage(`No workspace folder to search for "${task.name}".`);
    return;
  }

  const isNpm = task.definition?.type === 'npm';
  const name = (isNpm && task.definition?.script) || task.name;

  // Candidate files in priority order, de-duplicated.
  const uris: vscode.Uri[] = [];
  const push = (u: vscode.Uri) => {
    if (!uris.some((x) => x.toString() === u.toString())) {
      uris.push(u);
    }
  };
  if (isNpm) {
    push(vscode.Uri.joinPath(folder.uri, 'package.json'));
  }
  push(vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json'));
  push(vscode.Uri.joinPath(folder.uri, 'package.json'));

  for (const uri of uris) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const pos = findDefinitionPosition(doc, name);
      if (pos) {
        const editor = await vscode.window.showTextDocument(doc, { preview: true });
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter
        );
        return;
      }
    } catch {
      // File doesn't exist or isn't readable; try the next candidate.
    }
  }

  vscode.window.showInformationMessage(`Couldn't locate the definition for "${task.name}".`);
}

/** Find the line declaring a task/script by name in a JSON document. */
function findDefinitionPosition(
  doc: vscode.TextDocument,
  name: string
): vscode.Position | undefined {
  const text = doc.getText();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`"label"\\s*:\\s*"${esc}"`),
    new RegExp(`"script"\\s*:\\s*"${esc}"`),
    new RegExp(`"taskName"\\s*:\\s*"${esc}"`),
    // npm script key, e.g. "build": "tsc"
    new RegExp(`"${esc}"\\s*:`),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      return doc.positionAt(m.index);
    }
  }
  return undefined;
}

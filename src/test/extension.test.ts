import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TaskExplorerProvider,
  SourceGroupItem,
  TaskItem,
  ScriptsRootItem,
  ScriptCategoryItem,
  ScriptFolderItem,
  ScriptFileItem,
  formatElapsed,
} from '../taskProvider';

const EXT_ID = 'huntertran.hunter-task-explorer';

async function getApi(): Promise<{ provider: TaskExplorerProvider }> {
  const ext = vscode.extensions.getExtension(EXT_ID);
  assert.ok(ext, `extension ${EXT_ID} not found`);
  const api = await ext!.activate();
  assert.ok(api && api.provider, 'activate() did not return provider');
  return api;
}

async function getTask(name: string): Promise<vscode.Task> {
  const tasks = await vscode.tasks.fetchTasks();
  const t = tasks.find((x) => x.name === name);
  assert.ok(t, `sample task "${name}" not found`);
  return t!;
}

/** Poll until predicate holds or timeout. */
async function waitUntil(pred: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

suite('Task Explorer', () => {
  test('formatElapsed renders mm:ss and h:mm:ss', () => {
    assert.strictEqual(formatElapsed(0), '00:00');
    assert.strictEqual(formatElapsed(5000), '00:05');
    assert.strictEqual(formatElapsed(65 * 1000), '01:05');
    assert.strictEqual(formatElapsed((3600 + 125) * 1000), '1:02:05');
  });

  test('extension activates and registers commands', async () => {
    await getApi();
    const cmds = await vscode.commands.getCommands(true);
    for (const c of [
      'taskExplorer.refresh',
      'taskExplorer.runTask',
      'taskExplorer.stopTask',
      'taskExplorer.showOutput',
    ]) {
      assert.ok(cmds.includes(c), `command ${c} not registered`);
    }
  });

  test('tree shows a Workspace source group first', async () => {
    const { provider } = await getApi();
    const roots = await provider.getChildren();
    assert.ok(roots.length > 0, 'no source groups');
    const groups = roots.filter((r): r is SourceGroupItem => r instanceof SourceGroupItem);
    const sources = groups.map((g) => g.source);
    assert.ok(sources.includes('Workspace'), `Workspace group missing; got ${sources}`);
    assert.strictEqual(sources[0], 'Workspace', 'Workspace not sorted first');
  });

  test('Workspace group lists tasks.json tasks', async () => {
    const { provider } = await getApi();
    const roots = await provider.getChildren();
    const ws = roots.find(
      (r): r is SourceGroupItem => r instanceof SourceGroupItem && r.source === 'Workspace'
    );
    assert.ok(ws, 'Workspace group not found');
    const children = await provider.getChildren(ws);
    const labels = children
      .filter((c): c is TaskItem => c instanceof TaskItem)
      .map((c) => c.task.name);
    assert.ok(labels.includes('say hello'), `"say hello" missing; got ${labels}`);
  });

  test('Workspace Scripts group scans script files by category and folder', async () => {
    const { provider } = await getApi();
    const roots = await provider.getChildren();

    const scriptsRoot = roots.find(
      (r): r is ScriptsRootItem => r instanceof ScriptsRootItem
    );
    assert.ok(scriptsRoot, 'Workspace Scripts group missing');

    const categories = (await provider.getChildren(scriptsRoot)).filter(
      (c): c is ScriptCategoryItem => c instanceof ScriptCategoryItem
    );
    const catLabels = categories.map((c) => c.label);
    assert.ok(catLabels.includes('PowerShell'), `PowerShell category missing; got ${catLabels}`);
    assert.ok(catLabels.includes('Shell'), `Shell category missing; got ${catLabels}`);

    // Shell scripts live under scripts/deploy -> a folder node, then files.
    const shell = categories.find((c) => c.label === 'Shell')!;
    const shellChildren = await provider.getChildren(shell);
    const folders = shellChildren.filter((c): c is ScriptFolderItem => c instanceof ScriptFolderItem);
    assert.ok(folders.length > 0, 'expected a folder node under Shell');

    // Drill into the deepest folder and find a .sh file.
    const collectFiles = async (item: ScriptFolderItem | ScriptCategoryItem): Promise<string[]> => {
      const kids = await provider.getChildren(item);
      const names: string[] = [];
      for (const k of kids) {
        if (k instanceof ScriptFileItem) names.push(k.file.name);
        else if (k instanceof ScriptFolderItem) names.push(...(await collectFiles(k)));
      }
      return names;
    };
    const shellFiles = await collectFiles(shell);
    assert.ok(shellFiles.includes('release.sh'), `release.sh missing; got ${shellFiles}`);
  });

  test('idle task item exposes Run context, no description', async () => {
    const t = await getTask('say hello');
    const item = new TaskItem(t, undefined);
    assert.strictEqual(item.contextValue, 'task');
    assert.strictEqual(item.description, undefined);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'play');
  });

  test('running task item exposes Stop context and elapsed description', async () => {
    const t = await getTask('say hello');
    const fakeExec = { task: t, terminate: () => {} } as vscode.TaskExecution;
    const item = new TaskItem(t, { execution: fakeExec, startedAt: Date.now() - 3000 });
    assert.strictEqual(item.contextValue, 'taskRunning');
    assert.ok(/^\d\d:\d\d/.test(String(item.description)), item.description as string);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'debug-stop');
  });

  test('provider markStarted/markEnded toggle running state', () => {
    const provider = new TaskExplorerProvider();
    const fakeTask = { source: 'Workspace', name: 'x', definition: { type: 'shell' } } as vscode.Task;
    const fakeExec = { task: fakeTask, terminate: () => {} } as vscode.TaskExecution;
    assert.strictEqual(provider.isRunning(fakeTask), false);
    provider.markStarted(fakeExec);
    assert.strictEqual(provider.isRunning(fakeTask), true);
    assert.ok(provider.getRunning(fakeTask), 'getRunning should return info while running');
    provider.markEnded(fakeExec);
    assert.strictEqual(provider.isRunning(fakeTask), false);
    provider.dispose();
  });

  test('runTask command actually launches the task and marks it running', async () => {
    const { provider } = await getApi();
    const slow = await getTask('count to 5 (slow)');
    const item = new TaskItem(slow, undefined);

    await vscode.commands.executeCommand('taskExplorer.runTask', item);

    // Real execution is live in the task system...
    await waitUntil(() =>
      vscode.tasks.taskExecutions.some((e) => e.task.name === 'count to 5 (slow)')
    );
    // ...and the extension reflects it as running.
    assert.ok(provider.isRunning(slow), 'provider should report task running');

    // Best-effort cleanup of the spawned task.
    provider.getRunning(slow)?.execution.terminate();
  });

  test('stopTask command terminates the running execution', async () => {
    const { provider } = await getApi();
    const t = await getTask('say hello');
    let terminated = false;
    const fakeExec = {
      task: t,
      terminate: () => {
        terminated = true;
      },
    } as vscode.TaskExecution;
    provider.markStarted(fakeExec);

    const item = new TaskItem(t, provider.getRunning(t));
    await vscode.commands.executeCommand('taskExplorer.stopTask', item);

    assert.ok(terminated, 'stopTask should call execution.terminate()');
    provider.markEnded(fakeExec);
  });
});

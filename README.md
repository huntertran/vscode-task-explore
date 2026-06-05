# Task Explorer

VSCode extension that adds a **Task Explorer** view to the activity bar. It lists the
workspace tasks discovered via the VSCode Tasks API, grouped by source:

- **Workspace** — tasks defined in `.vscode/tasks.json`
- **npm**, **typescript**, etc. — auto-detected task sources

## Features

- Inline **Run** icon on every task.
- While a task runs: the row shows ticking **elapsed time**, the Run icon becomes a
  **Stop** icon, and a **Show Output** icon appears.
- **Show Output** reveals the task's integrated terminal.
- **Stop** terminates the running task.
- Rows auto-revert when a task finishes.
- Title-bar **Refresh** re-fetches tasks.

## Develop

```sh
npm install
npm run compile
```

Press **F5** to launch the Extension Development Host.

## Test

```sh
npm test
```

Runs `@vscode/test-cli` integration tests in a real VS Code instance against this
folder's `.vscode/tasks.json`. Covers: command registration, tree grouping (Workspace
first), run/idle/running tree-item state, provider running-state transitions, a real
`runTask` launch, and `stopTask` terminate dispatch. Tests live in `src/test/`.

## Project layout

- `src/extension.ts` — activation, command registration, task lifecycle wiring.
- `src/taskProvider.ts` — `TreeDataProvider`, tree nodes, running-state tracking.

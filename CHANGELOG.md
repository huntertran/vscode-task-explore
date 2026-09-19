# Change Log

## 0.5.0

### Added

- **Running task badge** — the Task Explorer icon in the activity bar now shows a
  badge with the number of tasks and workspace scripts currently running, so
  background work is visible even when the sidebar is collapsed. A task that appears
  in both Favorites and its source group is counted once.

## 0.4.0

### Added

- **Script scan delay** — new `taskExplorer.scriptScanDelay` setting (milliseconds,
  default `0`). Set to a non-zero value on large repos so the sidebar opens instantly
  and the script scan runs after the configured delay. Configurable in the Settings page.
- **Loading indicator** — the Workspace Scripts section shows a spinner while the scan
  is pending or in progress, so it is always clear what state the tree is in.

### Fixed / Performance

- **Stale-while-revalidate task cache** — the task list is now cached after the first
  fetch. Reopening the sidebar on a large monorepo is instant (serves the cache
  immediately) and re-fetches in the background, re-rendering only when tasks actually
  changed.
- **Eliminated redundant `fetchTasks()` calls** — a full tree render previously called
  `vscode.tasks.fetchTasks()` once per expanded group (N source groups + favorites +
  root). All child groups now share the single fetch result from the root pass, reducing
  the call count from N+2 to 1 per render cycle.

## 0.3.0

### Added

- **Workspace Scripts** — a new top-level category, sibling to the task sources,
  that scans the workspace for script files and groups them by type:
  - **PowerShell** (`.ps1`, `.psm1`, `.psd1`), **Shell** (`.sh`, `.bash`, `.zsh`,
    `.ksh`), and **Batch** (`.bat`, `.cmd`), each with a distinct colored icon.
  - Scripts are shown as a nested **folder tree** mirroring their location on disk.
  - **Run / stop** any script inline (runs with the right interpreter in an
    integrated terminal) with ticking **elapsed time** in both views.
  - **Click** a script to open it in the editor.
  - Auto-refreshes as script files are added or removed.
- **Show/hide scripts** in the settings page — toggle a whole script type (e.g.
  hide all Shell scripts on Windows) or individual scripts, saved per workspace folder.
- A **Scan workspace scripts** toggle in the settings page (and the
  `taskExplorer.showWorkspaceScripts` setting) turns the whole feature on/off.
- The **settings page opens automatically on first install** so the options are
  discoverable.

### Fixed

- Test extension id corrected so the integration suite activates the extension.

## 0.2.0

### Added

- **Webview view style** — alternative to the native tree: two-line items
  (title + wrapping detail), right-aligned elapsed runtime, colored run/stop
  buttons, and collapsible, indented groups. Switch via `taskExplorer.viewStyle`.
- **Settings page** — opened from the gear icon in the view title bar. Switch
  view style, toggle click-to-open-definition, show/hide each category and task
  (per folder), and star favorites.
- **Favorites** — a section pinned to the top of both views. Add/remove via tree
  right-click, the settings-page star, or the hover star on a webview row.
- **Click to open definition** — clicking a task opens its declaration in
  `tasks.json` / `package.json` (on by default; `taskExplorer.openDefinitionOnClick`).
- **Show/hide** categories and individual tasks, saved per workspace folder.

### Changed

- Tree elapsed time updates only the running nodes, removing the per-second
  loading indicator.
- Webview assets split into `media/*.{html,scss,js}` with a shared template loader.

## 0.1.0

- Initial release: Task Explorer sidebar listing tasks grouped by source, with
  inline run/stop, ticking elapsed time, show output, and refresh.

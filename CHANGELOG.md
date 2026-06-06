# Change Log

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

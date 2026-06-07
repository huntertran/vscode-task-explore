// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let groups = [];
  let scripts = null;
  // Persist collapsed group sources locally across reloads.
  const persisted = vscode.getState() || {};
  const collapsed = new Set(persisted.collapsed || []);

  function saveCollapsed() {
    vscode.setState({ collapsed: [...collapsed] });
  }

  // Down-pointing chevron (expanded state); collapsed rotates it to point right.
  const CHEVRON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M8 10.9 3.3 6.2 4 5.5 8 9.5 12 5.5l.7.7z"/></svg>';

  function fmtElapsed(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  const RUN_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" class="icon-run"><path d="M4 2.5v11l9-5.5z"/></svg>';
  const STOP_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" class="icon-stop"><rect x="3.5" y="3.5" width="9" height="9" rx="1"/></svg>';
  const STAR_FULL = '<svg width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" d="M8 1.3l2 4.1 4.5.7-3.3 3.2.8 4.5L8 11.7 3.9 13.8l.8-4.5L1.5 6.1 6 5.4z"/></svg>';
  const STAR_EMPTY = '<svg width="14" height="14" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" d="M8 1.8l1.9 3.8 4.2.6-3 3 .7 4.2L8 11.4 4.2 13.4l.7-4.2-3-3 4.2-.6z"/></svg>';
  const FOLDER_SVG = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M1.5 3h4l1.2 1.5H14.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5z"/></svg>';
  // Distinct, colored glyph per script type (color applied via .cat-icon style).
  const SCRIPT_CAT_ICON = {
    // PowerShell: chevron prompt ">_"
    powershell: '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M3.5 4 7 8l-3.5 4"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M8.5 12.3H13"/></svg>',
    // Shell: dollar prompt "$"
    shell: '<svg width="16" height="16" viewBox="0 0 16 16"><text x="8" y="12.5" text-anchor="middle" font-size="13" font-weight="700" font-family="monospace" fill="currentColor">$</text></svg>',
    // Batch: cog (system script)
    batch: '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M6.8 1h2.4l.4 1.9 1 .4 1.6-1.1 1.7 1.7-1.1 1.6.4 1 1.9.4v2.4l-1.9.4-.4 1 1.1 1.6-1.7 1.7-1.6-1.1-1 .4-.4 1.9H6.8l-.4-1.9-1-.4-1.6 1.1-1.7-1.7 1.1-1.6-.4-1L1 9.2V6.8l1.9-.4.4-1L2.2 3.8l1.7-1.7 1.6 1.1 1-.4zM8 5.6A2.4 2.4 0 1 0 8 10.4 2.4 2.4 0 0 0 8 5.6z"/></svg>',
  };
  const FILE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M4 1.5h5L13 5v9.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5zM9 2v3h3z"/></svg>';
  // Mirrors the codicon "file-code" used by the tree view (page + code chevrons).
  const FILE_CODE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M9.5 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5L9.5 1zM12 14H4V2h4.8L12 5.2V14z"/><path fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" d="M6.6 8.4 5.1 10l1.5 1.6M9.4 8.4 10.9 10l-1.5 1.6"/></svg>';

  // Generic collapsible section: a clickable header (chevron + label, optional
  // count/icon) over a body. `key` drives collapse persistence.
  function makeSection(key, label, opts) {
    opts = opts || {};
    const section = document.createElement('div');
    section.className = 'group' + (collapsed.has(key) ? ' collapsed' : '');

    const header = document.createElement('div');
    header.className = 'group-header';
    const chev = document.createElement('span');
    chev.className = 'chevron';
    chev.innerHTML = CHEVRON_SVG;
    header.appendChild(chev);
    if (opts.icon) {
      const ic = document.createElement('span');
      ic.className = 'cat-icon';
      ic.innerHTML = opts.icon;
      if (opts.iconColor) ic.style.color = opts.iconColor;
      header.appendChild(ic);
    }
    const gl = document.createElement('span');
    gl.className = 'group-label';
    gl.textContent = label;
    header.appendChild(gl);
    if (opts.count != null) {
      const c = document.createElement('span');
      c.className = 'group-count';
      c.textContent = String(opts.count);
      header.appendChild(c);
    }

    const body = document.createElement('div');
    body.className = 'group-tasks';

    header.addEventListener('click', () => {
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      section.classList.toggle('collapsed');
      saveCollapsed();
    });

    section.appendChild(header);
    section.appendChild(body);
    return { section, body };
  }

  // Recursively render a script folder node's children into `parent` at `depth`
  // (indent level). `color` tints the file icons to match the category.
  function renderScriptFolder(node, depth, parent, color) {
    for (const f of node.folders) {
      const key = 'scripts:dir:' + f.path;
      const sub = makeSection(key, f.name, { icon: FOLDER_SVG });
      sub.section.classList.add('script-folder');
      sub.section.querySelector('.group-header').style.paddingLeft = (8 + depth * 12) + 'px';
      renderScriptFolder(f, depth + 1, sub.body, color);
      parent.appendChild(sub.section);
    }
    for (const file of node.files) {
      const row = document.createElement('div');
      row.className = 'row script-file' + (file.running ? ' running' : '');
      row.title = file.relPath;
      row.style.paddingLeft = (8 + depth * 12) + 'px';
      const main = document.createElement('div');
      main.className = 'row-main';
      const ic = document.createElement('span');
      ic.className = 'file-icon';
      ic.innerHTML = FILE_CODE_SVG;
      if (color) ic.style.color = color;
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = file.name;

      const elapsed = document.createElement('div');
      elapsed.className = 'elapsed';
      if (file.running) {
        elapsed.dataset.startedAt = String(file.startedAt ?? Date.now());
        elapsed.textContent = fmtElapsed(Date.now() - (file.startedAt ?? Date.now()));
      }

      const action = document.createElement('button');
      action.className = 'action';
      action.innerHTML = file.running ? STOP_SVG : RUN_SVG;
      action.title = file.running ? 'Stop script' : 'Run script';
      action.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: file.running ? 'stopScript' : 'runScript', id: file.id });
      });

      main.appendChild(ic);
      main.appendChild(title);
      main.appendChild(elapsed);
      main.appendChild(action);
      row.appendChild(main);
      row.addEventListener('click', (e) => {
        if (e.target.closest('.action')) return;
        vscode.postMessage({ type: 'openScript', id: file.id });
      });
      parent.appendChild(row);
    }
  }

  function renderScripts() {
    if (!scripts || !scripts.categories.length) return;
    const top = makeSection('scripts:root', scripts.label, {});
    for (const cat of scripts.categories) {
      const cs = makeSection('scripts:cat:' + cat.id, cat.label, {
        count: cat.count,
        icon: SCRIPT_CAT_ICON[cat.id] || FILE_SVG,
        iconColor: cat.color,
      });
      cs.section.classList.add('script-category');
      // Indent the category one level under the "Workspace Scripts" parent;
      // its folders/files start one level deeper still (depth 2).
      cs.section.querySelector('.group-header').style.paddingLeft = '20px';
      renderScriptFolder(cat.tree, 2, cs.body, cat.color);
      top.body.appendChild(cs.section);
    }
    root.appendChild(top.section);
  }

  function render() {
    root.replaceChildren();
    if (!groups.length && (!scripts || !scripts.categories.length)) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'No tasks found.';
      root.appendChild(d);
      return;
    }
    for (const g of groups) {
      const group = document.createElement('div');
      group.className = 'group' + (collapsed.has(g.source) ? ' collapsed' : '');

      const header = document.createElement('div');
      header.className = 'group-header';
      const chev = document.createElement('span');
      chev.className = 'chevron';
      chev.innerHTML = CHEVRON_SVG;
      const gl = document.createElement('span');
      gl.className = 'group-label';
      gl.textContent = g.label;
      header.appendChild(chev);
      header.appendChild(gl);
      header.addEventListener('click', () => {
        if (collapsed.has(g.source)) collapsed.delete(g.source);
        else collapsed.add(g.source);
        group.classList.toggle('collapsed');
        saveCollapsed();
      });
      group.appendChild(header);

      const tasksEl = document.createElement('div');
      tasksEl.className = 'group-tasks';

      for (const t of g.tasks) {
        const row = document.createElement('div');
        row.className = 'row' + (t.running ? ' running' : '');
        row.title = t.detail || t.name;
        row.addEventListener('click', (e) => {
          if (e.target.closest('.action')) return;
          vscode.postMessage({ type: 'rowClick', id: t.id });
        });

        const main = document.createElement('div');
        main.className = 'row-main';

        const star = document.createElement('button');
        star.className = 'star' + (t.favorite ? ' on' : '');
        star.innerHTML = t.favorite ? STAR_FULL : STAR_EMPTY;
        star.title = t.favorite ? 'Remove from Favorites' : 'Add to Favorites';
        star.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: 'toggleFavorite', id: t.id, fav: !t.favorite });
        });

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = t.name;

        const elapsed = document.createElement('div');
        elapsed.className = 'elapsed';
        if (t.running) {
          elapsed.dataset.startedAt = String(t.startedAt ?? Date.now());
          elapsed.textContent = fmtElapsed(Date.now() - (t.startedAt ?? Date.now()));
        }

        const action = document.createElement('button');
        action.className = 'action';
        action.innerHTML = t.running ? STOP_SVG : RUN_SVG;
        action.title = t.running ? 'Stop task' : 'Run task';
        action.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: t.running ? 'stop' : 'run', id: t.id });
        });

        main.appendChild(star);
        main.appendChild(title);
        main.appendChild(elapsed);
        main.appendChild(action);
        row.appendChild(main);

        if (t.detail) {
          const detail = document.createElement('div');
          detail.className = 'detail';
          detail.textContent = t.detail;
          row.appendChild(detail);
        }

        tasksEl.appendChild(row);
      }

      group.appendChild(tasksEl);
      root.appendChild(group);
    }
    renderScripts();
  }

  // Tick elapsed labels locally every second; no extension round-trip.
  setInterval(() => {
    const now = Date.now();
    for (const el of root.querySelectorAll('.elapsed[data-started-at]')) {
      el.textContent = fmtElapsed(now - Number(el.dataset.startedAt));
    }
  }, 1000);

  // Signature of structure that requires a DOM rebuild. Elapsed time is NOT
  // included — it ticks locally — so per-second reposts don't rebuild the DOM
  // (which would reset hover/cursor and flicker the mouse).
  let lastSig = '';
  function sigOf(gs, sc) {
    const tasksSig = gs.map((g) =>
      g.source + ':' + g.label + ':' + g.tasks.map((t) => t.id + (t.running ? '1' : '0') + (t.favorite ? 'f' : '')).join(',')
    ).join('|');
    // Scripts have no per-second state, so the JSON of the tree is a fine signature.
    return tasksSig + '#' + (sc ? JSON.stringify(sc) : '');
  }

  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg.type === 'state') {
      const sig = sigOf(msg.groups, msg.scripts);
      groups = msg.groups;
      scripts = msg.scripts;
      // Same structure (only the per-second tick): keep DOM, let the local
      // interval update elapsed. Avoids the rebuild that flickers the mouse.
      if (sig === lastSig) return;
      lastSig = sig;
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();

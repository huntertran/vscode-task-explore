// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let groups = [];
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

  function render() {
    root.replaceChildren();
    if (!groups.length) {
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
  function sigOf(gs) {
    return gs.map((g) =>
      g.source + ':' + g.label + ':' + g.tasks.map((t) => t.id + (t.running ? '1' : '0') + (t.favorite ? 'f' : '')).join(',')
    ).join('|');
  }

  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg.type === 'state') {
      const sig = sigOf(msg.groups);
      groups = msg.groups;
      // Same structure (only the per-second tick): keep DOM, let the local
      // interval update elapsed. Avoids the rebuild that flickers the mouse.
      if (sig === lastSig) return;
      lastSig = sig;
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();

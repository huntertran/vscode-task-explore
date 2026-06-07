// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();
  const catsEl = document.getElementById('categories');

  document.querySelectorAll('input[name=viewStyle]').forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) vscode.postMessage({ type: 'setViewStyle', style: r.value });
    });
  });

  const openDef = document.getElementById('openDef');
  openDef.addEventListener('change', () => {
    vscode.postMessage({ type: 'setOpenDefinitionOnClick', on: openDef.checked });
  });

  const showScripts = document.getElementById('showScripts');
  showScripts.addEventListener('change', () => {
    vscode.postMessage({ type: 'setShowWorkspaceScripts', on: showScripts.checked });
  });

  const STAR_FULL = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M8 1.3l2 4.1 4.5.7-3.3 3.2.8 4.5L8 11.7 3.9 13.8l.8-4.5L1.5 6.1 6 5.4z"/></svg>';
  const STAR_EMPTY = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" d="M8 1.8l1.9 3.8 4.2.6-3 3 .7 4.2L8 11.4 4.2 13.4l.7-4.2-3-3 4.2-.6z"/></svg>';

  function renderCategories(categories) {
    catsEl.replaceChildren();
    if (!categories.length) {
      const e = document.createElement('p');
      e.className = 'empty';
      e.textContent = 'No tasks detected in this workspace.';
      catsEl.appendChild(e);
      return;
    }
    for (const c of categories) {
      const box = document.createElement('div');
      box.className = 'cat';

      const head = document.createElement('div');
      head.className = 'cat-head';
      const catCb = document.createElement('input');
      catCb.type = 'checkbox';
      catCb.checked = !c.hidden;
      catCb.title = 'Show/hide whole category';
      catCb.addEventListener('change', () => {
        vscode.postMessage({ type: 'setCategory', source: c.source, hidden: !catCb.checked });
      });
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = c.label;
      head.appendChild(catCb);
      head.appendChild(label);
      box.appendChild(head);

      const list = document.createElement('div');
      list.className = 'task-list' + (c.hidden ? ' cat-hidden' : '');
      for (const t of c.tasks) {
        const row = document.createElement('div');
        row.className = 'task-row';

        // Scripts aren't favoritable: render a spacer instead of the star.
        let star;
        if (t.favoritable === false) {
          star = document.createElement('span');
          star.className = 'star-spacer';
        } else {
          star = document.createElement('button');
          star.className = 'star' + (t.favorite ? ' on' : '');
          star.innerHTML = t.favorite ? STAR_FULL : STAR_EMPTY;
          star.title = t.favorite ? 'Remove from Favorites' : 'Add to Favorites';
          star.addEventListener('click', () => {
            vscode.postMessage({ type: 'setFavorite', id: t.id, fav: !t.favorite });
          });
        }

        const label = document.createElement('label');
        label.className = 'choice task-label';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !t.hidden;
        cb.disabled = c.hidden;
        cb.addEventListener('change', () => {
          vscode.postMessage({ type: 'setTask', id: t.id, hidden: !cb.checked });
        });
        const span = document.createElement('span');
        span.textContent = t.name;
        label.appendChild(cb);
        label.appendChild(span);

        row.appendChild(star);
        row.appendChild(label);
        list.appendChild(row);
      }
      box.appendChild(list);
      catsEl.appendChild(box);
    }
  }

  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg.type === 'state') {
      const s = msg.state;
      document.querySelectorAll('input[name=viewStyle]').forEach((r) => {
        r.checked = r.value === s.viewStyle;
      });
      openDef.checked = s.openDefinitionOnClick;
      showScripts.checked = s.showWorkspaceScripts;
      renderCategories(s.categories);
    }
  });

  vscode.postMessage({ type: 'ready' });
})();

const { screens, workspaces } = window.AmazonAiOpsDesign;

const navRoot = document.querySelector('#workspace-nav');
const contentRoot = document.querySelector('#page-content');
const breadcrumb = document.querySelector('#breadcrumb-current');
const scopeDialog = document.querySelector('#scope-dialog');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function currentKey() {
  const key = location.hash.slice(1);
  return screens[key] ? key : 'today/overview';
}

function renderNavigation(activeKey) {
  navRoot.innerHTML = workspaces.map((workspace) => {
    const expanded = workspace.views.some(([subview]) => `${workspace.id}/${subview}` === activeKey);
    return `<section class="nav-group" aria-label="${escapeHtml(workspace.label)}">
      <a class="nav-heading ${expanded ? 'is-current' : ''}" href="#${workspace.id}/${workspace.views[0][0]}" aria-label="${escapeHtml(workspace.label)}" title="${escapeHtml(workspace.label)}">
        <span class="nav-icon" aria-hidden="true">${workspace.icon}</span><span>${escapeHtml(workspace.label)}</span>
      </a>
      ${expanded ? `<div class="nav-children">${workspace.views.map(([subview, label]) => {
        const key = `${workspace.id}/${subview}`;
        return `<a class="nav-child ${key === activeKey ? 'is-current' : ''}" href="#${key}" ${key === activeKey ? 'aria-current="page"' : ''}>${escapeHtml(label)}</a>`;
      }).join('')}</div>` : ''}
    </section>`;
  }).join('');
}

function renderScreen() {
  const key = currentKey();
  const [workspaceId, subviewId] = key.split('/');
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const definition = screens[key];
  const currentViewLabel = workspace.views.find(([id]) => id === subviewId)?.[1] ?? definition.title;
  breadcrumb.textContent = workspace.label;
  renderNavigation(key);

  contentRoot.innerHTML = `
    <header class="page-heading">
      <div><span class="eyebrow">${escapeHtml(workspace.label)}</span><h1>${escapeHtml(definition.title)}</h1><p>${escapeHtml(definition.description)}</p></div>
      <button class="icon-button refresh-button" type="button" data-action="refresh" aria-label="刷新页面">↻</button>
    </header>
    <nav class="view-tabs" aria-label="${escapeHtml(workspace.label)}页面">
      ${workspace.views.map(([id, label]) => `<a href="#${workspace.id}/${id}" class="view-tab ${id === subviewId ? 'is-current' : ''}" ${id === subviewId ? 'aria-current="page"' : ''}>${escapeHtml(label)}</a>`).join('')}
    </nav>
    <section class="task-banner" aria-labelledby="task-title">
      <span class="task-mark" aria-hidden="true">↗</span>
      <div class="task-copy"><span class="task-kicker">当前主任务</span><h2 id="task-title">${escapeHtml(definition.task)}</h2><p>${escapeHtml(definition.inspector)}</p></div>
      <button class="primary-button" type="button" data-action="preview">${escapeHtml(definition.action)}<span aria-hidden="true">→</span></button>
    </section>
    <section class="summary-strip" aria-label="${escapeHtml(currentViewLabel)}摘要">
      ${definition.metrics.map(({ label, value, note }) => `<div class="summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`).join('')}
    </section>
    <section class="workbench" aria-labelledby="panel-title">
      <div class="workbench-header"><div><h2 id="panel-title">${escapeHtml(definition.panel)}</h2><p>以下为界面结构示意；真实状态以当前店铺的权威数据为准。</p></div>
        <div class="workbench-actions"><label class="search-box"><span aria-hidden="true">⌕</span><input type="search" placeholder="搜索当前列表" aria-label="搜索当前列表"></label><button class="quiet-button" type="button" data-action="filter">筛选</button></div>
      </div>
      <div class="table-wrap"><table><thead><tr>${definition.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>
        ${definition.rows.map((cells, index) => `<tr tabindex="0" data-row="${index}">${cells.map((cell, cellIndex) => `<td>${cellIndex === 0 ? `<strong>${escapeHtml(cell)}</strong>` : cellIndex === 2 ? `<span class="state-chip" data-state="${escapeHtml(cell)}">${escapeHtml(cell)}</span>` : escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="table-footer"><span>预览样例 · 不连接生产数据</span><span>${definition.rows.length} 条结构示例</span></div>
    </section>
    <aside class="inspector-panel" aria-label="设计说明"><span class="inspector-icon">i</span><div><strong>界面说明</strong><p>${escapeHtml(definition.inspector)}</p></div><button class="text-button" type="button" data-action="details">查看状态样式</button></aside>
    <div class="toast" role="status" aria-live="polite" hidden></div>
  `;
}

function notify(message) {
  const toast = contentRoot.querySelector('.toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { toast.hidden = true; }, 2600);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) {
    if (button.dataset.action === 'scope') scopeDialog.showModal();
    else if (button.dataset.action === 'preview') notify('这是设计稿预览，尚未连接真实业务操作。');
    else if (button.dataset.action === 'refresh') notify('刷新按钮状态示意；本设计稿不会读取业务数据。');
    else if (button.dataset.action === 'filter') notify('筛选面板可按对象、状态和业务日期组合。');
    else if (button.dataset.action === 'details') notify('该页面需覆盖加载、空、阻塞、忙碌、错误和完成状态。');
    return;
  }
  const rowElement = event.target.closest('tbody tr');
  if (rowElement) {
    contentRoot.querySelectorAll('tbody tr').forEach((row) => row.classList.remove('is-selected'));
    rowElement.classList.add('is-selected');
    notify('已选中示意行；详情面板只展示本页对应的字段结构。');
  }
});

window.addEventListener('hashchange', renderScreen);
renderScreen();

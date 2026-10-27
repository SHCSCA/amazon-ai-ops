const { insist } = require('./v16-performance-artifacts');
const { readAccessibleCurrent } = require('./v16-ui-accessible-node');
async function prepareReaderTarget(runtime, target, node, root, ui, writer, label) {
  if (node.role !== 'tab') return;
  const before = await readAccessibleCurrent(target, node);
  insist(before.id === node.id && before.name === node.name && before.role === node.role, 'UI_READER_SETUP_TARGET_CHANGED');
  const rootHandle = await root.elementHandle();
  insist(rootHandle, 'UI_READER_SETUP_ROOT_REQUIRED');
  let firstError, targetHandle;
  try {
    targetHandle = await target.elementHandle();
    insist(targetHandle, 'UI_READER_SETUP_TARGET_REQUIRED');
    const verify = async () => {
      const sameRoot = await target.evaluate((element, refs) => Boolean(element === refs.target && refs.root?.isConnected && element.isConnected
        && element.ownerDocument === refs.root.ownerDocument && refs.root.contains(element)), { root: rootHandle, target: targetHandle });
      insist(sameRoot, 'UI_READER_SETUP_ROOT_CHANGED');
      const current = await readAccessibleCurrent(target, node);
      insist(current.id === node.id && current.name === node.name && current.role === 'tab', 'UI_READER_SETUP_TARGET_CHANGED');
    };
    await verify();
    // 所有原登记页签固定点击一次，已选中状态也不能改变这条准备路径。
    await targetHandle.click();
    const workspaceSelector = '[data-workspace-evidence-root]:has([data-v16-a11y-node=' + JSON.stringify(node.id) + '])';
    await ui.waitForWorkspaceSettled(runtime.page, workspaceSelector);
    await ui.waitForRendererComposite(runtime.page, runtime.app, target);
    await verify();
    const selected = await target.evaluate(element => element.getAttribute('aria-selected') === 'true' && element.tabIndex === 0);
    insist(selected, 'UI_READER_SETUP_SELECTED_TAB_REQUIRED');
    writer.json(label + '/target-setup-' + node.id + '.json', { kind: 'v16-reader-target-setup', schemaVersion: 1,
      nodeId: node.id, action: 'normal-tab-click', clickCount: 1, setupOnly: true, noTimingCredit: true, formalCredit: false,
      observedAt: new Date().toISOString() });
  } catch (error) {
    firstError = error;
    try { writer.log('v16.ui_reader_target_setup_failed', error, { nodeId: node.id }); } catch { /* 保留准备首错。 */ }
    throw error;
  } finally {
    if (targetHandle) {
      try { await targetHandle.dispose(); }
      catch (error) { try { writer.log('v16.ui_reader_target_setup_cleanup_failed', error, { nodeId: node.id }); } catch { /* 保留首错。 */ }
        if (!firstError) firstError = error; }
    }
    try { await rootHandle.dispose(); }
    catch (error) { try { writer.log('v16.ui_reader_target_setup_cleanup_failed', error, { nodeId: node.id }); } catch { /* 保留首错。 */ }
      if (!firstError) firstError = error; }
    if (firstError) throw firstError;
  }
}
module.exports = { prepareReaderTarget };

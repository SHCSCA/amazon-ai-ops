async function navigateLegacyRoute(page, route) {
  await page.evaluate((nextRoute) => {
    window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: nextRoute }));
  }, route);
}

async function openScopeEditor(page) {
  const batchSelect = page.getByLabel('数据批次来源');
  if (!await batchSelect.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '范围设置', exact: true }).click();
  }
  await batchSelect.waitFor({ state: 'visible', timeout: 5000 });
  return batchSelect;
}

async function setManualScopeBatch(page, batchId) {
  const batchSelect = await openScopeEditor(page);
  await batchSelect.selectOption('__manual__');
  await page.getByRole('textbox', { name: '手动批次 ID', exact: true }).fill(batchId);
}

module.exports = {
  navigateLegacyRoute,
  openScopeEditor,
  setManualScopeBatch,
};

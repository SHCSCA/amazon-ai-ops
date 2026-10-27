import type { StoreContextEnvelope, StoreRuntimeConfigProjection } from '@amazon-ai-ops/shared-types';

export function assertStoreRuntimeConfigProjection(projection: StoreRuntimeConfigProjection, context: StoreContextEnvelope): void {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)
    || !Object.prototype.hasOwnProperty.call(projection, 'current') || !Array.isArray(projection.versions)
    || (projection.current !== null && (typeof projection.current !== 'object' || Array.isArray(projection.current)))) {
    throw new Error('店铺配置投影无效，请重新读取当前店铺。');
  }
  if (projection.current !== null && projection.current.status !== 'active') {
    throw new Error('当前店铺运行配置未生效，请先恢复配置后重新读取业务数据。');
  }
  if (projection.current === null && projection.versions.length > 0) {
    throw new Error('空店铺配置投影包含异常历史版本，请重新读取当前店铺。');
  }
  if (projection.versions.some(version => !version || !Number.isInteger(version.revision) || version.revision < 1
    || version.revision !== version.snapshot?.revision
    || !['create', 'update', 'archive', 'restore'].includes(version.action)
    || !['active', 'archived'].includes(version.snapshot?.status))) {
    throw new Error('店铺配置历史版本合同无效，请重新读取当前店铺。');
  }
  // 当前记录及历史快照均须属于同一店铺和业务范围，空投影仍由 Main 绑定请求权威。
  const rows = [...(projection.current ? [projection.current] : []), ...projection.versions.map(version => version?.snapshot)];
  if (rows.some(row => !row || row.storeId !== context.storeId || row.marketplace !== context.marketplace
    || row.currency !== context.currency || row.businessTimezone !== context.businessTimezone)) {
    throw new Error('配置返回了其他店铺或业务范围的数据，请重新读取当前店铺。');
  }
}

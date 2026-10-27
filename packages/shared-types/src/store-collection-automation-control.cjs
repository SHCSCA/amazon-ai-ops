const KEY_PREFIX = 'store_collection_automation:v1:';
const RECORD_KEYS = ['schemaVersion', 'storeId', 'browserProfileId', 'revision', 'automaticCollectionEnabled', 'updatedAt'];
const LOGICAL_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

class StoreCollectionAutomationError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'StoreCollectionAutomationError';
    this.code = code;
  }
}
function requireIdentity(value, label) {
  if (typeof value !== 'string' || !LOGICAL_ID.test(value)) {
    throw new StoreCollectionAutomationError('STORE_IDENTITY_MISMATCH', `${label} 必须为规范的店铺逻辑标识。`);
  }
  return value;
}
function storeCollectionAutomationSettingKey(storeId) {
  return KEY_PREFIX + requireIdentity(storeId, 'storeId');
}
function readStoreCollectionAutomation(raw, authority) {
  const storeId = requireIdentity(authority?.storeId, 'storeId');
  const browserProfileId = requireIdentity(authority?.browserProfileId, 'browserProfileId');
  // 缺省只表示保留历史生产行为；读取不得合成或写入覆盖记录。
  if (raw === null || raw === undefined) return Object.freeze({
    storeId, browserProfileId, automaticCollectionEnabled: true,
    source: 'legacy-default', revision: 0, updatedAt: null,
  });
  let record;
  try {
    if (typeof raw !== 'string' || !raw.trim()) throw new TypeError('覆盖记录必须是非空 JSON 文本。');
    record = JSON.parse(raw);
  } catch (cause) {
    throw new StoreCollectionAutomationError('CORRUPT_STORAGE', '自动采集覆盖记录无法解析，已失败关闭。', { cause });
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).length !== RECORD_KEYS.length
    || RECORD_KEYS.some(key => !Object.prototype.hasOwnProperty.call(record, key))
    || Object.keys(record).some(key => !RECORD_KEYS.includes(key))
    || record.schemaVersion !== 1
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || typeof record.automaticCollectionEnabled !== 'boolean'
    || typeof record.updatedAt !== 'string' || !ISO_UTC.test(record.updatedAt)
    || !Number.isFinite(Date.parse(record.updatedAt))
    || new Date(record.updatedAt).toISOString() !== record.updatedAt) {
    throw new StoreCollectionAutomationError('CORRUPT_STORAGE', '自动采集覆盖记录结构无效，已失败关闭。');
  }
  if (record.storeId !== storeId || record.browserProfileId !== browserProfileId) {
    throw new StoreCollectionAutomationError('STORE_IDENTITY_MISMATCH', '自动采集覆盖记录与当前 Store/Profile 不一致。');
  }
  return Object.freeze({ storeId, browserProfileId,
    automaticCollectionEnabled: record.automaticCollectionEnabled,
    source: 'explicit-override', revision: record.revision, updatedAt: record.updatedAt });
}
module.exports = { StoreCollectionAutomationError, storeCollectionAutomationSettingKey, readStoreCollectionAutomation };

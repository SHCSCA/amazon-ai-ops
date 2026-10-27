import { describe, expect, it } from 'vitest';
import type { StoreContextEnvelope, StoreRuntimeConfigProjection } from '@amazon-ai-ops/shared-types';
import { assertStoreRuntimeConfigProjection } from './store-runtime-config-projection';

const context = {
  storeId: 'software-only-store-a', browserProfileId: 'software-only-profile-a', marketplace: 'US', currency: 'USD',
  businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-17', sessionGeneration: 1,
} as StoreContextEnvelope;

function configuredProjection(): StoreRuntimeConfigProjection {
  const current = {
    configId: 'software-only-config-a', storeId: context.storeId, marketplace: 'US', currency: 'USD',
    businessTimezone: context.businessTimezone, status: 'active', revision: 1,
    values: { aiRecommendationsEnabled: false, collectionScheduleLocalTime: '06:00', collectionLookbackDays: 7,
      analysisWindowDays: 30, defaultTargetAcosPercent: 30, minimumRecommendationConfidencePercent: 70, evidenceRetentionDays: 30 },
    createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
  } as NonNullable<StoreRuntimeConfigProjection['current']>;
  return { current, versions: [{ revision: 1, action: 'create', occurredAt: '2026-10-17T00:00:00.000Z', snapshot: structuredClone(current) }] };
}

function assertUnknownProjection(value: unknown): void {
  assertStoreRuntimeConfigProjection(value as StoreRuntimeConfigProjection, context);
}

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
}

describe('店铺运行配置投影纯校验边界', () => {
  it('允许 Main 已授权请求返回的空投影', () => {
    expect(() => assertUnknownProjection({ current: null, versions: [] })).not.toThrow();
  });

  it('允许当前生效配置及同店铺有效历史', () => {
    expect(() => assertUnknownProjection(configuredProjection())).not.toThrow();
  });

  it.each(['create', 'update', 'archive', 'restore'] as const)('保留历史动作 %s 的合同', action => {
    const projection = configuredProjection();
    projection.versions[0].action = action;
    expect(() => assertUnknownProjection(projection)).not.toThrow();
  });

  it.each(['active', 'archived'] as const)('允许历史快照状态 %s', status => {
    const projection = configuredProjection();
    projection.versions[0].snapshot.status = status;
    expect(() => assertUnknownProjection(projection)).not.toThrow();
  });

  it.each([
    undefined, null, true, 1, 'invalid', [], {}, { versions: [] }, { current: null },
    { current: null, versions: null }, { current: null, versions: {} },
    { current: undefined, versions: [] }, { current: [], versions: [] }, { current: 'invalid', versions: [] },
  ])('拒绝坏形投影 %#', projection => {
    expect(() => assertUnknownProjection(projection)).toThrow('店铺配置投影无效');
  });

  it('拒绝仅从原型继承 current 的投影', () => {
    const projection = Object.assign(Object.create({ current: null }), { versions: [] });
    expect(() => assertUnknownProjection(projection)).toThrow('店铺配置投影无效');
  });

  it.each(['archived', 'paused', undefined])('拒绝未生效当前配置 %#', status => {
    const projection = configuredProjection();
    (projection.current as unknown as Record<string, unknown>).status = status;
    expect(() => assertUnknownProjection(projection)).toThrow('当前店铺运行配置未生效');
  });

  it('拒绝空当前配置携带历史版本', () => {
    const projection = configuredProjection();
    projection.current = null;
    expect(() => assertUnknownProjection(projection)).toThrow('空店铺配置投影包含异常历史版本');
  });

  it.each([
    ['空版本', (version: Record<string, unknown>): null => null],
    ['缺字段', (version: Record<string, unknown>) => ({})],
    ['零修订', (version: Record<string, unknown>) => ({ ...version, revision: 0 })],
    ['负修订', (version: Record<string, unknown>) => ({ ...version, revision: -1 })],
    ['小数修订', (version: Record<string, unknown>) => ({ ...version, revision: 1.5 })],
    ['文本修订', (version: Record<string, unknown>) => ({ ...version, revision: '1' })],
    ['修订不匹配', (version: Record<string, unknown>) => ({ ...version, revision: 2 })],
    ['非法动作', (version: Record<string, unknown>) => ({ ...version, action: 'delete' })],
    ['非法快照状态', (version: Record<string, unknown>) => ({ ...version, snapshot: { ...(version.snapshot as object), status: 'paused' } })],
    ['缺快照', (version: Record<string, unknown>) => ({ ...version, snapshot: undefined })],
    ['空快照', (version: Record<string, unknown>) => ({ ...version, snapshot: null })],
  ] as const)('拒绝历史版本合同：%s', (_label, change) => {
    const projection = configuredProjection();
    projection.versions[0] = change(projection.versions[0] as unknown as Record<string, unknown>) as StoreRuntimeConfigProjection['versions'][number];
    expect(() => assertUnknownProjection(projection)).toThrow('店铺配置历史版本合同无效');
  });

  it.each((['storeId', 'marketplace', 'currency', 'businessTimezone'] as const)
    .flatMap(field => ([false, true] as const).map(historical => ({ field, historical }))))(
    '拒绝当前或历史跨店铺范围：$field / $historical', ({ field, historical }) => {
      const projection = configuredProjection();
      const row = historical ? projection.versions[0].snapshot : projection.current!;
      (row as unknown as Record<string, unknown>)[field] = 'OTHER';
      expect(() => assertUnknownProjection(projection)).toThrow('其他店铺或业务范围');
    },
  );

  it('纯校验不修改冻结的当前记录、历史快照和请求上下文', () => {
    const projection = configuredProjection();
    const frozenContext = structuredClone(context);
    const before = structuredClone({ projection, context: frozenContext });
    freezeDeep(projection);
    freezeDeep(frozenContext);
    assertStoreRuntimeConfigProjection(projection, frozenContext);
    expect({ projection, context: frozenContext }).toEqual(before);
  });

  it('每次调用比较传入上下文，不复用前次校验结果', () => {
    const projection = configuredProjection();
    expect(() => assertStoreRuntimeConfigProjection(projection, context)).not.toThrow();
    const otherContext = { ...context, storeId: 'software-only-store-b' } as StoreContextEnvelope;
    expect(() => assertStoreRuntimeConfigProjection(projection, otherContext)).toThrow('其他店铺或业务范围');
    expect(() => assertStoreRuntimeConfigProjection(projection, context)).not.toThrow();
  });
});

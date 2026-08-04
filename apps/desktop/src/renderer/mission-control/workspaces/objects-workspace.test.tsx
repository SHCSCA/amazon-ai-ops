import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  MissionControlCapabilityAction,
  MissionControlCapabilityProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { LegacyWorkspace } from './legacy-workspace';
import { ObjectsWorkspace } from './objects-workspace';

const context = {
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 4,
} as StoreContextEnvelope;

function viewCapability(
  state: MissionControlCapabilityProjection['state'],
): MissionControlCapabilityProjection {
  return {
    capabilityId: 'objects.products.view',
    workspace: 'objects',
    view: 'objects/products',
    action: 'view',
    state,
    legacyRoute: state === 'LEGACY_ADAPTER' ? 'product-management' : undefined,
    detail: `objects.products.view ${state}`,
  };
}

const PRODUCT_ACTIONS = [
  ['objects.products.view', 'view'],
  ['objects.products.create', 'create'],
  ['objects.products.update', 'update'],
  ['objects.products.archive', 'archive'],
  ['objects.events.view', 'view'],
  ['objects.events.create', 'create'],
  ['objects.events.update', 'update'],
  ['objects.events.delete', 'delete'],
] as const satisfies ReadonlyArray<readonly [string, MissionControlCapabilityAction]>;

function productCapabilities(
  state: MissionControlCapabilityProjection['state'],
): MissionControlCapabilityProjection[] {
  return PRODUCT_ACTIONS.map(([capabilityId, action]) => ({
    capabilityId,
    workspace: 'objects',
    view: 'objects/products',
    action,
    state,
    detail: `${capabilityId} ${state}`,
  }));
}

const STORE_ACTIONS = [
  ['objects.store.view', 'view'],
  ['objects.store.create', 'create'],
  ['objects.store.update', 'update'],
  ['objects.store.archive', 'archive'],
  ['objects.store.restore', 'restore'],
  ['objects.store.switch', 'switch'],
] as const satisfies ReadonlyArray<readonly [string, MissionControlCapabilityAction]>;

function storeCapabilities(
  state: MissionControlCapabilityProjection['state'],
): MissionControlCapabilityProjection[] {
  return STORE_ACTIONS.map(([capabilityId, action]) => ({
    capabilityId,
    workspace: 'objects',
    view: 'objects/products',
    action,
    state,
    detail: `${capabilityId} ${state}`,
  }));
}

describe('ObjectsWorkspace integration', () => {
  it('composes Store Authority and the product adapter into one headed first screen', () => {
    const markup = renderToStaticMarkup(
      <LegacyWorkspace
        capabilities={[
          ...productCapabilities('PRODUCTION_NATIVE'),
          ...storeCapabilities('PRODUCTION_NATIVE'),
        ]}
        description="对象工作区"
        intent={{ workspace: 'objects', subview: 'products' }}
        legacySlot={<div data-testid="legacy-products">PRODUCT DIRECTORY ADAPTER</div>}
        route="product-management"
        storeContext={context}
        storeCrudSlot={<div data-testid="store-crud">STORE CRUD</div>}
        title="店铺与产品"
        view="objects/products"
      />,
    );

    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('店铺与广告对象');
    expect(markup).toContain('STORE CRUD');
    expect(markup).not.toContain('PRODUCT DIRECTORY ADAPTER');
    expect(markup).toContain('产品与经营目标');
    expect(markup).toContain('产品与成本');
    expect(markup).toContain('运营事件');
    expect(markup).toContain('data-objects-domain="store"');
    expect(markup).toContain('data-objects-domain="products"');
    expect(markup).toContain('US / USD');
    expect(markup).toContain('profile-one');
  });

  it('keeps native Store CRUD visible but fails the product surface closed when its exact view capability is blocked', () => {
    const markup = renderToStaticMarkup(
      <LegacyWorkspace
        capabilities={[
          ...productCapabilities('PRODUCTION_NATIVE').map((capability) => (
            capability.capabilityId === 'objects.products.view'
              ? { ...capability, state: 'BLOCKED' as const, detail: 'objects.products.view BLOCKED' }
              : capability
          )),
          ...storeCapabilities('PRODUCTION_NATIVE'),
        ]}
        description="对象工作区"
        intent={{ workspace: 'objects', subview: 'products' }}
        legacySlot={<div>SHOULD NOT MOUNT</div>}
        route="product-management"
        storeContext={context}
        storeCrudSlot={<div>STORE CRUD REMAINS</div>}
        title="店铺与产品"
        view="objects/products"
      />,
    );

    expect(markup).toContain('STORE CRUD REMAINS');
    expect(markup).toContain('当前对象视图未获授权');
    expect(markup).not.toContain('产品与成本');
    expect(markup).not.toContain('aria-label="对象类型"');
    expect(markup).toContain('objects.products.view BLOCKED');
    expect(markup).not.toContain('SHOULD NOT MOUNT');
    expect(markup).not.toContain('执行成功');
  });

  it('mounts the native advertising-object surface instead of the old target configuration route', () => {
    const markup = renderToStaticMarkup(
      <LegacyWorkspace
        capabilities={[{
          ...viewCapability('PRODUCTION_NATIVE'),
          capabilityId: 'objects.targets.view',
          view: 'objects/targets',
          legacyRoute: 'product-config',
        }]}
        description="目标维护"
        intent={{ workspace: 'objects', subview: 'targets' }}
        legacySlot={<div>OLD TARGET ADAPTER</div>}
        route="product-config"
        storeContext={context}
        storeCrudSlot={<div>STORE CRUD SHOULD NOT DUPLICATE</div>}
        title="目标与成本"
        view="objects/targets"
      />,
    );

    expect(markup).toContain('广告对象事实');
    expect(markup).toContain('Campaign');
    expect(markup).not.toContain('OLD TARGET ADAPTER');
    expect(markup).not.toContain('STORE CRUD SHOULD NOT DUPLICATE');
    expect(markup).not.toContain('data-objects-domain="store"');
    expect(markup).toContain('data-objects-domain="targets"');
  });

  it('never mounts native object mutations from a LEGACY_ADAPTER projection', () => {
    const markup = renderToStaticMarkup(
      <ObjectsWorkspace
        capabilities={productCapabilities('LEGACY_ADAPTER')}
        storeContext={context}
      />,
    );

    expect(markup).toContain('当前对象视图未获授权');
    expect(markup).toContain('objects.products.create');
    expect(markup).not.toContain('新建产品');
    expect(markup).not.toContain('记录事件');
  });

  it('fails the whole product/event mutation surface closed when one exact action is missing', () => {
    const markup = renderToStaticMarkup(
      <ObjectsWorkspace
        capabilities={productCapabilities('PRODUCTION_NATIVE').filter(
          (capability) => capability.capabilityId !== 'objects.events.delete',
        )}
        storeContext={context}
      />,
    );

    expect(markup).toContain('objects.events.delete');
    expect(markup).not.toContain('新建产品');
    expect(markup).not.toContain('删除');
  });

  it('mounts real Store CRUD only when every required action is PRODUCTION_NATIVE', () => {
    const markup = renderToStaticMarkup(
      <ObjectsWorkspace
        capabilities={[
          viewCapability('PRODUCTION_NATIVE'),
          ...storeCapabilities('PRODUCTION_NATIVE'),
        ]}
        legacyContent={<div>PRODUCT ADAPTER</div>}
        storeContext={context}
        storeCrudSlot={<div>REAL STORE CRUD</div>}
      />,
    );

    expect(markup).toContain('REAL STORE CRUD');
    expect(markup).toContain('data-capability-state="PRODUCTION_NATIVE"');
    expect(markup).toContain('data-native-slot-mode="production-native"');
    expect(markup).not.toContain('CRUD 动作能力未获授权');
  });

  it('mounts preview-memory Store CRUD only under explicit previewMode with a uniform PROTOTYPE_ONLY set', () => {
    const hiddenMarkup = renderToStaticMarkup(
      <ObjectsWorkspace
        capabilities={[
          viewCapability('PROTOTYPE_ONLY'),
          ...storeCapabilities('PROTOTYPE_ONLY'),
        ]}
        previewMode={false}
        storeContext={context}
        storeCrudSlot={<div>PREVIEW STORE CRUD</div>}
      />,
    );
    const previewMarkup = renderToStaticMarkup(
      <ObjectsWorkspace
        capabilities={[
          viewCapability('PROTOTYPE_ONLY'),
          ...storeCapabilities('PROTOTYPE_ONLY'),
        ]}
        previewMode
        storeContext={context}
        storeCrudSlot={<div>PREVIEW STORE CRUD</div>}
      />,
    );

    expect(hiddenMarkup).not.toContain('PREVIEW STORE CRUD');
    expect(hiddenMarkup).toContain('当前并非显式开发预览');
    expect(previewMarkup).toContain('PREVIEW STORE CRUD');
    expect(previewMarkup).toContain('data-capability-state="PROTOTYPE_ONLY"');
    expect(previewMarkup).toContain('data-native-slot-mode="preview-memory"');
  });

  it.each([
    {
      name: 'loading projection',
      capabilities: undefined,
      expected: '正在确认 CRUD 动作能力',
      state: 'LOADING',
    },
    {
      name: 'missing restore projection',
      capabilities: storeCapabilities('PRODUCTION_NATIVE').filter(
        (capability) => capability.capabilityId !== 'objects.store.restore',
      ),
      expected: '缺少或不匹配的精确动作能力：objects.store.restore',
      state: 'BLOCKED',
    },
    {
      name: 'mixed production and prototype projection',
      capabilities: storeCapabilities('PRODUCTION_NATIVE').map((capability) => (
        capability.capabilityId === 'objects.store.switch'
          ? { ...capability, state: 'PROTOTYPE_ONLY' as const }
          : capability
      )),
      expected: '必需 CRUD 动作处于混合能力状态',
      state: 'MIXED',
    },
    {
      name: 'capability id with a mismatched action',
      capabilities: storeCapabilities('PRODUCTION_NATIVE').map((capability) => (
        capability.capabilityId === 'objects.store.create'
          ? { ...capability, action: 'update' as const }
          : capability
      )),
      expected: '缺少或不匹配的精确动作能力：objects.store.create',
      state: 'BLOCKED',
    },
    {
      name: 'blocked projection',
      capabilities: storeCapabilities('BLOCKED'),
      expected: '未全部达到 PRODUCTION_NATIVE',
      state: 'BLOCKED',
    },
  ])('fails Store CRUD closed for $name', ({ capabilities, expected, state }) => {
    const markup = renderToStaticMarkup(
      <ObjectsWorkspace
        capabilities={capabilities}
        previewMode
        storeContext={context}
        storeCrudSlot={<div>SHOULD NOT MOUNT</div>}
      />,
    );

    expect(markup).not.toContain('SHOULD NOT MOUNT');
    expect(markup).toContain(expected);
    expect(markup).toContain(`data-capability-state="${state}"`);
    expect(markup).not.toContain('执行成功');
  });

  it('fails closed when authority passes but no Store CRUD handler is connected', () => {
    const markup = renderToStaticMarkup(
      <ObjectsWorkspace
        capabilities={storeCapabilities('PRODUCTION_NATIVE')}
        storeContext={context}
      />,
    );

    expect(markup).toContain('Renderer 没有收到对应的 CRUD 处理器');
    expect(markup).toContain('data-capability-state="BLOCKED"');
  });
});

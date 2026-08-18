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

describe('ObjectsWorkspace integration', () => {
  it('keeps capability projection internals out of the product range note', () => {
    const capabilities = productCapabilities('PRODUCTION_NATIVE').map((capability, index) => (
      index === 0
        ? { ...capability, detail: 'Main StoreContext authority projection store_id=store-one' }
        : capability
    ));
    const markup = renderToStaticMarkup(
      <ObjectsWorkspace capabilities={capabilities} storeContext={context} />,
    );

    expect(markup).toContain('当前店铺的对象读写能力已确认');
    expect(markup).not.toMatch(/Main|StoreContext|authority projection|store_id=store-one/);
  });

  it('keeps the product and advertising-object workspace free of store connection management', () => {
    const markup = renderToStaticMarkup(
      <LegacyWorkspace
        capabilities={[
          ...productCapabilities('PRODUCTION_NATIVE'),
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
    expect(markup).toContain('产品与广告对象');
    expect(markup).not.toContain('STORE CRUD');
    expect(markup).not.toContain('PRODUCT DIRECTORY ADAPTER');
    expect(markup).toContain('产品与经营目标');
    expect(markup).toContain('产品与成本');
    expect(markup).toContain('运营事件');
    expect(markup).not.toContain('data-objects-domain="store"');
    expect(markup).toContain('data-objects-domain="products"');
    expect(markup).toContain('US / USD');
    expect(markup).not.toContain('profile-one');
    expect(markup).not.toContain('>store-one · US / USD<');
    const ordinaryText = markup
      .replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    expect(ordinaryText).not.toMatch(/Main|StoreContext|Authority|Renderer|Profile|PRODUCT DIRECTORY|store_id/);
  });

  it('keeps store management absent when the product surface is blocked', () => {
    const markup = renderToStaticMarkup(
      <LegacyWorkspace
        capabilities={[
          ...productCapabilities('PRODUCTION_NATIVE').map((capability) => (
            capability.capabilityId === 'objects.products.view'
              ? { ...capability, state: 'BLOCKED' as const, detail: 'objects.products.view BLOCKED' }
              : capability
          )),
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

    expect(markup).not.toContain('STORE CRUD REMAINS');
    expect(markup).toContain('当前对象视图未获授权');
    expect(markup).not.toContain('产品与成本');
    expect(markup).not.toContain('aria-label="对象类型"');
    expect(markup).toContain('当前视图暂不可用，请先完成店铺连接或稍后重试');
    expect(markup).not.toContain('objects.products.view BLOCKED');
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
    expect(markup).toContain('广告活动');
    expect(markup).not.toContain('Campaign');
    expect(markup).not.toContain('store_id');
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

  it('never mounts a store CRUD slot in the product workspace', () => {
    const markup = renderToStaticMarkup(
      <ObjectsWorkspace
        capabilities={productCapabilities('PRODUCTION_NATIVE')}
        storeContext={context}
        storeCrudSlot={<div>SHOULD NOT MOUNT</div>}
      />,
    );

    expect(markup).not.toContain('SHOULD NOT MOUNT');
    expect(markup).not.toContain('当前店铺数据域');
    expect(markup).toContain('产品与广告对象');
  });
});

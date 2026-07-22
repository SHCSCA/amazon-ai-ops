import React from 'react';
import { Database, Package, ShieldCheck } from '@phosphor-icons/react';
import type {
  MissionControlCapabilityAction,
  MissionControlCapabilityProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  PageFrame,
  SummaryStrip,
  WorkspaceState,
} from '../../components/workspace';
import {
  CapabilityStateBadge,
  NativeCrudSlot,
  summarizeViewCapability,
} from '../components';
import { StoreScopedObjectsPanel } from './store-scoped-objects-panel';
import {
  StoreScopedAdObjectsPanel,
  StoreScopedKeywordFactsPanel,
  StoreScopedListingContentPanel,
} from './store-scoped-ad-listing-panel';
import './objects-workspace.css';

export type ObjectsWorkspaceSubview = 'products' | 'events' | 'targets' | 'keywords' | 'listing';

export type ObjectsWorkspaceProps = {
  storeContext: StoreContextEnvelope | null;
  capabilities?: readonly MissionControlCapabilityProjection[];
  legacyContent?: React.ReactNode;
  storeCrudSlot?: React.ReactNode;
  previewMode?: boolean;
  activeSubview?: ObjectsWorkspaceSubview;
};

const OBJECT_SURFACES: Record<ObjectsWorkspaceSubview, {
  view: 'today/events' | 'objects/products' | 'objects/targets' | 'objects/keywords' | 'objects/listing';
  requirements: ReadonlyArray<{
    capabilityId: string;
    action: MissionControlCapabilityAction;
  }>;
  eyebrow: string;
  title: string;
  description: string;
}> = {
  products: {
    view: 'objects/products',
    requirements: [
      { capabilityId: 'objects.products.view', action: 'view' },
      { capabilityId: 'objects.products.create', action: 'create' },
      { capabilityId: 'objects.products.update', action: 'update' },
      { capabilityId: 'objects.products.archive', action: 'archive' },
      { capabilityId: 'objects.events.view', action: 'view' },
      { capabilityId: 'objects.events.create', action: 'create' },
      { capabilityId: 'objects.events.update', action: 'update' },
      { capabilityId: 'objects.events.delete', action: 'delete' },
    ],
    eyebrow: 'PRODUCT DIRECTORY',
    title: '产品与经营目标',
    description: '产品、USD 成本目标与运营事件均通过 Main 的当前店铺授权边界读写。',
  },
  events: {
    view: 'today/events',
    requirements: [
      { capabilityId: 'today.events.view', action: 'view' },
      { capabilityId: 'today.events.create', action: 'create' },
      { capabilityId: 'today.events.update', action: 'update' },
      { capabilityId: 'today.events.archive', action: 'archive' },
      { capabilityId: 'today.events.restore', action: 'restore' },
    ],
    eyebrow: 'CAUSAL CONTEXT',
    title: '运营事件',
    description: '记录当前店铺会影响销量、转化与广告判断的真实运营动作，并保留可恢复历史。',
  },
  targets: {
    view: 'objects/targets',
    requirements: [{ capabilityId: 'objects.targets.view', action: 'view' }],
    eyebrow: 'AD OBJECT FACTS',
    title: '广告对象事实',
    description: 'Campaign、广告组、Target 与 Search Term 只从当前 store_id 的真实入库指标聚合。',
  },
  keywords: {
    view: 'objects/keywords',
    requirements: [{ capabilityId: 'objects.keywords.view', action: 'view' }],
    eyebrow: 'KEYWORD FACTS',
    title: '关键词事实与机会',
    description: '合并当前店铺关键词指标与机会证据，不读取待归属历史行。',
  },
  listing: {
    view: 'objects/listing',
    requirements: [
      { capabilityId: 'objects.listing.view', action: 'view' },
      { capabilityId: 'objects.listing.create', action: 'create' },
      { capabilityId: 'objects.listing.update', action: 'update' },
      { capabilityId: 'objects.listing.delete', action: 'delete' },
    ],
    eyebrow: 'LISTING CONTENT',
    title: 'Listing 内容库',
    description: '按当前店铺维护 Listing 内容与版本历史；本阶段只保存在本地，不自动发布 Amazon。',
  },
};

/**
 * Composes native Store Authority with Main-authorized, store-scoped product
 * and operation-event CRUD. `legacyContent` remains in the prop contract only
 * while the surrounding route migrates; it is deliberately never mounted here
 * because its unscoped product/event APIs are not a safe fallback.
 */
export function ObjectsWorkspace({
  storeContext,
  capabilities,
  previewMode = false,
  storeCrudSlot,
  activeSubview = 'products',
}: ObjectsWorkspaceProps) {
  const surface = OBJECT_SURFACES[activeSubview];
  const summary = summarizeViewCapability(capabilities, surface.view);
  const surfaceCapabilities = surface.requirements.map((requirement) => capabilities?.find((capability) => (
    capability.capabilityId === requirement.capabilityId
    && capability.view === surface.view
    && capability.action === requirement.action
  )));
  const expectedSurfaceState = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  const surfaceAuthorized = capabilities !== undefined
    && surfaceCapabilities.every((capability) => capability?.state === expectedSurfaceState);
  const missingSurfaceCapabilities = surface.requirements
    .filter((_, index) => surfaceCapabilities[index]?.state !== expectedSurfaceState)
    .map((requirement) => requirement.capabilityId);
  const surfaceContent = surfaceAuthorized
    ? activeSubview === 'products' || activeSubview === 'events'
      ? (
        <StoreScopedObjectsPanel
          fixedSubview={activeSubview === 'events' ? 'events' : undefined}
          key={surface.view}
          storeContext={storeContext}
        />
      )
      : activeSubview === 'targets'
        ? <StoreScopedAdObjectsPanel storeContext={storeContext} />
        : activeSubview === 'keywords'
          ? <StoreScopedKeywordFactsPanel storeContext={storeContext} />
          : <StoreScopedListingContentPanel storeContext={storeContext} />
    : (
      <WorkspaceState
        description={missingSurfaceCapabilities.length > 0
          ? `缺少或未达到 ${expectedSurfaceState} 的精确动作能力：${missingSurfaceCapabilities.join('、')}。`
          : 'Main 尚未返回当前视图的精确动作能力。'}
        kind={capabilities === undefined ? 'loading' : 'blocked'}
        title={capabilities === undefined ? '正在确认对象能力' : '当前对象视图未获授权'}
      />
    );

  return (
    <PageFrame
      className="mission-control-objects-page"
      description={surface.description}
      pageId={`mission-control-objects-${activeSubview}`}
      summary={(
        <SummaryStrip
          ariaLabel="店铺与广告对象当前范围"
          items={[
            {
              id: 'store',
              label: '当前店铺数据域',
              value: storeContext ? String(storeContext.storeId) : '等待 Main',
            },
            {
              id: 'market',
              label: '站点 / 币种',
              value: storeContext ? `${storeContext.marketplace} / ${storeContext.currency}` : 'US / USD',
            },
            {
              id: 'profile',
              label: '独立浏览器 Profile',
              value: storeContext ? String(storeContext.browserProfileId) : '未确认',
            },
            {
              id: 'adapter',
              label: '当前视图能力',
              value: summary?.label ?? '读取中',
              tone: summary?.state === 'BLOCKED' ? 'blocked' : summary?.state === 'PROTOTYPE_ONLY' ? 'attention' : 'confirmed',
            },
          ]}
        />
      )}
      title={activeSubview === 'products' ? '店铺与广告对象' : surface.title}
    >
      <div className="mission-control-objects-flow">
        {activeSubview === 'products' && <section
          aria-label="店铺数据域"
          className="mission-control-objects-domain mission-control-objects-domain--store"
          data-objects-domain="store"
        >
          <div className="mission-control-objects-domain__intro" role="note">
            <span className="mission-control-objects-domain__icon"><Database aria-hidden="true" size={18} /></span>
            <span>
              <strong>店铺数据域</strong>
              <small>店铺、业务数据、可见浏览器 Profile 与会话代次相互隔离。</small>
            </span>
            <span className="mission-control-objects-domain__fixed"><ShieldCheck aria-hidden="true" size={15} /> Amazon US · USD</span>
          </div>
          <NativeCrudSlot
            blockedReason="等待 Main Store Authority 提供创建、编辑、归档和切换处理器。"
            capabilities={capabilities}
            capabilityIds={{
              view: 'objects.store.view',
              create: 'objects.store.create',
              update: 'objects.store.update',
              archive: 'objects.store.archive',
              restore: 'objects.store.restore',
              switch: 'objects.store.switch',
            }}
            capabilityView="objects/products"
            createLabel="新建美国站店铺"
            description="第一版固定 Amazon US / USD，每店使用独立数据域与可见浏览器 Profile。"
            previewMode={previewMode}
            slotId="store-crud"
            title="店铺数据域"
          >
            {storeCrudSlot}
          </NativeCrudSlot>
        </section>}

        <section
          aria-labelledby="mission-control-objects-product-title"
          className="mission-control-objects-domain mission-control-objects-domain--products"
          data-capability-state={summary?.state ?? 'LOADING'}
          data-objects-domain={activeSubview}
        >
          {activeSubview === 'products' && <header className="mission-control-objects-domain__header">
            <span className="mission-control-objects-domain__icon"><Package aria-hidden="true" size={18} /></span>
            <div>
              <span>{surface.eyebrow}</span>
              <h2 id="mission-control-objects-product-title">{surface.title}</h2>
              <p>{surface.description}</p>
            </div>
            <CapabilityStateBadge summary={summary} />
          </header>}

          {activeSubview === 'products' && (
            <div className="mission-control-objects-adapter-context" role="note">
              <span>当前范围</span>
              <strong>{storeContext ? String(storeContext.storeId) : '等待店铺'}</strong>
              <span>{storeContext ? `${storeContext.marketplace} / ${storeContext.currency}` : 'US / USD'}</span>
              <span aria-hidden="true" className="mission-control-objects-adapter-context__separator">·</span>
              <small>{summary?.detail ?? '正在从 Main 读取店铺对象能力投影。'}</small>
            </div>
          )}

          <div
            aria-label={`当前店铺${surface.title}`}
            className="mission-control-objects-product-adapter"
          >
            {surfaceContent}
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

import React from 'react';
import { Database, Package, ShieldCheck } from '@phosphor-icons/react';
import type {
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
import './objects-workspace.css';

export type ObjectsWorkspaceProps = {
  storeContext: StoreContextEnvelope | null;
  capabilities?: readonly MissionControlCapabilityProjection[];
  legacyContent?: React.ReactNode;
  storeCrudSlot?: React.ReactNode;
  previewMode?: boolean;
};

/**
 * Composes the native store authority and the existing product adapter into one
 * product-first Objects screen. The component owns no persistence or simulated
 * mutations: Store CRUD stays in Main and the product surface stays behind the
 * legacy capability boundary supplied by the caller.
 */
export function ObjectsWorkspace({
  storeContext,
  capabilities,
  legacyContent,
  previewMode = false,
  storeCrudSlot,
}: ObjectsWorkspaceProps) {
  const summary = summarizeViewCapability(capabilities, 'objects/products');
  const loading = capabilities === undefined;
  const productAdapterReady = Boolean(legacyContent);

  return (
    <PageFrame
      className="mission-control-objects-page"
      description="先确认店铺数据域，再维护当前店铺的产品与经营目标。产品维护不会直接触发 Amazon Ads 写入。"
      pageId="mission-control-objects-products"
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
              label: '产品目录能力',
              value: summary?.label ?? '读取中',
              tone: summary?.state === 'BLOCKED' ? 'blocked' : summary?.state === 'PROTOTYPE_ONLY' ? 'attention' : 'confirmed',
            },
          ]}
        />
      )}
      title="店铺与广告对象"
    >
      <div className="mission-control-objects-flow">
        <section
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
        </section>

        <section
          aria-labelledby="mission-control-objects-product-title"
          className="mission-control-objects-domain mission-control-objects-domain--products"
          data-capability-state={summary?.state ?? 'LOADING'}
          data-objects-domain="products"
        >
          <header className="mission-control-objects-domain__header">
            <span className="mission-control-objects-domain__icon"><Package aria-hidden="true" size={18} /></span>
            <div>
              <span>PRODUCT DIRECTORY</span>
              <h2 id="mission-control-objects-product-title">产品与经营目标</h2>
              <p>当前子视图复用生产产品适配层；目标、关键词与 Listing 通过上方同一工作区页签切换。</p>
            </div>
            <CapabilityStateBadge summary={summary} />
          </header>

          <div className="mission-control-objects-adapter-context" role="note">
            <span>当前范围</span>
            <strong>{storeContext ? String(storeContext.storeId) : '等待店铺'}</strong>
            <span>{storeContext ? `${storeContext.marketplace} / ${storeContext.currency}` : 'US / USD'}</span>
            <small>{summary?.detail ?? '正在从 Main 读取产品目录能力投影。'}</small>
          </div>

          {productAdapterReady ? (
            <div
              aria-label="产品目录生产适配内容"
              className="mission-control-objects-product-adapter"
            >
              {legacyContent}
            </div>
          ) : (
            <div className="mission-control-objects-product-state">
              <WorkspaceState
                description={loading
                  ? '请等待 Main 返回当前店铺的产品目录能力投影。'
                  : '产品目录只有在 view 能力为 PRODUCTION_NATIVE、LEGACY_ADAPTER，或显式开发预览时才会挂载。'}
                details={loading ? undefined : summary?.detail}
                kind={loading ? 'loading' : 'blocked'}
                title={loading ? '正在确认产品适配边界' : '产品适配未授权'}
              />
            </div>
          )}
        </section>
      </div>
    </PageFrame>
  );
}

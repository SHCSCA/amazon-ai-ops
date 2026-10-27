import React from 'react';
import type { StoreAdObjectFactView } from './store-scoped-ad-listing-contracts';
import { objectHierarchy } from './store-scoped-ad-listing-values';

const KIND_LABELS = { campaign: '广告活动', ad_group: '广告组', target: '关键词或投放', search_term: '搜索词' } as const;

export function StoreAdObjectIdentity({ row }: { row: StoreAdObjectFactView }) {
  const rawName = row.name.trim();
  const name = rawName && rawName !== row.entityId && rawName !== row.objectKey ? rawName : `未命名${KIND_LABELS[row.kind]}`;
  return (
    <div className="store-fact-primary">
      <strong>{name}</strong>
      <small aria-label="广告对象所属路径" className="store-fact-object-path">{objectHierarchy(row)}</small>
      <small>{row.resolved === true && row.nonExecutable === false ? '对象已唯一识别，可用于受控动作' : '对象尚未唯一识别，不可执行'}</small>
      <details className="store-fact-internal-identity">
        <summary>查看内部标识</summary>
        <dl>
          <dt>对象标识</dt><dd>{row.entityId || '未获取'}</dd>
          <dt>事实记录标识</dt><dd>{row.objectKey}</dd>
        </dl>
      </details>
    </div>
  );
}

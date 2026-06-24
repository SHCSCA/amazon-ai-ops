import React from 'react';
import { PageHeader, Panel } from '../components/ui';

export function ProductManagementPage() {
  return (
    <div>
      <PageHeader
        eyebrow="运营总览"
        title="产品管理"
        description="先选择产品，再关联广告数据、运营事件、AI 量化、关键词和 Listing。"
        primaryTask="按产品管理运营上下文"
        nextAction="选择产品"
      />
      <div className="business-stack">
        <Panel title="产品工作台">
          <p className="muted-line">正在读取当前范围的产品、广告数据和运营事件。</p>
        </Panel>
      </div>
    </div>
  );
}

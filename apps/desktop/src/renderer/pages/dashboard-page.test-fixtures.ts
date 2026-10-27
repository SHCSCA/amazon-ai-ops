import type {
  BusinessQuantDiagnostic,
} from '../types';

export function dashboardDiagnostic(overrides: Partial<BusinessQuantDiagnostic>): BusinessQuantDiagnostic {
  return {
    objectName: '测试对象',
    spend: 10,
    sales: 20,
    orders: 1,
    clicks: 5,
    acos: 0.5,
    cvr: 0.2,
    cpc: 2,
    diagnosis: '测试诊断',
    suggestedDirection: '人工确认',
    ...overrides,
  };
}

export interface LocatorStrategy {
  type: 'css' | 'xpath' | 'text' | 'role' | 'label';
  value: string;
  timeout?: number;               // 默认 5000ms
  index?: number;                 // 如果有多个匹配
}

export interface ElementLocator {
  id: string;
  strategies: LocatorStrategy[];  // 按优先级排列
  description?: string;
}

export interface PageModelVersion {
  version: string;
  lingxingVersion: string;        // 对应的领星版本
  updatedAt: string;
  changelog?: string;
}

export interface PageModel {
  id: string;
  name: string;                   // 'ad-campaign', 'ad-search-term', 'login'
  version: string;
  lingxingVersion: string;
  // 关键元素定位
  elements: Record<string, ElementLocator>;
  // 等待条件
  waitConditions: WaitCondition[];
  // 页面状态判断
  stateCheck: PageStateCheck;
  // 验证
  verifySelectors: string[];
  updatedAt: string;
}

export interface WaitCondition {
  type: 'networkidle' | 'domcontentloaded' | 'selector' | 'text' | 'url' | 'function';
  value?: string;
  timeout?: number;
}

export interface PageStateCheck {
  loggedIn?: {
    urlPatterns: string[];
    requiredTexts: string[];
    forbiddenTexts: string[];
  };
  loggedOut?: {
    urlPatterns: string[];
    requiredTexts: string[];
  };
}

export interface NavigationTarget {
  pageModelId: string;
  url?: string;
  params?: Record<string, string>;
}

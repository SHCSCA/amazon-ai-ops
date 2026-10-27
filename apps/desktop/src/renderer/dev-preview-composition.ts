// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import { type PreviewScenarioId } from './dev-preview-contracts';
import { DEFAULT_PREVIEW_SCENARIO } from './dev-preview-scenarios';
import { createPreviewRuntimeState } from './dev-preview-state';
import { createPreviewLoginApi } from './dev-preview-login';
import { createPreviewProductsApi } from './dev-preview-products';
import { createPreviewEventsApi } from './dev-preview-events';
import { createPreviewQueriesApi } from './dev-preview-queries';
import { createPreviewListingsApi } from './dev-preview-listings';
import { createPreviewElectronSurface } from './dev-preview-surface';

export function createBrowserPreviewElectronApi(username: string, scenarioId: PreviewScenarioId = DEFAULT_PREVIEW_SCENARIO) {
const context = createPreviewRuntimeState(username, scenarioId);
const login = createPreviewLoginApi(context);
const products = createPreviewProductsApi(context);
const events = createPreviewEventsApi(context);
const queries = createPreviewQueriesApi(context);
const listings = createPreviewListingsApi(context);
return createPreviewElectronSurface(context, login, products, events, queries, listings);
}

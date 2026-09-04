import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  CaretDown,
  Check,
  CheckCircle,
  ClipboardText,
  Gear,
  ListChecks,
  LockKey,
  Package,
  Play,
  Robot,
  ShieldCheck,
  Storefront,
  Target,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  buildLedger,
  createInitialAppState,
  getActiveStoreState,
  getReportCoverage,
  selectProduct as selectProductInStore,
  selectStore,
  updateStoreState,
} from "./model.js";
import { STORE_SUMMARIES } from "./mockData.js";
import {
  AUTONOMY_MODES,
  INTERNAL_CAPABILITIES,
  MODULES,
  captureExecutionAuthority,
  commitExecution,
  completeAnalysisRun,
  createExperiment,
  createStoreRuntime,
  deriveCausalMemories,
  getConnectionState,
  getExecutionGate,
  invalidateAnalysisScope,
  selectAdObject as selectAdObjectInRuntime,
  startAnalysisRun,
  transitionExperiment,
  verifyAdObject as verifyAdObjectInRuntime,
  verifyExecutionReadback,
} from "./prototype-domain.js";
import PrototypeWorkspace from "./prototype-workspaces.jsx";
import {
  checkPolicyDraft,
  createPolicyDraft,
  createStoreSettings,
  enablePolicyDraft,
  runAutomationTask,
  toggleAutomationTask,
  updateStoreConfig,
} from "./prototype-settings-domain.js";

const MODULE_ICONS = {
  today: ClipboardText,
  assets: Package,
  decisions: Brain,
  execution: Play,
  memory: ListChecks,
  settings: Gear,
};

function visibleStore(store) {
  return store?.storeName || store?.name || "当前店铺";
}

function selectedProduct(store) {
  const products = store?.products || [];
  const selectedId = store?.selectedProductId || store?.scope?.selectedProductId;
  return products.find((item) => item.id === selectedId)
    || products.find((item) => item.selected)
    || products[0]
    || null;
}

function normalizeStoreForRuntime(store) {
  return {
    ...store,
    connections: {
      ...(store.connections || {}),
      erp: {
        status: store.connections?.erp?.status || (store.session?.status === "ready" ? "ready" : "blocked"),
      },
      ads: {
        status: store.connections?.ads?.status || "blocked",
        storeMatched: store.connections?.ads?.storeMatched ?? "blocked",
      },
    },
    adsIdentity: {
      ...(store.adsIdentity || {}),
      status: store.adsIdentity?.status || "blocked",
      storeMatched: store.adsIdentity?.storeMatched ?? false,
    },
  };
}

function connectionView(store) {
  const truth = getConnectionState(normalizeStoreForRuntime(store));
  if (truth.erpReady && truth.adsReady && truth.storeIdentityReady) {
    return { label: "ERP / Ads 已连接", detail: "当前店铺已确认", tone: "success" };
  }
  if (truth.erpReady) {
    return { label: "ERP 已连接 · Ads 待处理", detail: "只读采集可用", tone: "warning" };
  }
  return { label: "连接尚未建立", detail: "采集与执行均阻断", tone: "danger" };
}

function validRoute(workspace, subview) {
  const module = MODULES.find((item) => item.id === workspace);
  if (!module) return null;
  const resolvedSubview = module.subviews.find((item) => item.id === subview)?.id || module.subviews[0]?.id;
  return resolvedSubview ? { workspace: module.id, subview: resolvedSubview } : null;
}

function routeFromHash() {
  if (typeof window === "undefined") return { workspace: "today", subview: "overview" };
  const value = window.location.hash.replace(/^#\/?/, "");
  const [workspace, subview] = value.includes(":") ? value.split(":") : value.split("/");
  return validRoute(workspace, subview) || { workspace: "today", subview: "overview" };
}

function runtimeView(runtime) {
  const mode = AUTONOMY_MODES.find((item) => item.id === runtime.autonomyMode) || AUTONOMY_MODES[1];
  return {
    ...runtime,
    modeLabel: mode.label,
    activeAnalysisRunId: runtime.activeRunId,
    analysisRuns: (runtime.analysisRuns || []).slice().reverse().map((run) => ({
      ...run,
      ordinal: run.sequence,
      summary: run.result?.summary,
      recommendationIds: (run.recommendations || []).map((item) => item.id),
      recommendationCount: run.result?.recommendationCount ?? run.recommendations?.length ?? 0,
      statusLabel: run.status === "completed" ? "当前有效" : run.status === "running" ? "运行中" : run.status === "blocked" ? "已阻断" : "已被新分析替代",
      currentPhaseLabel: run.phaseLabel,
    })),
  };
}

function normalizedGate(store, runtime) {
  const gate = getExecutionGate(normalizeStoreForRuntime(store), runtime);
  const [workspace, subview] = (gate.nextRouteId || "decisions:approval").split(":");
  return {
    ...gate,
    reasons: gate.blockedReasons || (gate.reason ? [gate.reason] : []),
    nextRoute: validRoute(workspace, subview),
  };
}

function Modal({ title, description, children, footer, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    requestAnimationFrame(() => dialogRef.current?.querySelector("button, input, select")?.focus());
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const items = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="ops-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-modal="true" aria-label={title} className="ops-modal" ref={dialogRef} role="dialog">
        <header><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button aria-label="关闭" className="ops-icon-button" onClick={onClose} type="button"><X size={18} /></button></header>
        <div className="ops-modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}

function AppTopbar({ store, stores, runtime, onStoreChange, onOpenMode, onNavigate }) {
  const [storeOpen, setStoreOpen] = useState(false);
  const product = selectedProduct(store);
  const mode = AUTONOMY_MODES.find((item) => item.id === runtime.autonomyMode) || AUTONOMY_MODES[1];
  const connection = connectionView(store);
  return (
    <header className="ops-topbar">
      <div className="ops-brand"><span><Robot size={22} weight="fill" /></span><div><b>运营智能体</b><small>Amazon US 自营工作台</small></div></div>
      <div className="ops-contexts">
        <div className="ops-store-switcher">
          <button aria-expanded={storeOpen} aria-haspopup="listbox" className="ops-context-button" onClick={() => setStoreOpen((value) => !value)} type="button">
            <Storefront size={17} /><span><small>当前店铺</small><b>{visibleStore(store)}</b></span><em>US</em><em>USD</em><CaretDown size={14} />
          </button>
          {storeOpen && <div className="ops-store-menu" role="listbox" aria-label="切换店铺">{stores.map((item) => <button aria-selected={item.id === store.id} key={item.id} onClick={() => { onStoreChange(item.id); setStoreOpen(false); }} role="option" type="button"><Storefront size={17} /><span><b>{item.storeName || item.name}</b><small>Amazon US · USD</small></span>{item.id === store.id && <Check size={15} />}</button>)}</div>}
        </div>
        <button className="ops-context-button is-product" onClick={() => onNavigate("assets", "products")} type="button"><Target size={17} /><span><small>产品范围</small><b>{product?.sku || "全部产品"}</b></span></button>
        <button className={`ops-context-button is-${connection.tone}`} onClick={() => onNavigate("settings", "connections")} type="button">{connection.tone === "success" ? <CheckCircle size={17} weight="fill" /> : <WarningCircle size={17} weight="fill" />}<span><small>{connection.detail}</small><b>{connection.label}</b></span></button>
      </div>
      <div className="ops-top-actions">
        <button className="ops-mode-button" onClick={onOpenMode} type="button">{mode.id === "manual" ? <UserCircle size={17} /> : mode.id === "auto" ? <Robot size={17} /> : <ShieldCheck size={17} />}<span><small>当前模式</small><b>{mode.label}</b></span><CaretDown size={14} /></button>
      </div>
    </header>
  );
}

function Sidebar({ route, onNavigate }) {
  return (
    <aside className="ops-sidebar">
      <nav aria-label="主业务导航">
        <span className="ops-nav-label">运营闭环</span>
        {MODULES.filter((item) => item.id !== "settings").map((item) => {
          const Icon = MODULE_ICONS[item.id] || Package;
          return <button aria-current={route.workspace === item.id ? "page" : undefined} className={route.workspace === item.id ? "is-active" : ""} key={item.id} onClick={() => onNavigate(item.id, item.subviews[0].id)} type="button"><Icon size={20} weight={route.workspace === item.id ? "fill" : "regular"} /><span>{item.label}</span></button>;
        })}
      </nav>
      <div className="ops-sidebar-bottom">
        <button aria-current={route.workspace === "settings" ? "page" : undefined} className={route.workspace === "settings" ? "is-active" : ""} onClick={() => onNavigate("settings", "stores")} type="button"><Gear size={20} /><span>系统设置</span></button>
        <div><LockKey size={14} weight="fill" /><span>店铺数据、浏览器与审批严格隔离</span></div>
      </div>
    </aside>
  );
}

function SubviewTabs({ route, onNavigate }) {
  const module = MODULES.find((item) => item.id === route.workspace) || MODULES[0];
  if (module.subviews.length <= 1) return null;
  const move = (event, index) => {
    const key = event.key;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event.preventDefault();
    const nextIndex = key === "Home" ? 0 : key === "End" ? module.subviews.length - 1 : (index + (key === "ArrowRight" ? 1 : -1) + module.subviews.length) % module.subviews.length;
    const next = module.subviews[nextIndex];
    onNavigate(module.id, next.id);
    requestAnimationFrame(() => document.getElementById(`ops-tab-${module.id}-${next.id}`)?.focus());
  };
  return (
    <nav className="ops-subview-tabs" aria-label={`${module.label}子页面`} role="tablist">
      {module.subviews.map((item, index) => <button aria-controls={`ops-panel-${module.id}-${item.id}`} aria-selected={route.subview === item.id} className={route.subview === item.id ? "is-active" : ""} id={`ops-tab-${module.id}-${item.id}`} key={item.id} onClick={() => onNavigate(module.id, item.id)} onKeyDown={(event) => move(event, index)} role="tab" tabIndex={route.subview === item.id ? 0 : -1} type="button">{item.label}</button>)}
    </nav>
  );
}

function ModeDialog({ runtime, onClose, onConfirm }) {
  const [selected, setSelected] = useState(runtime.autonomyMode);
  return (
    <Modal
      title="切换当前店铺执行模式"
      description="模式只作用于当前店铺。任何模式都不会绕过 Ads 身份、对象、策略与回读安全门。"
      onClose={onClose}
      footer={<><button className="ops-button" onClick={onClose} type="button">取消</button><button className="ops-button is-primary" onClick={() => onConfirm(selected)} type="button">确认切换</button></>}
    >
      <div className="ops-mode-options">{AUTONOMY_MODES.map((mode) => <button aria-pressed={selected === mode.id} className={selected === mode.id ? "is-selected" : ""} key={mode.id} onClick={() => setSelected(mode.id)} type="button"><span>{mode.id === "manual" ? <UserCircle size={21} /> : mode.id === "auto" ? <Robot size={21} /> : <ShieldCheck size={21} />}</span><div><b>{mode.label}</b><p>{mode.summary}</p><small>{mode.executionRule}</small></div>{selected === mode.id && <Check size={17} />}</button>)}</div>
    </Modal>
  );
}

export default function App() {
  const [modelState, setModelState] = useState(() => createInitialAppState());
  const activeStore = getActiveStoreState(modelState);
  const [runtimes, setRuntimes] = useState(() => Object.fromEntries(Object.entries(createInitialAppState().stores).map(([storeId, store]) => [storeId, createStoreRuntime(normalizeStoreForRuntime(store))])));
  const [settingsByStore, setSettingsByStore] = useState(() => Object.fromEntries(Object.entries(createInitialAppState().stores).map(([storeId, store]) => [storeId, createStoreSettings(store)])));
  const runtime = runtimes[modelState.activeStoreId];
  const settings = settingsByStore[modelState.activeStoreId];
  const [route, setRoute] = useState(routeFromHash);
  const [modeDialogOpen, setModeDialogOpen] = useState(false);
  const [toastsByStore, setToastsByStore] = useState({});
  const [operationsByStore, setOperationsByStore] = useState({});
  const timers = useRef(new Set());
  const modelRef = useRef(modelState);
  const runtimesRef = useRef(runtimes);

  useEffect(() => { modelRef.current = modelState; }, [modelState]);
  useEffect(() => { runtimesRef.current = runtimes; }, [runtimes]);

  const schedule = useCallback((callback, delay) => {
    const timer = window.setTimeout(() => { timers.current.delete(timer); callback(); }, delay);
    timers.current.add(timer);
    return timer;
  }, []);

  useEffect(() => () => { timers.current.forEach((timer) => window.clearTimeout(timer)); timers.current.clear(); }, []);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((workspace, subview) => {
    const next = validRoute(workspace, subview);
    if (!next) return;
    const nextHash = `${next.workspace}/${next.subview}`;
    if (window.location.hash.replace(/^#\/?/, "") !== nextHash) window.location.hash = nextHash;
    setRoute(next);
  }, []);

  const notify = useCallback((message, tone = "success", storeId = modelRef.current.activeStoreId) => {
    const token = `${storeId}-${Date.now()}-${message}`;
    setToastsByStore((current) => ({ ...current, [storeId]: { message, tone, token } }));
    schedule(() => setToastsByStore((current) =>
      current[storeId]?.token === token ? { ...current, [storeId]: null } : current,
    ), 3200);
  }, [schedule]);

  const setStoreBusy = useCallback((storeId, operation, busy) => {
    setOperationsByStore((current) => ({
      ...current,
      [storeId]: { ...(current[storeId] || {}), [operation]: busy },
    }));
  }, []);

  const updateRuntime = useCallback((storeId, updater) => {
    setRuntimes((current) => ({ ...current, [storeId]: typeof updater === "function" ? updater(current[storeId]) : updater }));
  }, []);

  const updateSettings = useCallback((storeId, updater) => {
    setSettingsByStore((current) => ({
      ...current,
      [storeId]: typeof updater === "function" ? updater(current[storeId]) : updater,
    }));
  }, []);

  const switchStore = useCallback((storeId) => {
    setModelState((current) => selectStore(current, storeId));
    notify(`已切换到 ${STORE_SUMMARIES.find((item) => item.id === storeId)?.storeName || "所选店铺"}；数据与运行状态已隔离。`, "success", storeId);
  }, [notify]);

  const runAnalysis = useCallback(() => {
    const storeId = modelState.activeStoreId;
    const storeSnapshot = normalizeStoreForRuntime(activeStore);
    const started = startAnalysisRun(runtimes[storeId], storeSnapshot);
    const startedRun = started.analysisRuns.find((item) => item.id === started.activeRunId);
    updateRuntime(storeId, started);
    notify(started.feedback?.message || "分析已开始。", started.feedback?.tone || "info", storeId);
    if (started.analysisRuns.find((item) => item.id === started.activeRunId)?.status !== "running") return;
    schedule(() => {
      const liveRuntime = runtimesRef.current[storeId];
      const liveRun = liveRuntime?.analysisRuns?.find((item) => item.id === liveRuntime.activeRunId);
      if (!liveRun || liveRun.id !== startedRun?.id || liveRun.fingerprint !== startedRun?.fingerprint) return;
      updateRuntime(storeId, (current) => {
        const currentRun = current.analysisRuns.find((item) => item.id === current.activeRunId);
        if (!currentRun || currentRun.id !== startedRun?.id || currentRun.fingerprint !== startedRun?.fingerprint) return current;
        const completed = completeAnalysisRun(current, storeSnapshot);
        return { ...completed, causalMemories: deriveCausalMemories(storeSnapshot, completed) };
      });
      notify("本次分析已完成：旧建议已替代，只保留当前范围的有效建议。", "success", storeId);
    }, 900);
  }, [activeStore, modelState.activeStoreId, notify, runtimes, schedule, updateRuntime]);

  const selectProduct = useCallback((productId) => {
    const storeId = modelState.activeStoreId;
    const nextStore = selectProductInStore(activeStore, productId);
    setModelState((current) => updateStoreState(current, storeId, nextStore));
    updateRuntime(storeId, (current) => invalidateAnalysisScope(current, normalizeStoreForRuntime(nextStore), "产品范围已切换"));
    notify("产品范围已切换；历史保留，旧建议已退出当前待办，请运行新分析。", "success");
  }, [activeStore, modelState.activeStoreId, notify, updateRuntime]);

  const collectReports = useCallback(() => {
    const storeId = modelState.activeStoreId;
    if (operationsByStore[storeId]?.collection) return;
    const storeSnapshot = modelState.stores[storeId];
    setStoreBusy(storeId, "collection", true);
    schedule(() => {
      const liveStore = modelRef.current.stores[storeId];
      const expectedProduct = storeSnapshot.selectedProductId || storeSnapshot.scope?.selectedProductId;
      const liveProduct = liveStore.selectedProductId || liveStore.scope?.selectedProductId;
      if (expectedProduct !== liveProduct) {
        setStoreBusy(storeId, "collection", false);
        notify("采集已停止：等待期间产品范围发生变化，请在新范围重新开始。", "info", storeId);
        return;
      }
      const nextStore = {
        ...liveStore,
        reports: liveStore.reports.map((report, index) => report.status === "missing" ? { ...report, status: "imported", realFileAvailable: true, importedRows: 210 + index * 17, generatedAt: "2026-08-28T15:44:00+08:00", importedAt: "2026-08-28T15:45:00+08:00", error: null } : report),
        importRun: { ...liveStore.importRun, status: "validated", reportTypesImported: 8, reportTypesExpected: 8, sourceFiles: 8 },
      };
      setModelState((current) => updateStoreState(current, storeId, nextStore));
      setStoreBusy(storeId, "collection", false);
      updateRuntime(storeId, (current) => invalidateAnalysisScope(current, normalizeStoreForRuntime(nextStore), "数据批次已更新"));
      notify("8 类报表已逐类完成下载、校验和入库，可以开始新分析。", "success", storeId);
    }, 850);
  }, [modelState.activeStoreId, modelState.stores, notify, operationsByStore, schedule, setStoreBusy, updateRuntime]);

  const retryConnection = useCallback(() => {
    const storeId = modelState.activeStoreId;
    const nextStore = {
      ...activeStore,
      session: { ...(activeStore.session || {}), status: "ready", label: "领星会话正常" },
      connections: {
        ...(activeStore.connections || {}),
        erp: { ...(activeStore.connections?.erp || {}), status: "ready", verifiedAt: "2026-08-28 15:45" },
        ads: { ...(activeStore.connections?.ads || {}), status: "ready", storeMatched: "verified", verifiedAt: "2026-08-28 15:45" },
      },
      adsIdentity: { ...(activeStore.adsIdentity || {}), status: "verified", storeMatched: true, canonicalObjectReady: true, verifiedAt: "2026-08-28 15:45" },
    };
    setModelState((current) => updateStoreState(current, storeId, nextStore));
    notify(`已重新识别 ${visibleStore(nextStore)} 的 Ads 账户并确认当前店铺；这是原型模拟结果。`, "success");
  }, [activeStore, modelState.activeStoreId, notify]);

  const createPolicyDraftAction = useCallback(() => {
    const storeId = modelState.activeStoreId;
    const next = createPolicyDraft(settingsByStore[storeId]);
    updateSettings(storeId, next);
    updateRuntime(storeId, (current) => ({
      ...current,
      policyAuthority: { ...current.policyAuthority, status: "draft", versionLabel: null, managedBySettings: true },
    }));
    notify(next.feedback.message, next.feedback.tone, storeId);
  }, [modelState.activeStoreId, notify, settingsByStore, updateRuntime, updateSettings]);

  const checkPolicyDraftAction = useCallback(() => {
    const storeId = modelState.activeStoreId;
    const result = checkPolicyDraft(settingsByStore[storeId]);
    updateSettings(storeId, result.state);
    notify(result.ok ? result.reason : `策略检查未通过：${result.reason}`, result.ok ? "success" : "danger", storeId);
  }, [modelState.activeStoreId, notify, settingsByStore, updateSettings]);

  const enablePolicyDraftAction = useCallback(() => {
    const storeId = modelState.activeStoreId;
    const result = enablePolicyDraft(settingsByStore[storeId]);
    updateSettings(storeId, result.state);
    if (result.ok) {
      const storeSnapshot = normalizeStoreForRuntime(modelRef.current.stores[storeId]);
      updateRuntime(storeId, (current) => {
        const invalidated = invalidateAnalysisScope(current, storeSnapshot, "策略版本已更新");
        return {
          ...invalidated,
          policyAuthority: {
            status: "enabled",
            versionLabel: result.state.policy.versionLabel,
            selectedProductBound: true,
            currentValueFresh: true,
            managedBySettings: true,
          },
        };
      });
    }
    notify(result.ok ? "策略已启用；旧分析已退出当前待办，请基于新版本重新分析。" : result.reason, result.ok ? "success" : "danger", storeId);
  }, [modelState.activeStoreId, notify, settingsByStore, updateRuntime, updateSettings]);

  const saveSystemConfig = useCallback((request) => {
    const storeId = modelState.activeStoreId;
    const result = updateStoreConfig(settingsByStore[storeId], request);
    updateSettings(storeId, result.state);
    if (result.ok) {
      updateRuntime(storeId, (current) => ({ ...current, systemConfig: { ...result.state.config } }));
    }
    notify(result.ok ? result.reason : `配置保存失败：${result.reason}`, result.ok ? (result.state.config.killSwitch ? "danger" : "success") : "danger", storeId);
  }, [modelState.activeStoreId, notify, settingsByStore, updateRuntime, updateSettings]);

  const toggleAutomation = useCallback((taskId) => {
    const storeId = modelState.activeStoreId;
    const next = toggleAutomationTask(settingsByStore[storeId], taskId);
    updateSettings(storeId, next);
    const task = next.automationTasks.find((item) => item.id === taskId);
    notify(`${task?.name || "自动任务"}已${task?.enabled ? "启用" : "停用"}；只作用于当前店铺。`, "success", storeId);
  }, [modelState.activeStoreId, notify, settingsByStore, updateSettings]);

  const runAutomation = useCallback((taskId) => {
    const storeId = modelState.activeStoreId;
    const storeSnapshot = normalizeStoreForRuntime(activeStore);
    const task = settingsByStore[storeId].automationTasks.find((item) => item.id === taskId);
    const connection = getConnectionState(storeSnapshot);
    const requiresAds = /广告|回读|量化/.test(task?.name || "");
    const failed = requiresAds && (!connection.adsReady || !connection.storeIdentityReady);
    const result = runAutomationTask(settingsByStore[storeId], taskId, failed
      ? { outcome: "failed", reason: "Ads 店铺身份尚未确认" }
      : { outcome: "success" });
    updateSettings(storeId, result.state);
    notify(result.ok ? result.reason : `任务未运行：${result.reason}`, result.ok && !failed ? "success" : "danger", storeId);
  }, [activeStore, modelState.activeStoreId, notify, settingsByStore, updateSettings]);

  const selectAdObject = useCallback((objectKey) => {
    const storeId = modelState.activeStoreId;
    const storeSnapshot = normalizeStoreForRuntime(activeStore);
    const next = selectAdObjectInRuntime(runtimesRef.current[storeId], storeSnapshot, objectKey);
    updateRuntime(storeId, next);
    notify(next.feedback?.message || "广告对象已选择。", next.feedback?.tone || "info", storeId);
  }, [activeStore, modelState.activeStoreId, notify, updateRuntime]);

  const verifyAdObject = useCallback((objectKey) => {
    const storeId = modelState.activeStoreId;
    const storeSnapshot = normalizeStoreForRuntime(activeStore);
    const next = verifyAdObjectInRuntime(runtimesRef.current[storeId], storeSnapshot, objectKey);
    updateRuntime(storeId, next);
    notify(next.feedback?.message || "广告对象核验已完成。", next.feedback?.tone || "info", storeId);
  }, [activeStore, modelState.activeStoreId, notify, updateRuntime]);

  const updateRecommendation = useCallback((recommendationId, status) => {
    const storeId = modelState.activeStoreId;
    updateRuntime(storeId, (current) => {
      const next = {
        ...current,
        activeRecommendations: current.activeRecommendations.map((item) => item.id === recommendationId ? { ...item, status } : item),
        analysisRuns: current.analysisRuns.map((run) => ({ ...run, recommendations: (run.recommendations || []).map((item) => item.id === recommendationId ? { ...item, status } : item) })),
      };
      if (status === "approved") next.approvals = [...next.approvals.filter((item) => item.recommendationId !== recommendationId), { recommendationId, runId: current.activeRunId, status: "approved", actor: "人工", decidedAt: "2026-08-28 15:46" }];
      return next;
    });
  }, [modelState.activeStoreId, updateRuntime]);

  const sendToApproval = useCallback((recommendationId) => {
    updateRecommendation(recommendationId, "pending_approval");
    navigate("decisions", "approval");
    notify("建议已提交人工审批；来源与版本保持绑定。", "info");
  }, [navigate, notify, updateRecommendation]);

  const approveRecommendation = useCallback((recommendationId) => {
    updateRecommendation(recommendationId, "approved");
    notify("执行许可已签发。批准不等于已执行，请前往实时执行核验安全门。", "success");
  }, [notify, updateRecommendation]);

  const rejectRecommendation = useCallback((recommendationId) => {
    updateRecommendation(recommendationId, "rejected");
    notify("建议已拒绝，不会进入执行队列。", "info");
  }, [notify, updateRecommendation]);

  const createExperimentAction = useCallback((draft) => {
    const storeId = modelState.activeStoreId;
    const activeRun = runtime.analysisRuns.find((item) => item.id === runtime.activeRunId);
    if (!activeRun || activeRun.status !== "completed" || !draft.adObjectKey) {
      notify("实验创建已阻断：请先完成当前范围分析并选择一个可核验广告对象。", "danger");
      return;
    }
    const product = selectedProduct(activeStore);
    const recommendation = runtime.activeRecommendations.find((item) => item.adObjectKey === draft.adObjectKey);
    updateRuntime(storeId, (current) => createExperiment(current, {
      name: draft.name,
      hypothesis: draft.hypothesis,
      primaryMetric: draft.metric,
      target: draft.target,
      guardrails: [draft.guardrail],
      observationWindow: draft.duration,
      productKey: product?.id || product?.asin,
      productLabel: product?.title,
      adObjectKey: draft.adObjectKey,
      adObjectLabel: draft.adObjectLabel,
      recommendationId: recommendation?.id || null,
    }));
    notify("经营实验草稿已创建，并已绑定当前分析、产品和广告对象。", "success");
  }, [activeStore, modelState.activeStoreId, notify, runtime.activeRunId, runtime.analysisRuns, updateRuntime]);

  const toggleExperiment = useCallback((experimentId) => {
    const storeId = modelState.activeStoreId;
    const storeSnapshot = normalizeStoreForRuntime(activeStore);
    const current = runtimesRef.current[storeId];
    const experiment = current.experiments.find((item) => item.id === experimentId);
    const action = experiment?.status === "running"
      ? "complete"
      : ["completed", "stopped"].includes(experiment?.status)
        ? "restart"
        : "start";
    const result = transitionExperiment(current, storeSnapshot, experimentId, action, action === "complete" ? {
      result: "观察窗口内 ACOS 改善 11.2%，订单下降 3.1%，守护指标未触发。",
    } : {});
    updateRuntime(storeId, result.runtime);
    notify(
      result.ok ? result.reason : `实验操作已阻断：${result.reason}`,
      result.ok ? "success" : "danger",
      storeId,
    );
  }, [activeStore, modelState.activeStoreId, notify, updateRuntime]);

  const startExecution = useCallback(() => {
    const storeId = modelState.activeStoreId;
    if (operationsByStore[storeId]?.execution) return;
    const storeSnapshot = normalizeStoreForRuntime(activeStore);
    const gate = normalizedGate(storeSnapshot, runtime);
    if (!gate.allowed) { notify(`执行已阻断：${gate.reasons[0] || "前置条件未满足"}`, "danger"); return; }
    const expectedAuthority = captureExecutionAuthority(storeSnapshot, runtime);
    setStoreBusy(storeId, "execution", true);
    schedule(() => {
      const liveStore = normalizeStoreForRuntime(modelRef.current.stores[storeId]);
      const liveRuntime = runtimesRef.current[storeId];
      const result = commitExecution(liveStore, liveRuntime, expectedAuthority);
      updateRuntime(storeId, result.runtime);
      setStoreBusy(storeId, "execution", false);
      notify(
        result.ok
          ? "模拟执行已完成保存，正在等待页面刷新回读；未产生真实 Ads 写入。"
          : `执行已停止：${result.reason}`,
        result.ok ? "success" : "danger",
        storeId,
      );
    }, 900);
  }, [activeStore, modelState.activeStoreId, notify, operationsByStore, runtime, schedule, setStoreBusy, updateRuntime]);

  const completeReadback = useCallback((outcome = "verified") => {
    const storeId = modelState.activeStoreId;
    const storeSnapshot = normalizeStoreForRuntime(activeStore);
    const current = runtimesRef.current[storeId];
    const observedValues = Object.fromEntries((current.executionRecords || [])
      .filter((record) => record.status === "awaiting_readback")
      .map((record) => [
        record.recommendationId,
        outcome === "mismatch" ? Number(record.savedValue) + 0.01 : record.savedValue,
      ]));
    const result = verifyExecutionReadback(storeSnapshot, current, observedValues);
    updateRuntime(storeId, result.runtime);
    notify(
      result.ok
        ? "刷新回读已完成：独立观察值与保存值一致，证据已进入当前店铺因果记忆。"
        : `刷新回读失败：${result.reason} 请人工接管并重新核验对象。`,
      result.ok ? "success" : "danger",
      storeId,
    );
  }, [activeStore, modelState.activeStoreId, notify, updateRuntime]);

  const changeMode = useCallback((mode) => {
    const storeId = modelState.activeStoreId;
    const policyCanApprove = mode === "auto" && activeStore.policyAuthority?.status === "enabled";
    updateRuntime(storeId, (current) => {
      const activeRunId = current.activeRunId;
      const humanApproved = new Set((current.approvals || [])
        .filter((item) => item.runId === activeRunId && item.status === "approved" && item.actor !== "已启用策略")
        .map((item) => item.recommendationId));
      const candidates = current.activeRecommendations.filter((item) => ["waiting_approval", "pending_approval", "approved"].includes(item.status));
      const approvals = policyCanApprove
        ? [
            ...(current.approvals || []).filter((item) => !(item.runId === activeRunId && item.actor === "已启用策略")),
            ...candidates.filter((item) => !humanApproved.has(item.id)).map((item) => ({ recommendationId: item.id, runId: activeRunId, status: "approved", actor: "已启用策略", decidedAt: "2026-08-28 15:46" })),
          ]
        : (current.approvals || []).filter((item) => !(item.runId === activeRunId && item.actor === "已启用策略"));
      const recommendationStatus = (item) => {
        if (!["waiting_approval", "pending_approval", "approved"].includes(item.status)) return item.status;
        if (policyCanApprove || humanApproved.has(item.id)) return "approved";
        return "waiting_approval";
      };
      return {
        ...current,
        autonomyMode: mode,
        approvals,
        activeRecommendations: current.activeRecommendations.map((item) => ({ ...item, status: recommendationStatus(item) })),
        analysisRuns: current.analysisRuns.map((run) => ({ ...run, recommendations: (run.recommendations || []).map((item) => ({ ...item, status: run.id === activeRunId ? recommendationStatus(item) : item.status })) })),
      };
    });
    setModeDialogOpen(false);
    notify(`已将 ${visibleStore(activeStore)} 切换为“${AUTONOMY_MODES.find((item) => item.id === mode)?.label}”；模式仅作用于当前店铺。`, "success");
  }, [activeStore, modelState.activeStoreId, notify, updateRuntime]);

  const coverage = getReportCoverage(activeStore);
  const currentRuntime = runtimeView(runtime);
  const gate = normalizedGate(activeStore, runtime);
  const activeOperations = operationsByStore[modelState.activeStoreId] || {};
  const collectionBusy = activeOperations.collection === true;
  const executionBusy = activeOperations.execution === true;
  const toast = toastsByStore[modelState.activeStoreId] || null;
  const ledger = [
    ...buildLedger(activeStore),
    ...(runtime.executionRecords || []).map((record) => ({
      id: `runtime-${record.recommendationId}-${record.status}`,
      time: (record.readbackAt || record.executedAt || "").slice(-5),
      kind: record.status === "verified" ? "outcome" : "action",
      title: record.status === "verified" ? "关键词竞价刷新回读完成" : "关键词竞价已保存",
      detail: `${record.objectLabel || "当前关键词"} · ${record.beforeValue} → ${record.savedValue}`,
      status: record.status === "verified" ? "保存值与刷新值一致" : "等待刷新回读",
    })),
  ];
  const memories = runtime.causalMemories || deriveCausalMemories(normalizeStoreForRuntime(activeStore), runtime);
  const storeList = Object.values(modelState.stores);
  const module = MODULES.find((item) => item.id === route.workspace) || MODULES[0];

  const actions = useMemo(() => ({
    navigate,
    switchStore,
    selectProduct,
    selectAdObject,
    verifyAdObject,
    runAnalysis,
    collectReports,
    collectionBusy,
    sendToApproval,
    approveRecommendation,
    rejectRecommendation,
    startExecution,
    executionBusy,
    createExperiment: createExperimentAction,
    toggleExperiment,
    completeReadback,
    retryConnection,
    createPolicyDraft: createPolicyDraftAction,
    checkPolicyDraft: checkPolicyDraftAction,
    enablePolicyDraft: enablePolicyDraftAction,
    saveSystemConfig,
    toggleAutomation,
    runAutomation,
  }), [approveRecommendation, checkPolicyDraftAction, collectReports, collectionBusy, completeReadback, createExperimentAction, createPolicyDraftAction, enablePolicyDraftAction, executionBusy, navigate, rejectRecommendation, retryConnection, runAnalysis, runAutomation, saveSystemConfig, selectAdObject, selectProduct, sendToApproval, startExecution, switchStore, toggleAutomation, toggleExperiment, verifyAdObject]);

  return (
    <div className="ops-app">
      <AppTopbar store={activeStore} stores={storeList} runtime={runtime} onStoreChange={switchStore} onOpenMode={() => setModeDialogOpen(true)} onNavigate={navigate} />
      <div className="ops-app-body">
        <Sidebar route={route} onNavigate={navigate} />
        <main className="ops-main">
          <div className="ops-main-head"><div><span>{module.label}</span><small>{module.description}</small></div><div className="ops-simulation"><ShieldCheck size={14} weight="fill" />交互原型 · 模拟数据 · 不写入领星或 Amazon Ads</div></div>
          <SubviewTabs route={route} onNavigate={navigate} />
          <div aria-label={module.subviews.length <= 1 ? module.label : undefined} aria-labelledby={module.subviews.length > 1 ? `ops-tab-${route.workspace}-${route.subview}` : undefined} className="ops-content" id={`ops-panel-${route.workspace}-${route.subview}`} role="tabpanel" tabIndex={0}>
            <PrototypeWorkspace route={route} store={activeStore} stores={storeList} runtime={currentRuntime} settings={settings} coverage={coverage} gate={gate} ledger={ledger} memories={memories} capabilities={INTERNAL_CAPABILITIES} actions={actions} />
          </div>
        </main>
      </div>
      {modeDialogOpen && <ModeDialog runtime={runtime} onClose={() => setModeDialogOpen(false)} onConfirm={changeMode} />}
      {toast && <div className={`ops-toast is-${toast.tone}`} role="status">{toast.tone === "danger" ? <LockKey size={17} /> : <CheckCircle size={17} weight="fill" />}<span>{toast.message}</span></div>}
    </div>
  );
}

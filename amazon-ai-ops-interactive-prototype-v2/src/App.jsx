import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { repository, selectors } from "./domain.js";
import { WORKSPACES, getWorkspace, normalizeRoute } from "./spec.js";
import {
  AppShell,
  Inspector,
  Sidebar,
  ToastViewport,
  Topbar,
} from "./ui.jsx";
import { WorkspaceRouter } from "./workspaces.jsx";

let toastSequence = 0;

function applyInitialLocation() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const requestedStoreId = params.get("store");
  const requestedWorkspace = params.get("workspace");
  const requestedSubview = params.get("subview");
  const storeId = requestedStoreId && repository.getSnapshot().stores[requestedStoreId]
    ? requestedStoreId
    : repository.getSnapshot().manifest.activeStoreId;
  if (storeId !== repository.getSnapshot().manifest.activeStoreId) {
    repository.command("switchStore", { storeId });
  }
  if (requestedWorkspace) {
    repository.command("navigate", {
      storeId,
      ...normalizeRoute({ workspace: requestedWorkspace, subview: requestedSubview }),
    });
  }
}

applyInitialLocation();

export function App() {
  const snapshot = useSyncExternalStore(
    repository.subscribe,
    repository.getSnapshot,
    repository.getSnapshot,
  );
  const [inspectedItem, setInspectedItem] = useState(null);
  const [toasts, setToasts] = useState([]);

  const activeStoreId = snapshot.manifest.activeStoreId;
  const store = snapshot.stores[activeStoreId];
  const route = normalizeRoute(snapshot.manifest.navigationByStore[activeStoreId]);
  const workspace = getWorkspace(route.workspace);
  const badges = useMemo(
    () => selectors.selectWorkspaceBadges(snapshot, activeStoreId),
    [activeStoreId, snapshot],
  );

  const pushToast = useCallback((message, tone = "success") => {
    const id = `toast-${++toastSequence}`;
    setToasts((current) => [...current, { id, message, tone }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }, []);

  const command = useCallback(
    (type, payload = {}, options = {}) => {
      const result = repository.command(type, {
        ...payload,
        storeId: payload.storeId ?? activeStoreId,
      });
      if (result.ok) {
        if (options.success !== false) {
          pushToast(options.success ?? result.message ?? "操作已保存", "success");
        }
      } else {
        pushToast(result.message ?? "操作失败，请重试", "danger");
      }
      return result;
    },
    [activeStoreId, pushToast],
  );

  const navigate = useCallback(
    (nextWorkspace, nextSubview) => {
      const next = normalizeRoute({
        workspace: nextWorkspace,
        subview: nextSubview,
      });
      const result = command("navigate", next, { success: false });
      if (result.ok) setInspectedItem(null);
      return result;
    },
    [command],
  );

  const changeStore = useCallback(
    (storeId) => {
      const result = repository.command("switchStore", { storeId });
      if (result.ok) {
        setInspectedItem(null);
        pushToast(`已切换到 ${storeId}，视图与草稿已隔离`, "info");
      } else {
        pushToast(result.message ?? "当前写入未结束，暂时不能切换店铺", "danger");
      }
    },
    [pushToast],
  );

  useEffect(() => {
    setInspectedItem(null);
  }, [route.workspace, route.subview]);

  useEffect(() => {
    const params = new URLSearchParams({
      store: activeStoreId,
      workspace: route.workspace,
      subview: route.subview,
    });
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [activeStoreId, route.subview, route.workspace]);

  const storeCatalog = snapshot.manifest.storeIds.map((storeId) => ({
    id: storeId,
    name: snapshot.stores[storeId]?.config?.name ?? storeId,
    marketplace: snapshot.stores[storeId]?.config?.marketplace ?? "",
  }));
  const currentProduct = selectors.selectCurrentProduct(snapshot, activeStoreId);
  const reportCoverage = selectors.selectReportCoverage(snapshot, activeStoreId);
  const topbarStore = {
    ...store,
    id: activeStoreId,
    name: store.config.name,
    marketplace: store.config.marketplace,
    sessionLabel: store.session.status === "ready" ? "领星会话正常" : "领星会话需处理",
    reportStatus: `${reportCoverage.available}/${reportCoverage.expected} 类报表`,
    scope: {
      ...store.scope,
      range: `${store.scope.dateFrom} ～ ${store.scope.dateTo}`,
      object: currentProduct?.sku ?? "未锁定产品",
    },
  };

  return (
    <AppShell
      topbar={
        <Topbar
          stores={storeCatalog}
          activeStoreId={activeStoreId}
          onStoreChange={changeStore}
          store={topbarStore}
          mode={store.autonomy.mode}
          onModeChange={(mode) =>
            command("setMode", { mode, reason: "顶部模式切换" }, {
              success: mode === "auto" ? "已切换为 AI 全自动（受店铺策略边界约束）" : "已切换为人工审批",
            })
          }
          onOpenInspector={() => setInspectedItem({
            type: "store",
            title: `${activeStoreId} · ${store.config.name}`,
            subtitle: "当前店铺运行边界",
            fields: [
              ["浏览器会话", store.session.status],
              ["执行模式", store.autonomy.mode === "auto" ? "AI 全自动" : "人工审批"],
              ["当前产品", currentProduct?.sku ?? "未锁定"],
              ["数据修订", `r${store.revision}`],
            ],
          })}
        />
      }
      sidebar={
        <Sidebar
          workspaces={WORKSPACES}
          route={route}
          badges={badges}
          onNavigate={(next) => navigate(
            typeof next === "string" ? next : next.workspace,
            typeof next === "string" ? getWorkspace(next).subviews[0].id : next.subview,
          )}
        />
      }
      inspector={
        <Inspector
          open={Boolean(inspectedItem)}
          item={inspectedItem}
          onClose={() => setInspectedItem(null)}
        />
      }
      inspectorOpen={Boolean(inspectedItem)}
    >
      <WorkspaceRouter
        key={`${activeStoreId}:${route.workspace}:${route.subview}`}
        store={store}
        route={route}
        workspace={workspace}
        command={command}
        onNavigate={navigate}
        onInspect={setInspectedItem}
      />
      <ToastViewport
        toasts={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((toast) => toast.id !== id))
        }
      />
    </AppShell>
  );
}

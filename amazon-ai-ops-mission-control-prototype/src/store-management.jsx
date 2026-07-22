import { useMemo, useState } from "react";
import {
  Archive,
  ArrowCounterClockwise,
  PencilSimple,
  Plus,
  Storefront,
  Trash,
} from "@phosphor-icons/react";
import { Badge, Button, ConfirmDialog, DataTable, Field, Modal, Panel } from "./primitives.jsx";
import { US_MARKET_IDENTITY, withUsMarketIdentity } from "./us-market.js";

const EMPTY_FORM = {
  id: "",
  name: "",
  ...US_MARKET_IDENTITY,
  lingxingAccount: "",
  browserProfileId: "",
};

function editableForm(store) {
  if (!store) return { ...EMPTY_FORM };
  return withUsMarketIdentity({
    id: store.id || store.code || "",
    name: store.name || "",
    lingxingAccount: store.lingxingAccount || store.session?.lingxing?.account || store.id || "",
    browserProfileId: store.browserProfileId || store.session?.profile || `${String(store.id || "store").toLowerCase()}-profile`,
  });
}

function hasIdentityHistory(store) {
  const hasLiveRecords = ["products", "adObjects", "collectionRuns", "reportImports", "missions", "decisions", "experiments", "executionQueue", "operationEvents", "policies"]
    .some((key) => Array.isArray(store?.[key]) && store[key].length > 0);
  const configurationOnlyTypes = new Set(["store", "settings", "session", "credential"]);
  const hasHistoricalRecords = ["causalLedger", "audit"].some((key) => Array.isArray(store?.[key]) && store[key]
    .some((entry) => !configurationOnlyTypes.has(String(entry.entityType || ""))));
  return hasLiveRecords || hasHistoricalRecords;
}

export function StoreManagement({ stores = [], activeStoreId, dispatch, notify, onSwitchStore }) {
  const [editor, setEditor] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [errors, setErrors] = useState({});
  const rows = useMemo(() => [...stores].sort((left, right) => left.id.localeCompare(right.id)), [stores]);
  const form = editor?.form || EMPTY_FORM;
  const editingStore = editor?.record || null;
  const identityLocked = Boolean(editingStore && hasIdentityHistory(editingStore));

  const update = (field, value) => {
    setEditor((current) => ({ ...current, form: { ...current.form, [field]: value } }));
    setErrors((current) => ({ ...current, [field]: null }));
  };

  const validate = () => {
    const next = {};
    if (!/^[A-Z0-9][A-Z0-9_-]{2,15}$/.test(form.id.trim().toUpperCase())) next.id = "请输入 3–16 位大写编码。";
    if (!form.name.trim()) next.name = "请输入店铺名称。";
    if (!form.lingxingAccount.trim()) next.lingxingAccount = "请输入当前运营者可登录的领星账号标识。";
    if (!form.browserProfileId.trim()) next.browserProfileId = "请输入独立浏览器 Profile。";
    else if (rows.some((store) => store.id !== editingStore?.id && String(store.browserProfileId || store.session?.profile || `${store.id.toLowerCase()}-profile`).trim().toLowerCase() === form.browserProfileId.trim().toLowerCase())) next.browserProfileId = "该 Profile 已被其他店铺占用，不能复用 Cookie 与浏览器数据。";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = () => {
    if (!validate()) return;
    const normalized = withUsMarketIdentity({ ...form, id: form.id.trim().toUpperCase(), code: form.id.trim().toUpperCase() });
    const type = editingStore ? "UPDATE_STORE" : "CREATE_STORE";
    const validation = dispatch({ type, targetStoreId: normalized.id, store: normalized, actor: "human" });
    if (validation?.ok === false) {
      notify?.(validation.message, "danger");
      return;
    }
    notify?.(editingStore ? `店铺 ${normalized.id} 配置已更新` : `已创建独立店铺 ${normalized.id}`, "success");
    setEditor(null);
  };

  const mutate = (type, store) => {
    const validation = dispatch({ type, targetStoreId: store.id, actor: "human" });
    if (validation?.ok === false) {
      notify?.(validation.message, "danger");
      return;
    }
    const messages = {
      ARCHIVE_STORE: `店铺 ${store.id} 已归档`,
      RESTORE_STORE: `店铺 ${store.id} 已恢复`,
      DELETE_STORE: `空店铺 ${store.id} 已永久删除`,
    };
    notify?.(messages[type], type === "DELETE_STORE" ? "info" : "success");
    setConfirm(null);
  };

  const columns = [
    {
      key: "store",
      header: "店铺数据域",
      render: (store) => <div className="store-identity-cell"><span className="store-avatar-mini"><Storefront size={16} /></span><span><strong>{store.id}</strong><small>{store.name}</small></span></div>,
    },
    { key: "marketplace", header: "站点", render: (store) => <span>{store.marketplace}<small className="table-subline">{store.region} · {store.currency}</small></span> },
    { key: "profile", header: "本地 Profile", render: (store) => <span className="mono">{store.browserProfileId || store.session?.profile || `${store.id.toLowerCase()}-profile`}</span> },
    { key: "data", header: "独立数据", render: (store) => <span>{store.products?.length || 0} 产品<small className="table-subline">{store.missions?.length || 0} Mission · {store.audit?.length || 0} 审计</small></span> },
    { key: "status", header: "状态", render: (store) => { const ready = !store.profileConflict && store.session?.status === "connected" && store.session?.lingxing?.status === "connected" && store.session?.amazonAds?.status === "connected" && store.session?.amazonAds?.scope === "read_write_simulated"; const label = store.archived ? "已归档" : store.profileConflict ? "Profile 冲突" : ready ? "会话正常" : store.session?.lingxing?.status !== "connected" ? "领星待确认" : store.session?.amazonAds?.status !== "connected" ? "Ads 待登录" : "Ads 待授权"; return <Badge tone={store.profileConflict ? "danger" : store.archived ? "neutral" : ready ? "success" : "warning"}>{label}</Badge>; } },
    {
      key: "actions",
      header: "操作",
      render: (store) => (
        <div className="row-action-group store-row-actions">
          {!store.archived && store.id !== activeStoreId ? <Button size="small" variant="ghost" onClick={() => onSwitchStore?.(store.id)}>切换</Button> : null}
          {!store.archived ? <Button size="small" variant="ghost" leadingIcon={PencilSimple} onClick={() => { setErrors({}); setEditor({ record: store, form: editableForm(store) }); }}>编辑</Button> : null}
          {!store.archived ? <Button size="small" variant="ghost" leadingIcon={Archive} disabled={store.id === activeStoreId} title={store.id === activeStoreId ? "请先切换到其他店铺" : "归档店铺"} onClick={() => setConfirm({ type: "ARCHIVE_STORE", store })}>归档</Button> : <Button size="small" variant="ghost" leadingIcon={ArrowCounterClockwise} onClick={() => mutate("RESTORE_STORE", store)}>恢复</Button>}
          {store.archived ? <Button size="small" variant="danger" leadingIcon={Trash} onClick={() => setConfirm({ type: "DELETE_STORE", store })}>删除</Button> : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <Panel
        className="store-management-panel"
        eyebrow="STORE ISOLATION"
        title="店铺与数据域"
        description="第一版仅支持 Amazon US / USD。每个美国店铺仍拥有独立的产品、广告对象、会话、策略、Mission、审批与因果账本。"
        actions={<Button variant="primary" leadingIcon={Plus} onClick={() => { setErrors({}); setEditor({ record: null, form: { ...EMPTY_FORM } }); }}>新建店铺</Button>}
      >
        <DataTable columns={columns} rows={rows} caption="可配置店铺数据域" emptyTitle="还没有店铺" />
      </Panel>

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editingStore ? `编辑店铺 ${editingStore.id}` : "新建独立店铺"}
        description={identityLocked ? "该店铺已有业务数据；Amazon US、USD 和美国站业务时区保持锁定，名称与登录映射仍可维护。" : "第一版创建的所有店铺都固定为 Amazon US / USD，并使用统一的美国站业务时区。"}
        size="large"
        className="store-editor-modal"
        footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setEditor(null)}>取消</Button><Button variant="primary" onClick={save}>{editingStore ? "保存店铺配置" : "创建独立数据域"}</Button></div>}
      >
        <div className="form-grid two-column">
          <Field label="店铺编码" error={errors.id} hint="用于数据库分区与浏览器 Profile 映射，创建后不可修改。" required><input autoFocus={!editingStore} value={form.id} readOnly={Boolean(editingStore)} maxLength={16} onChange={(event) => update("id", event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} /></Field>
          <Field label="店铺名称" error={errors.name} required><input autoFocus={Boolean(editingStore)} value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="例如 Northstar Home · 美国站" /></Field>
          <Field label="Amazon 站点" hint="第一版固定为美国站，不提供其他站点选项。" required><input value={form.marketplace} readOnly /></Field>
          <Field label="区域 / 币种" hint="第一版固定为 US / USD。"><input value={`${form.region} · ${form.currency}`} readOnly /></Field>
          <Field label="业务时区"><input value={form.businessTimezone} readOnly /></Field>
          <Field label="领星账号映射" error={errors.lingxingAccount} required><input value={form.lingxingAccount} onChange={(event) => update("lingxingAccount", event.target.value)} placeholder="只保存账号标识，不显示密码" /></Field>
          <Field label="可见浏览器 Profile" error={errors.browserProfileId} hint="每个店铺独立 Profile，Cookie 与下载目录互不复用。" required><input value={form.browserProfileId} onChange={(event) => update("browserProfileId", event.target.value)} placeholder="例如 tst004-profile" /></Field>
        </div>
        <div className="store-isolation-contract"><strong>创建后自动获得</strong><span>空白本地数据域</span><span>人工审批模式</span><span>断开的会话</span><span>独立审计链</span></div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && mutate(confirm.type, confirm.store)}
        title={confirm?.type === "DELETE_STORE" ? `永久删除 ${confirm?.store.id}？` : `归档 ${confirm?.store.id}？`}
        description={confirm?.type === "DELETE_STORE" ? "仅空数据域可以永久删除；存在任何业务或因果记录时系统会阻断。" : "归档后不会出现在顶部切换器中；运行中的 Mission 或待回读动作会阻断归档。"}
        confirmLabel={confirm?.type === "DELETE_STORE" ? "确认永久删除" : "确认归档"}
      >
        <p className="confirm-object-name">{confirm?.store.name}</p>
      </ConfirmDialog>
    </>
  );
}

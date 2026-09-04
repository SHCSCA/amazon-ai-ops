import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const debugOrigin = process.env.CDP_ORIGIN || "http://127.0.0.1:9227";
const appUrl = process.env.PROTOTYPE_URL || "http://127.0.0.1:4175/";
const outputDir = process.env.QA_OUTPUT || path.resolve("evidence", "qa-20260720");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.events = [];
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      this.events.push(message);
      const waiters = this.eventWaiters.get(message.method) || [];
      this.eventWaiters.delete(message.method);
      waiters.forEach((resolve) => resolve(message.params));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const complete = (params) => {
        clearTimeout(timer);
        resolve(params);
      };
      const waiters = this.eventWaiters.get(method) || [];
      waiters.push(complete);
      this.eventWaiters.set(method, waiters);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(detail || "Runtime.evaluate failed");
    }
    return result.result.value;
  }

  async viewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  async navigate(url) {
    const loaded = this.waitFor("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
    await sleep(500);
  }

  async reload() {
    const loaded = this.waitFor("Page.loadEventFired");
    await this.send("Page.reload", { ignoreCache: true });
    await loaded;
    await sleep(500);
  }

  async screenshot(filename) {
    await this.evaluate("document.querySelector('.app-content') && (document.querySelector('.app-content').scrollTop = 0)");
    const result = await this.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(path.join(outputDir, filename), Buffer.from(result.data, "base64"));
  }

  close() {
    this.socket.close();
  }
}

async function createPage() {
  const response = await fetch(`${debugOrigin}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Cannot create CDP page: HTTP ${response.status}`);
  return response.json();
}

function browserExpression(body) {
  return `(() => { ${body} })()`;
}

const normalizeTextScript = `const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();`;

async function clickText(client, text, selector = "button", exact = false) {
  const result = await client.evaluate(browserExpression(`
    ${normalizeTextScript}
    const target = ${JSON.stringify(text)};
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((node) => node.getClientRects().length && !node.disabled);
    const exactMatch = ${exact ? "true" : "false"};
    const labelOf = (candidate) => normalize(candidate.getAttribute('aria-label') || candidate.textContent);
    const node = nodes.find((candidate) => exactMatch
      ? labelOf(candidate) === target
      : labelOf(candidate).startsWith(target));
    if (!node) return { ok: false, available: nodes.map(labelOf).slice(0, 80) };
    node.click();
    return { ok: true, text: normalize(node.textContent) };
  `));
  if (!result.ok) throw new Error(`Button not found: ${text}; available=${JSON.stringify(result.available)}`);
  await sleep(260);
  return result;
}

async function fillField(client, label, value) {
  const result = await client.evaluate(browserExpression(`
    ${normalizeTextScript}
    const labelText = ${JSON.stringify(label)};
    const field = [...document.querySelectorAll('label.field')].find((candidate) => {
      const heading = candidate.querySelector('.field__label strong');
      return normalize(heading?.textContent).replace(/\\s*\\*$/, '') === labelText;
    });
    const control = field?.querySelector('input, textarea');
    if (!control) return { ok: false };
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    setter.call(control, ${JSON.stringify(value)});
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: control.value };
  `));
  if (!result.ok) throw new Error(`Field not found: ${label}`);
  await sleep(100);
}

async function selectField(client, label, value) {
  const result = await client.evaluate(browserExpression(`
    ${normalizeTextScript}
    const labelText = ${JSON.stringify(label)};
    const field = [...document.querySelectorAll('label.field')].find((candidate) => {
      const heading = candidate.querySelector('.field__label strong');
      return normalize(heading?.textContent).replace(/\\s*\\*$/, '') === labelText;
    });
    const control = field?.querySelector('select');
    if (!control) return { ok: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(control, ${JSON.stringify(value)});
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: control.value };
  `));
  if (!result.ok) throw new Error(`Select field not found: ${label}`);
  await sleep(100);
}

async function switchStore(client, storeId) {
  const result = await client.evaluate(browserExpression(`
    const control = document.querySelector('[aria-label="切换店铺"]');
    if (!control) return { ok: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(control, ${JSON.stringify(storeId)});
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: control.value };
  `));
  if (!result.ok) throw new Error("Store selector not found");
  await sleep(350);
}

async function pageState(client) {
  return client.evaluate(browserExpression(`
    ${normalizeTextScript}
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
    const sidebar = document.querySelector('.app-sidebar')?.getBoundingClientRect();
    const content = document.querySelector('.app-content');
    const frame = document.querySelector('.workspace-page-frame')?.getBoundingClientRect();
    const overflowing = [...document.querySelectorAll('#main-content *')].filter((element) => {
      if (!element.getClientRects().length || element.clientWidth <= 0) return false;
      const style = getComputedStyle(element);
      const intentional = /auto|scroll|hidden|clip/.test(style.overflowX);
      return !intentional && element.scrollWidth > element.clientWidth + 2;
    }).slice(0, 12).map((element) => ({ className: element.className, text: normalize(element.textContent).slice(0, 80), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    return {
      width: innerWidth,
      height: innerHeight,
      h1: normalize(document.querySelector('h1')?.textContent),
      activeTab: normalize(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent),
      store: document.querySelector('[aria-label="切换店铺"]')?.value,
      topbarHeight: Math.round(topbar?.height || 0),
      sidebarWidth: Math.round(sidebar?.width || 0),
      frameLeft: Math.round(frame?.left || 0),
      bodyFits: document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth,
      contentOverflowY: content ? getComputedStyle(content).overflowY : null,
      overflowCandidates: overflowing,
      modalOpen: Boolean(document.querySelector('[role="dialog"]')),
      inspector: document.querySelector('.responsive-inspector') ? {
        width: Math.round(document.querySelector('.responsive-inspector').getBoundingClientRect().width),
        mode: document.querySelector('.responsive-inspector--inline') ? 'inline' : 'drawer',
      } : null,
    };
  `));
}

const routeCases = [
  ["今日巡航", null, "今日巡航"],
  ["产品工作台", "产品", "产品工作台"],
  ["产品工作台", "量化目标", "量化目标"],
  ["产品工作台", "运营事件", "运营事件"],
  ["数据准备", "采集范围", "采集范围"],
  ["数据准备", "报表采集", "报表采集"],
  ["数据准备", "导入校验", "导入校验"],
  ["广告诊断", null, "量化诊断"],
  ["建议与审批", "建议队列", "建议队列"],
  ["建议与审批", "人工审批", "人工审批"],
  ["建议与审批", "决策账本", "决策账本"],
  ["执行与回读", null, "执行与回读"],
  ["关键词与 Listing", "关键词机会", "关键词机会"],
  ["关键词与 Listing", "Listing 优化", "Listing 优化"],
  ["系统与交付", "系统设置", "系统设置"],
  ["系统与交付", "定时任务", "定时任务"],
  ["系统与交付", "交付检查", "交付检查"],
];

async function main() {
  await mkdir(outputDir, { recursive: true });
  const page = await createPage();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.viewport(1440, 900);
  await client.navigate(appUrl);
  await client.evaluate("localStorage.clear()");
  await client.reload();

  const results = {
    generatedAt: new Date().toISOString(),
    appUrl,
    routeChecks: [],
    interactionChecks: [],
    layoutChecks: [],
    consoleErrors: [],
  };

  await client.screenshot("02-today-cdp-1440.png");

  for (const [workspaceLabel, tabLabel, expectedTitle] of routeCases) {
    await clickText(client, workspaceLabel, ".nav-item");
    if (tabLabel) await clickText(client, tabLabel, '[role="tab"]', true);
    const state = await pageState(client);
    results.routeChecks.push({ workspaceLabel, tabLabel, expectedTitle, ...state, passed: state.h1 === expectedTitle && state.bodyFits });
  }

  await clickText(client, "产品工作台", ".nav-item");
  await clickText(client, "产品", '[role="tab"]', true);
  await clickText(client, "新增产品映射");
  await fillField(client, "SKU", "QA-SKU-0720");
  await fillField(client, "ASIN", "B0QA0720V2");
  await fillField(client, "产品名称", "V2 门店隔离交互测试产品");
  await selectField(client, "状态", "watch");
  await clickText(client, "保存产品", ".modal button");
  const createdInA = await client.evaluate("document.body.innerText.includes('QA-SKU-0720')");
  await switchStore(client, "LMX002");
  const leakedToB = await client.evaluate("document.body.innerText.includes('QA-SKU-0720')");
  await switchStore(client, "NOC003");
  const leakedToC = await client.evaluate("document.body.innerText.includes('QA-SKU-0720')");
  await switchStore(client, "SHC001");
  const restoredInA = await client.evaluate("document.body.innerText.includes('QA-SKU-0720')");
  await client.reload();
  const persistedAfterReload = await client.evaluate("document.body.innerText.includes('QA-SKU-0720')");
  results.interactionChecks.push({
    name: "产品 CRUD、刷新持久化与跨店隔离",
    createdInA,
    leakedToB,
    leakedToC,
    restoredInA,
    persistedAfterReload,
    passed: createdInA && !leakedToB && !leakedToC && restoredInA && persistedAfterReload,
  });

  await clickText(client, "系统与交付", ".nav-item");
  await clickText(client, "定时任务", '[role="tab"]', true);
  await clickText(client, "新增定时任务");
  await fillField(client, "任务名称", "QA 每日诊断");
  await selectField(client, "任务类型", "diagnosis");
  await fillField(client, "触发规则", "45 8 * * *");
  await clickText(client, "保存任务", ".modal button");
  const schedulerCreated = await client.evaluate("document.body.innerText.includes('QA 每日诊断')");
  results.interactionChecks.push({ name: "定时任务创建与 SelectField 值契约", schedulerCreated, passed: schedulerCreated });
  await client.screenshot("03-scheduler-1440.png");

  await clickText(client, "建议与审批", ".nav-item");
  await clickText(client, "建议队列", '[role="tab"]', true);
  await clickText(client, "生成建议");
  const clickedRecommendation = await client.evaluate(browserExpression(`
    const row = document.querySelector('.data-table tbody tr.is-interactive');
    row?.click();
    return Boolean(row);
  `));
  await sleep(300);
  const inspectorState = await pageState(client);
  results.interactionChecks.push({ name: "对象检查器上下文打开", clickedRecommendation, inspector: inspectorState.inspector, passed: clickedRecommendation && inspectorState.inspector?.mode === "inline" && inspectorState.inspector?.width === 360 });
  await client.screenshot("04-recommendations-inspector-1440.png");
  await clickText(client, "关闭检查器", '[aria-label="关闭检查器"]', true);
  const selectedForApproval = await client.evaluate(browserExpression(`
    const checkbox = document.querySelector('.data-table tbody input[type="checkbox"]');
    checkbox?.click();
    return Boolean(checkbox?.checked);
  `));
  await sleep(220);
  await clickText(client, "送审");
  await clickText(client, "人工审批", '[role="tab"]', true);
  await clickText(client, "批准原型许可");
  await fillField(client, "决定原因", "QA：事实批次、策略 revision 与调整边界已核对");
  await clickText(client, "批准并签发原型许可", ".modal button");
  const approvalRecorded = await client.evaluate("document.body.innerText.includes('操作已保存') && !document.body.innerText.includes('批准本次原型执行许可')");
  results.interactionChecks.push({ name: "送审、理由必填与批准确认", selectedForApproval, approvalRecorded, passed: selectedForApproval && approvalRecorded });

  await clickText(client, "执行与回读", ".nav-item");
  const simulationCopy = await client.evaluate("document.body.innerText.includes('所有执行与证据均为模拟') && document.body.innerText.includes('不会打开、修改或写入真实 Amazon Ads')");
  results.interactionChecks.push({ name: "执行页原型安全边界", simulationCopy, passed: simulationCopy });
  await client.screenshot("05-readback-1440.png");

  await clickText(client, "关键词与 Listing", ".nav-item");
  await clickText(client, "Listing 优化", '[role="tab"]', true);
  await client.screenshot("06-listing-1440.png");

  for (const [width, height] of [[1280, 800], [1920, 1080]]) {
    await client.viewport(width, height);
    await clickText(client, "今日巡航", ".nav-item");
    const state = await pageState(client);
    const expectedTopbar = width <= 1280 ? 82 : 52;
    const expectedSidebar = width <= 1280 ? 176 : 184;
    const passed = Math.abs(state.topbarHeight - expectedTopbar) <= 2 && state.sidebarWidth === expectedSidebar && state.bodyFits && state.contentOverflowY === "auto";
    results.layoutChecks.push({ width, height, expectedTopbar, expectedSidebar, ...state, passed });
    await client.screenshot(`07-today-${width}x${height}.png`);
  }

  await client.viewport(1280, 800);
  await clickText(client, "产品工作台", ".nav-item");
  await clickText(client, "产品", '[role="tab"]', true);
  const clickedProduct = await client.evaluate(browserExpression(`
    const row = document.querySelector('.data-table tbody tr.is-interactive');
    row?.click();
    return Boolean(row);
  `));
  await sleep(260);
  const drawerState = await pageState(client);
  results.interactionChecks.push({ name: "1280 对象检查器抽屉", clickedProduct, inspector: drawerState.inspector, passed: clickedProduct && drawerState.inspector?.mode === "drawer" && drawerState.inspector?.width === 460 && drawerState.bodyFits });
  await client.screenshot("10-product-inspector-drawer-1280x800.png");
  await clickText(client, "关闭检查器", '[aria-label="关闭检查器"]', true);

  await client.viewport(1400, 900);
  await clickText(client, "产品工作台", ".nav-item");
  await clickText(client, "产品", '[role="tab"]', true);
  await client.screenshot("08-product-reference-size-1400x900.png");
  await client.viewport(1200, 700);
  await clickText(client, "今日巡航", ".nav-item");
  await client.screenshot("09-today-reference-size-1200x700.png");

  results.consoleErrors = client.events
    .filter((event) => event.method === "Runtime.exceptionThrown" || (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error"))
    .map((event) => ({
      method: event.method,
      detail: event.params?.exceptionDetails?.exception?.description
        || event.params?.exceptionDetails?.text
        || event.params?.args?.map((item) => item.value || item.description).join(" "),
    }));
  results.passed = results.routeChecks.every((check) => check.passed)
    && results.interactionChecks.every((check) => check.passed)
    && results.layoutChecks.every((check) => check.passed)
    && results.consoleErrors.length === 0;

  await writeFile(path.join(outputDir, "qa-results.json"), JSON.stringify(results, null, 2));
  client.close();
  console.log(JSON.stringify(results, null, 2));
  if (!results.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

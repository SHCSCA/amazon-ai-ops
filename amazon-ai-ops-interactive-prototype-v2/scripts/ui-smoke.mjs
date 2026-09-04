import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9347;
const baseUrl = "http://127.0.0.1:4175/";
const outputDir = join(process.cwd(), "evidence", "qa-20260720");
const profileDir = join(tmpdir(), `amazon-ai-ops-v2-cdp-${Date.now()}`);
const results = [];
const browserErrors = [];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function record(name, passed, detail) {
  results.push({ name, passed: Boolean(passed), detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Chrome may still be opening its debugging socket.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  "--window-size=1440,900",
  "about:blank",
], { detached: false, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

chrome.stderr.on("data", () => {});

let socket;
let sequence = 0;
const pending = new Map();

try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const page = pages.find((item) => item.type === "page");
  if (!page) throw new Error("Chrome did not expose a page target");

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      browserErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "Runtime exception");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      browserErrors.push(message.params.args?.map((item) => item.value || item.description).join(" ") || "Console error");
    }
  });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression) => {
    const response = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result?.value;
  };

  const waitFor = async (expression, timeoutMs = 6000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return true;
      await delay(60);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };

  const navigate = async (query, expectedHeading) => {
    await call("Page.navigate", { url: `${baseUrl}${query}` });
    await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('h1'))", 10000);
    if (expectedHeading) {
      await waitFor(`document.querySelector('h1')?.textContent?.includes(${JSON.stringify(expectedHeading)})`, 8000);
    }
    await delay(80);
  };

  const clickButton = async (text, exact = false) => evaluate(`(() => {
    const target = ${JSON.stringify(text)};
    const button = [...document.querySelectorAll('button')].find((item) => {
      const value = item.textContent.trim();
      return !item.disabled && (${exact ? "value === target" : "value.includes(target)"});
    });
    if (!button) return false;
    button.click();
    return true;
  })()`);

  const fillField = async (labelText, value) => evaluate(`(() => {
    const label = [...document.querySelectorAll('label.field')].find((item) =>
      item.querySelector('.field__label strong')?.textContent?.trim().replace(/\\s+\\*$/, '') === ${JSON.stringify(labelText)}
    );
    const control = label?.querySelector('input, textarea, select');
    if (!control) return false;
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(control, ${JSON.stringify(value)});
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);

  const rowButton = async (rowText, buttonText) => evaluate(`(() => {
    const row = [...document.querySelectorAll('tr')].find((item) => item.textContent.includes(${JSON.stringify(rowText)}));
    const button = [...(row?.querySelectorAll('button') || [])].find((item) => item.textContent.trim().includes(${JSON.stringify(buttonText)}));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);

  await call("Runtime.enable");
  await call("Page.enable");
  await mkdir(outputDir, { recursive: true });
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await navigate("?workspace=today&subview=overview", "今日巡航");
  const wideLayout = await evaluate(`(() => ({
    horizontalFit: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    topbar: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
    sidebar: Math.round(document.querySelector('.app-sidebar').getBoundingClientRect().width),
    mainScrollOwner: getComputedStyle(document.querySelector('.app-content')).overflowY
  }))()`);
  record("1440 桌面壳层", wideLayout.horizontalFit && wideLayout.topbar === 52 && wideLayout.sidebar === 184 && wideLayout.mainScrollOwner === "auto", wideLayout);
  await evaluate("document.querySelector('[aria-label=\"打开对象检查器\"]')?.click()");
  await waitFor("Boolean(document.querySelector('.responsive-inspector--inline'))");
  const inlineInspector = await evaluate(`(() => ({
    width: Math.round(document.querySelector('.responsive-inspector--inline').getBoundingClientRect().width),
    horizontalFit: document.documentElement.scrollWidth <= document.documentElement.clientWidth
  }))()`);
  record("1440 对象检查器内联", inlineInspector.width === 360 && inlineInspector.horizontalFit, inlineInspector);
  const inlineShot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(outputDir, "inspector-inline-1440.png"), Buffer.from(inlineShot.data, "base64"));
  await evaluate("document.querySelector('[aria-label=\"关闭检查器\"]')?.click()");
  await waitFor("!document.querySelector('.responsive-inspector')");

  await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await delay(120);
  const compactLayout = await evaluate(`(() => ({
    horizontalFit: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    topbar: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
    sidebar: Math.round(document.querySelector('.app-sidebar').getBoundingClientRect().width)
  }))()`);
  record("1280 紧凑壳层", compactLayout.horizontalFit && compactLayout.topbar >= 80 && compactLayout.topbar <= 84 && compactLayout.sidebar === 176, compactLayout);
  await evaluate("document.querySelector('[aria-label=\"打开对象检查器\"]')?.click()");
  await waitFor("Boolean(document.querySelector('.responsive-inspector--drawer'))");
  const drawerInspector = await evaluate(`(() => ({
    width: Math.round(document.querySelector('.responsive-inspector--drawer').getBoundingClientRect().width),
    backdrop: Boolean(document.querySelector('.responsive-inspector__backdrop')),
    horizontalFit: document.documentElement.scrollWidth <= document.documentElement.clientWidth
  }))()`);
  record("1280 对象检查器抽屉", drawerInspector.width <= 460 && drawerInspector.backdrop && drawerInspector.horizontalFit, drawerInspector);
  const drawerShot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(outputDir, "inspector-drawer-1280.png"), Buffer.from(drawerShot.data, "base64"));
  await evaluate("document.querySelector('[aria-label=\"关闭检查器\"]')?.click()");
  await waitFor("!document.querySelector('.responsive-inspector')");

  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate("?workspace=product&subview=products", "产品工作台");
  record("打开新增产品弹窗", await clickButton("新增产品映射"), "primary CRUD action is clickable");
  await waitFor("Boolean(document.querySelector('[role=dialog]'))");
  record("填写产品 SKU", await fillField("SKU", "QA-SKU-001"), "field found");
  record("填写产品 ASIN", await fillField("ASIN", "B0QA000001"), "field found");
  record("填写产品名称", await fillField("产品名称", "QA Prototype Product"), "field found");
  await delay(80);
  record("保存新增产品", await clickButton("保存产品", true), "modal save enabled");
  await waitFor("document.body.innerText.includes('QA-SKU-001') && !document.querySelector('[role=dialog]')");
  record("产品新增显示", await evaluate("document.body.innerText.includes('QA Prototype Product')"), "new product is visible in current store");

  await call("Page.reload", { ignoreCache: true });
  await waitFor("document.readyState === 'complete' && document.body.innerText.includes('QA-SKU-001')", 10000);
  record("产品刷新持久化", true, "new product remains after reload");
  record("打开产品编辑", await rowButton("QA-SKU-001", "编辑"), "row edit action works");
  await waitFor("Boolean(document.querySelector('[role=dialog]'))");
  record("修改产品名称", await fillField("产品名称", "QA Prototype Product Updated"), "controlled input accepts edit");
  await delay(80);
  record("保存产品编辑", await clickButton("保存产品", true), "edit persisted");
  await waitFor("document.body.innerText.includes('QA Prototype Product Updated') && !document.querySelector('[role=dialog]')");

  await navigate("?store=LMX002&workspace=product&subview=products", "产品工作台");
  record("门店数据隔离", !(await evaluate("document.body.innerText.includes('QA-SKU-001')")), "SHC001 product is absent in LMX002");
  await navigate("?store=SHC001&workspace=product&subview=products", "产品工作台");
  record("切回门店恢复数据", await evaluate("document.body.innerText.includes('QA-SKU-001')"), "SHC001 product returns");

  await navigate("?store=SHC001&workspace=decisions&subview=approval", "人工审批");
  record("打开审批确认", await clickButton("批准原型许可"), "approval action is clickable");
  await waitFor("Boolean(document.querySelector('[role=dialog]'))");
  record("填写审批理由", await fillField("决定原因", "QA 验证：事实与策略边界一致"), "reason field accepts text");
  await delay(80);
  record("确认审批", await clickButton("批准并签发原型许可", true), "confirmation action works");
  await waitFor("!document.querySelector('[role=dialog]')", 8000);
  const approvedCount = await evaluate(`(() => {
    const envelope = JSON.parse(localStorage.getItem('amazon-ai-ops:v2:store:SHC001'));
    return Object.values(envelope.data.entities.decisions.byId).filter((item) => item.outcome === 'approved').length;
  })()`);
  record("审批写入不可变账本", approvedCount >= 1, { approvedCount });

  await navigate("?store=SHC001&workspace=readback&subview=execution", "执行与回读");
  const queuedActionAvailable = await evaluate("document.body.innerText.includes('加入模拟队列')");
  if (queuedActionAvailable) {
    record("批准动作加入模拟队列", await clickButton("加入模拟队列"), "enqueue action works");
    await waitFor("!document.body.innerText.includes('加入模拟队列')", 8000);
  }
  const queuedExecutionId = await evaluate(`(() => {
    const envelope = JSON.parse(localStorage.getItem('amazon-ai-ops:v2:store:SHC001'));
    return Object.values(envelope.data.entities.executions.byId).find((item) => item.status === 'queued')?.id || null;
  })()`);
  record("存在待模拟执行 run", Boolean(queuedExecutionId), { queuedExecutionId });
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('tr')].find((item) => item.textContent.includes(${JSON.stringify(queuedExecutionId)}));
    row?.click();
    return Boolean(row);
  })()`);
  await waitFor("document.body.innerText.includes('开始模拟执行')", 5000);
  record("开始模拟执行", await clickButton("开始模拟执行"), "preflight passed and action is clickable");
  await waitFor("document.body.innerText.includes('模拟回读证据链')", 8000);
  for (const type of ["BEFORE", "AFTER", "RELOAD"]) {
    record(`附加 ${type} 原型证据`, await clickButton(type), "evidence slot is clickable");
    await delay(60);
  }
  const readbackData = await evaluate(`(() => {
    const envelope = JSON.parse(localStorage.getItem('amazon-ai-ops:v2:store:SHC001'));
    const readback = Object.values(envelope.data.entities.readbacks.byId).find((item) => item.executionId === ${JSON.stringify(queuedExecutionId)});
    return { id: readback?.id, savedValue: readback?.savedValue };
  })()`);
  record("模拟回读已创建", Boolean(readbackData?.id), readbackData);
  record("填写 reload 值", await fillField("模拟 reload 页面值", String(readbackData.savedValue)), "reload field accepts saved value");
  await delay(80);
  record("记录 reload 与身份", await clickButton("记录 reload 与店铺身份"), "readback identity action works");
  await delay(100);
  record("验证模拟回读", await clickButton("验证模拟回读"), "verification action works");
  await waitFor("document.body.innerText.includes('模拟回读已验证')", 8000);
  const verifiedReadback = await evaluate(`(() => {
    const envelope = JSON.parse(localStorage.getItem('amazon-ai-ops:v2:store:SHC001'));
    const readback = envelope.data.entities.readbacks.byId[${JSON.stringify(readbackData.id)}];
    const evidence = readback.evidenceIds.map((id) => envelope.data.entities.evidence.byId[id]);
    return { status: readback.status, evidenceCount: evidence.length, prototypeOnly: evidence.every((item) => item.origin === 'prototype') };
  })()`);
  record("回读三证据仅限原型", verifiedReadback.status === "verified" && verifiedReadback.evidenceCount === 3 && verifiedReadback.prototypeOnly, verifiedReadback);

  await navigate("?store=SHC001&workspace=growth&subview=listing", "Listing 优化");
  record("编辑 Listing 标题", await fillField("标题", "QA Updated Listing Title for Door Lock"), "textarea value contract works");
  await delay(80);
  record("保存 Listing 草稿", await clickButton("保存草稿", true), "draft save action works");
  await delay(100);
  record("保存 Listing 版本", await clickButton("保存版本", true), "immutable version action works");
  await waitFor("document.body.innerText.includes('v2')", 8000);

  await navigate("?store=SHC001&workspace=system&subview=scheduler", "定时任务");
  record("打开新增定时任务", await clickButton("新增定时任务"), "scheduler CRUD action works");
  await waitFor("Boolean(document.querySelector('[role=dialog]'))");
  record("填写任务名称", await fillField("任务名称", "QA 每日诊断"), "field found");
  record("填写触发规则", await fillField("触发规则", "15 9 * * *"), "field found");
  await delay(80);
  record("保存定时任务", await clickButton("保存任务", true), "schedule save works");
  await waitFor("document.body.innerText.includes('QA 每日诊断') && !document.querySelector('[role=dialog]')", 8000);

  record("运行时无页面异常", browserErrors.length === 0, browserErrors);

  const report = {
    generatedAt: new Date().toISOString(),
    url: baseUrl,
    passed: results.filter((item) => item.passed).length,
    total: results.length,
    browserErrors,
    results,
  };
  await writeFile(join(outputDir, "ui-interaction-smoke.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ passed: report.passed, total: report.total, browserErrors }, null, 2)}\n`);

  await call("Browser.close").catch(() => {});
} catch (error) {
  await mkdir(outputDir, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), passed: false, error: error.stack || String(error), browserErrors, results };
  await writeFile(join(outputDir, "ui-interaction-smoke.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stderr.write(`${error.stack || error}\n`);
  chrome.kill();
  process.exitCode = 1;
} finally {
  socket?.close();
}

# Handoff Report (`handoff.md`)

## 1. Observation
通过对 `apps/desktop/src/` 目录下主进程、预加载层、渲染进程以及 `packages/local-db/` 进行静态代码走查，得出以下具体代码位置与逻辑现象：
- **安全隐患 1**：在主窗口加载流程中（`apps/desktop/src/main/index.ts`），缺少针对 `will-navigate` 与 `will-redirect` 事件的拦截逻辑。
- **安全隐患 2**：`apps/desktop/src/main/index.ts` 约第 302-305 行的外部链接处理器调用：
  ```typescript
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  ```
  直接将任意 `url` 传给了 `shell.openExternal` 并没有做协议校验。
- **性能瓶颈 1 (N+1 同步查询)**：在 `packages/local-db/src/sqlite/repositories/product-repo.ts` 第 64-69 行：
  ```typescript
  findAllWithCosts(storeName?: string): ProductWithCost[] {
    return this.findAll(storeName).map((product) => ({
      ...product,
      cost: this.getCost(product.id),
    }));
  }
  ```
- **性能瓶颈 2 (索引失效)**：在 `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts` 第 30-46 行：
  ```typescript
  const deleteExisting = this.db.prepare(`
    DELETE FROM ad_daily_metrics
    WHERE COALESCE(batch_id, '') = COALESCE(@batchId, '')
      AND COALESCE(report_type, '') = COALESCE(@reportType, '')
      AND COALESCE(date, '') = COALESCE(@date, '')
      ...
  `);
  ```
- **组件结构/重绘瓶颈 3**：`apps/desktop/src/renderer/pages/data-import-validation-page.tsx` 第 558 行的 `reportColumns` 与 `apps/desktop/src/renderer/pages/keyword-opportunities-page.tsx` 第 681 行的 `opportunityColumns` 直接声明在组件体内，未作 `useMemo` 缓存。
- **密码存储漏洞 4**：在 `apps/desktop/src/main/login-credentials.ts` 第 91-100 行，读取历史明文密码 `login_password` 后，未就地进行加密覆写和清空明文存储的操作。

## 2. Logic Chain
- **导航限制缺失**：如果渲染进程存在 XSS（跨站脚本攻击）漏洞或被强制重定向至外部网站，缺少对导航事件（`will-navigate`/`will-redirect`）的拦截，导致非受信网页也能加载至主窗口，进而非法运行 `preload` 暴露的 `electronAPI`。
- **外联打开风险**：由于直接调用 `shell.openExternal` 传入任意协议参数，渲染进程可以通过调用 `window.open` 传入以 `file:///` 指向本地可执行文件或特殊 URL 方案，从而绕过沙箱在宿主机上执行系统级命令。
- **N+1 SQL 查询**：调用一次 `findAllWithCosts` 时，除了主产品表查询，还会循环 N 次独立调用同步 SQLite 查询。主进程运行于单线程上，密集的同步 I/O 会冻结窗口，使系统呈无响应状态。
- **索引失效与全表扫描**：在 SQLite 批量删除条件中对字段包装 `COALESCE` 导致索引优化器失效。即使对 `date` 或 `store_name` 建立索引，SQLite 也必须运行 O(M) 全表扫描，插入 1000 条记录就会进行 1000 次大表全表扫描。
- **列重定义与重绘**：没有 `useMemo` 缓存的列定义在组件每次重绘时均会生成新的引用，导致 `VirtualDataTable` 不断重新计算 `gridTemplateColumns` 和重构 DOM。
- **凭证残留风险**：虽然实现了 `safeStorage` 的加密保存，但在读取历史明文密码时缺少一键升级为加密格式的机制，导致敏感的明文依然残留在本地 SQLite 表中。

## 3. Caveats
- 报告完全基于静态代码走查进行，没有在真实生产级的大数据量环境下运行实际的数据库性能分析测试。
- 代码中的 `safeStorage` 加密需要结合特定操作系统的 Keyring，目前假定在 Windows DPAPI 环境下均能成功运作。
- 重构操作需要实施全面的功能回归，确保在数据关联和状态校验下逻辑没有发生偏离。

## 4. Conclusion
本 Electron 应用在安全架构和数据库/渲染性能设计上存在中高危级别的隐患和优化空间。需要立即针对 IPC 窗口导航、URL 协议打开安全性进行过滤；重构同步 SQLite 数据库访问，合并 N+1 查询，并通过 IS 比较消除 COALESCE 对索引的遮蔽；为 React 表格组件的列配置加入 useMemo 包装以优化重绘开销；在老旧凭证读取逻辑中加入加密自动升级清空。

## 5. Verification Method
- **安全验证**：
  - 在渲染控制台执行 `window.location.href = 'https://example.com'`。若发生跳转且新页面仍可通过 `window.electronAPI` 发送 IPC 请求，说明安全加固未通过。
  - 在渲染控制台执行 `window.open("file:///C:/Windows/System32/calc.exe")`，检验计算器程序是否会被唤醒。
- **性能验证**：
  - 在大样本数据下调用 `findAllWithCosts`，分析其 CPU 阻塞时间。
  - 对 ad_daily_metrics 插入大量（万级以上）历史行，使用 SQLite `EXPLAIN QUERY PLAN` 查看批量 `delete` 语句是否走全表扫描（SCAN TABLE）还是范围扫描（SEARCH TABLE）。
  - 使用 React Profiler 检测 `data-import-validation-page` 和 `keyword-opportunities-page` 在简单交互下表格组件的 Render 次数和时间。

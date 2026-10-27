'use strict';

// 迁移时由原配置总线重导出；此叶子不读取环境、文件或运行时状态。
const PACKAGE_UI_VIEWPORT = Object.freeze({ width: 1366, height: 768 });
const PACKAGE_UI_VIEWPORT_TOLERANCE = Object.freeze({ width: 2, height: 2, deviceScaleFactor: 0.02 });
const PACKAGE_UI_VIEWPORT_RESTORE_TIMEOUT_MS = 5_000;
const PACKAGE_UI_VIEWPORT_STABILITY_MS = 250;
const PACKAGE_UI_VIEWPORT_STATE_POLL_MS = 25;
const PACKAGE_UI_MINIMUM_WINDOW = Object.freeze({ width: 1200, height: 700 });
const PACKAGE_UI_NATIVE_GEOMETRY_LIMITS = Object.freeze({ helperTimeoutMs: 20_000, wmQueryTimeoutMs: 1_000,
  maxOutputBytes: 512 * 1024, maxChildren: 256 });

module.exports = Object.freeze({ PACKAGE_UI_VIEWPORT, PACKAGE_UI_VIEWPORT_TOLERANCE,
  PACKAGE_UI_VIEWPORT_RESTORE_TIMEOUT_MS, PACKAGE_UI_VIEWPORT_STABILITY_MS, PACKAGE_UI_VIEWPORT_STATE_POLL_MS,
  PACKAGE_UI_MINIMUM_WINDOW, PACKAGE_UI_NATIVE_GEOMETRY_LIMITS });

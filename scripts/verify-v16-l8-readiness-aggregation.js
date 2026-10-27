// 兼容入口始终重算当前源码、原生证据、追踪与发布闭包。
const { main } = require('./verify-v16-readiness-aggregation.js');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
if (require.main === module) { try { main(); } catch (error) { console.error(JSON.stringify(createRuntimeLogRecord('error', 'v16.readiness_failed', { error }))); process.exitCode = 1; } }
module.exports = require('./verify-v16-readiness-aggregation.js');

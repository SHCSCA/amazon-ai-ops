const { isDeepStrictEqual } = require('node:util');
const { insist } = require('./v16-performance-artifacts');

// 固定验证协议的安全上限通过显式端口传递，不接受环境变量或调用方扩容。
const OWNED_CAPTION_PROTOCOL = Object.freeze({ schemaVersion: 'v16.owned-caption-protocol/1',
  setupMs: 30000, failureRestoreMs: 5000, hitTestMaxMs: 1000, observationMs: 1000,
  pollMs: 10, helperCleanupGraceMs: 1000, helperForcedCloseMs: 15000 });
function validateOwnedCaptionProtocol(value = OWNED_CAPTION_PROTOCOL) {
  insist(isDeepStrictEqual(value, OWNED_CAPTION_PROTOCOL), 'UI_CAPTION_FIXED_PROTOCOL_REQUIRED');
  return OWNED_CAPTION_PROTOCOL;
}
module.exports = { OWNED_CAPTION_PROTOCOL, validateOwnedCaptionProtocol };

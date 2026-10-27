const { isDeepStrictEqual: same } = require('node:util');
const { insist } = require('./v16-performance-artifacts');

function at(value) {
  const time = Date.parse(value);
  insist(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(time) && new Date(time).toISOString() === value, 'UI_NVDA_PROVIDER_TIME_INVALID');
  return time;
}
function validHwnd(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
}
function selectBracketedSpeech(rawRows, { binding, ready, request, node, hostBefore, hostAfter, expectedPrefix }) {
  const start = at(request.startedAt), end = at(request.deadlineAt), first = at(hostBefore.observedAt);
  const last = hostAfter ? at(hostAfter.observedAt) : end;
  insist(start <= first && first <= last && last <= end && end - start <= 10000, 'UI_NVDA_PROVIDER_TIME_INVALID');
  insist(Array.isArray(rawRows) && same(rawRows[0], ready), 'UI_NVDA_PROVIDER_RAW_ORIGINAL_REQUIRED');
  insist(!expectedPrefix || rawRows.length >= expectedPrefix.length && same(rawRows.slice(0, expectedPrefix.length), expectedPrefix),
    'UI_NVDA_PROVIDER_RAW_ROW_MISMATCH');
  const stream = rawRows.slice(request.rawOffset).filter(row => row.kind === 'nvda-synth-speech' && row.request?.nonce === request.nonce);
  let previousIndex = request.rawOffset - 1, previousTime = start;
  const selected = []; let earlyCount = 0;
  for (const row of stream) {
    // 早期语音也须逐项核原provider身份与时序，不能借选择边界隐藏坏原件。
    insist(row.engine === 'NVDA' && row.version === ready.version && row.pid === ready.pid && same(row.binding, binding) && same(row.request, request)
      && Number.isSafeInteger(row.rawIndex) && row.rawIndex >= request.rawOffset && row.rawIndex > previousIndex
      && same(rawRows[row.rawIndex], row), 'UI_NVDA_PROVIDER_RAW_ROW_MISMATCH');
    insist(row.focusPid === binding.main.pid && row.focusOwnerPid === binding.main.pid && row.rootOwnerPid === binding.main.pid
      && row.foregroundHwnd === binding.window.rootHwnd && row.ancestorHwnd === binding.window.rootHwnd && validHwnd(row.focusHwnd)
      && (row.focusHwnd === binding.window.rootHwnd || row.isChild === true) && row.mainAlive === true
      && row.handleCreationTimeUtc === binding.main.handleCreationTimeUtc, 'UI_NVDA_PROVIDER_NATIVE_WINDOW_MISMATCH');
    const role = ({ editabletext: 'textbox', radiobutton: 'radio', propertypage: 'tabpanel' })[row.focusRole] ?? row.focusRole;
    insist(typeof row.synthesizer === 'string' && row.synthesizer.length > 0
      && typeof row.spoken === 'string' && row.spoken.length > 0, 'UI_NVDA_PROVIDER_ACTUAL_NAME_OR_ROLE_MISMATCH');
    const namesTarget = row.spoken.includes(node.name);
    insist(row.focusName === node.name && role === node.role, 'UI_NVDA_PROVIDER_ACTUAL_NAME_OR_ROLE_MISMATCH');
    const time = at(row.timestamp);
    insist(time >= previousTime && time >= start && time <= end, 'UI_NVDA_PROVIDER_TIME_INVALID');
    previousIndex = row.rawIndex; previousTime = time;
    if (namesTarget) { if (time >= first && time <= last) selected.push(row); else if (time < first) earlyCount++; }
  }
  return { matching: selected, earlyCount, rawRows };
}
async function waitForBracketedSpeech({ read, wait, ...context }) {
  let latest, readFailure;
  try {
    return await wait(() => {
      try { latest = selectBracketedSpeech(read(), { ...context, expectedPrefix: latest?.rawRows }); return latest; }
      catch (error) { readFailure = error; throw error; }
    },
      value => value.matching.length > 0);
  } catch (error) {
    // 原十秒耗尽时只有合法早行仍是原时间门失败，所有原行保留且会话由reader关闭。
    if (error !== readFailure && Date.now() >= at(context.request.deadlineAt) && latest?.earlyCount > 0 && latest.matching.length === 0
      && ['UI_NVDA_OPERATION_DEADLINE_EXCEEDED', 'UI_NVDA_SPOKEN_NODE_NOT_OBSERVED'].includes(error.message))
      throw new Error('UI_NVDA_PROVIDER_TIME_INVALID', { cause: error });
    throw error;
  }
}
module.exports = { selectBracketedSpeech, waitForBracketedSpeech };

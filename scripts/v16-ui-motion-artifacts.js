const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { insist, readArtifact, hashEqual, digest } = require('./v16-native-artifacts');
const { fileRecord } = require('./v16-performance-artifacts');
const TOOL_STAT_KEYS = ['ino', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs', 'mode', 'nlink'];

function trustedMotionMain(nativeLaunch, owner) {
  const held = nativeLaunch?.verification?.mainExitObserver;
  insist(held?.kind === 'v16-main-exit-ready' && held.handleAcquired === true
    && held.pid === owner.mainPid && held.creationPrecision === 'cim-microsecond+handle-100ns'
    && held.executablePath === nativeLaunch.identity?.executablePath
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(held.handleCreationTimeUtc),
  'ACCESSIBILITY_MOTION_NATIVE_BIRTH_REQUIRED');
  return { birthUtc: held.handleCreationTimeUtc, executablePath: held.executablePath };
}
function verifyMotionNativeArtifacts(witness, context, packetOwner, nativeLaunch) {
  const shell = nativeLaunch?.processBinding?.query?.powershell;
  insist(typeof shell?.realPath === 'string' && path.win32.isAbsolute(shell.realPath)
    && /^[a-f0-9]{64}$/i.test(shell.sha256 ?? '') && shell.signature?.status === 'Valid',
  'ACCESSIBILITY_MOTION_TRUSTED_POWERSHELL_REQUIRED');
  const toolPath = require.resolve('./v16-ui-native-geometry.ps1');
  // 工具路径由当前源码决定，不能让待验 witness 选择任意脚本作为信任锚。
  const current = readArtifact(context.root, fileRecord(toolPath), path.dirname(toolPath));
  const currentStat = Object.fromEntries(TOOL_STAT_KEYS.map(key => [key, current.stat[key]]));
  for (const observation of [witness?.nativeBefore, witness?.nativeAfter]) {
    const call = observation?.invocation;
    insist(call && typeof call.command?.executable === 'string'
      && path.resolve(call.command.executable).toLowerCase() === path.resolve(shell.realPath).toLowerCase()
      && call.command.shell === false && call.command.windowsHide === true
      && typeof call.tool?.path === 'string' && path.resolve(call.tool.path).toLowerCase() === toolPath.toLowerCase()
      && hashEqual(call.tool.sha256, digest(current.bytes))
      && call.tool.sizeBytes === current.bytes.length
      && isDeepStrictEqual(Object.keys(call.tool).sort(), ['path', 'sha256', 'sizeBytes', 'stat'].sort())
      && isDeepStrictEqual(call.tool.stat, currentStat), 'ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
    const stdout = readArtifact(context.root, call.stdout, packetOwner);
    const stderr = readArtifact(context.root, call.stderr, packetOwner);
    insist(stderr.bytes.length === 0 && isDeepStrictEqual(stdout.json(), observation.native),
      'ACCESSIBILITY_MOTION_NATIVE_RAW_MISMATCH');
    const args = call.command.args;
    insist(Array.isArray(args) && args[0] === '-NoProfile' && args[1] === '-NonInteractive'
      && args[2] === '-File' && path.resolve(args[3]).toLowerCase() === toolPath.toLowerCase(),
    'ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
  }
}
module.exports = { trustedMotionMain, verifyMotionNativeArtifacts };

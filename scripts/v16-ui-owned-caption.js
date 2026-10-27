const { randomUUID } = require('node:crypto');
const { createCaptionArtifacts, captureShellIdentity } = require('./v16-ui-owned-caption-artifacts');
const { validateOwnedCaptionProtocol } = require('./v16-ui-owned-caption-contract');
const path = require('node:path');
const { runCaptionChild } = require('./v16-ui-owned-caption-child');
const { topmost } = require('./v16-ui-owned-caption-window');
async function activateOwnedCaption({ runtime, writer, binding, nativeLaunch, nativeLaunchRef, root, protocol, trustedRuntime, sourceIdentity }) {
  const startedMs = Date.now(), c = createCaptionArtifacts(writer), limits = validateOwnedCaptionProtocol(protocol);
  c.assert.ok(typeof root === 'string' && path.isAbsolute(root) && !root.includes('\0'), 'UI_CAPTION_EXPLICIT_ROOT_REQUIRED');
  c.assert.match(sourceIdentity?.sourceSha256 ?? '', /^[a-f0-9]{64}$/i, 'UI_CAPTION_SOURCE_IDENTITY_REQUIRED');
  if (nativeLaunch.sourceIdentity) c.assert.deepEqual(sourceIdentity, nativeLaunch.sourceIdentity, 'UI_CAPTION_NATIVE_SOURCE_CHANGED');
  const shellIdentity = captureShellIdentity(trustedRuntime);
  const config = { root, writer, sourceSha256: sourceIdentity.sourceSha256,
    packageSourceSha256: sourceIdentity.sourceSha256, packageIdentity: nativeLaunch.packageIdentity,
    captionSetupMs: limits.setupMs, captionRestoreCleanupMs: limits.failureRestoreMs, nativeTimeoutMs: limits.setupMs,
    captionHitTestMaxMs: limits.hitTestMaxMs, captionObservationMs: limits.observationMs, captionPollMs: limits.pollMs,
    captionHelperCleanupGraceMs: limits.helperCleanupGraceMs, ownedForcedCloseMs: limits.helperForcedCloseMs,
    nativeShell: trustedRuntime.executable, trustedRuntime, shellIdentity,
    captionScript: c.record(path.join(__dirname, 'v16-ui-owned-caption.ps1')),
    captionSource: c.record(path.join(__dirname, 'v16-ui-owned-caption-native.cs')) };
  const deadline=startedMs+config.captionSetupMs;
  const proof={kind:'v16-owned-caption-setup',schemaVersion:1,startedAt:new Date(startedMs).toISOString(),
    deadlineAt:new Date(deadline).toISOString(),passed:false,setupOnly:true,nodeTimingCredit:false,formalCredit:false,
    hostSourceSha256:config.sourceSha256,packageSourceSha256:config.packageSourceSha256,packageIdentity:config.packageIdentity,
    atomicTargetGuarantee:false,issues:[]};
  let failure, expected, held, topmostAttempted = false, nativePassed = false;
  const setupToken = randomUUID();
  c.assert.equal(config.captionRestoreCleanupMs, 5000);
  c.assert.ok(config.captionRestoreCleanupMs <= config.nativeTimeoutMs);
  try {
    c.assert.equal(c.canonical(nativeLaunchRef.path), c.canonical(runtime.launch.receipt.path));
    const launch=c.read(c.validate(nativeLaunchRef).path); c.assert.deepEqual(launch, nativeLaunch);
    held=launch.verification?.mainExitObserver;
    c.assert.ok(['windows-shell','windows-direct'].includes(launch.processBinding.method));
    c.assert.ok(held?.handleAcquired && held.ownerToken && held.handleCreationTimeUtc);
    c.assert.equal(held.pid,runtime.identity.pid);
    c.assert.equal(binding.main.pid,held.pid);
    c.assert.equal(binding.main.handleCreationTimeUtc,held.handleCreationTimeUtc);
    c.assert.equal(binding.main.ownerToken,held.ownerToken);
    expected={pid:runtime.identity.pid,exe:runtime.identity.executablePath,appRoot:runtime.identity.appRoot,
      profile:runtime.userDataDir,windowId:runtime.identity.windows[0].id,rendererPid:runtime.identity.windows[0].rendererPid,
      rootHwnd:binding.window.rootHwnd};
    topmostAttempted = true;
    const observed=await topmost(runtime,expected,held,setupToken,'apply',deadline);
    c.assert.equal(observed.alwaysOnTopAfter,true);
    c.assert.equal(observed.visible,true);
    c.assert.match(observed.rootHwnd,/^[1-9][0-9]*$/);
    c.assert.equal(observed.rootHwnd,binding.window.rootHwnd);
    proof.runtime={...observed,heldMain:held,nativeLaunch:runtime.launch.receipt};
    const directory=c.path.join(writer.root,'caption'); c.fs.mkdirSync(directory);
    const request=c.write(c.path.join(directory,'input.json'),{
      schemaVersion:1,MainPid:expected.pid,ExpectedBirthUtc:held.handleCreationTimeUtc,ExpectedExe:expected.exe,
      RootHwnd:observed.rootHwnd,DeadlineAt:proof.deadlineAt,RunToken:binding.runToken,Nonce:randomUUID(),nativeSource:config.captionSource,
      HitTestMaxMs:config.captionHitTestMaxMs,ObservationMs:config.captionObservationMs,PollMs:config.captionPollMs});
    proof.request=request;
    const child=await runCaptionChild(config,directory,request,deadline); proof.child=child;
    c.assert.ok(child.spawnObserved && child.exitObserved && child.closeObserved && !child.error && !child.timedOut,'UI_CAPTION_ACTUAL_CHILD_CLOSE_REQUIRED');
    c.assert.equal(child.exitObserved.code,0); c.assert.equal(child.exitObserved.signal,null);
    c.assert.equal(child.closeObserved.code,0); c.assert.equal(child.closeObserved.signal,null);
    c.assert.ok(child.report,'UI_CAPTION_NATIVE_REPORT_REQUIRED');
    const actual=c.read(c.validate(child.report).path),input=c.read(request.path);
    c.assert.deepEqual(actual.request,input);
    c.assert.equal(actual.kind,'v16-owned-caption-activation');c.assert.equal(actual.passed,true);
    c.assert.equal(actual.result.exactRoot,true);c.assert.equal(actual.result.heldMainVerified,true);
    c.assert.equal(actual.result.sendInputCalls,1);c.assert.equal(actual.result.inputSent,3);
    c.assert.equal(actual.result.inputReleased,true);
    c.assert.equal(actual.result.releaseCleanupAttempted,false);
    const stdout=c.fs.readFileSync(child.stdout.path,'utf8').trim().split(/\r?\n/);
    c.assert.equal(stdout.length,1);const completion=JSON.parse(stdout[0]);
    c.assert.equal(c.canonical(completion.report),c.canonical(child.report.path));c.assert.equal(completion.passed,true);
    proof.activation=child.report;nativePassed=true;
  } catch(error) {
    failure=error;proof.issues.push({name:error.name,message:error.message});c.log(config,'v16.ui_caption_setup_failed',error);
  } finally {
    proof.setupWorkFinishedAt = new Date().toISOString(); proof.setupWorkElapsedMs = Date.now() - startedMs;
    proof.topmostRestoration = { attempted: topmostAttempted, normalWithinSetup: false, cleanupOnly: false, errors: [] };
    const restore = async (restoreDeadline, cleanupOnly) => {
      const restoreStarted = Date.now();
      proof.topmostRestoration.cleanupOnly ||= cleanupOnly;
      try {
        const value = await topmost(runtime, expected, held, setupToken, 'restore', restoreDeadline);
        c.assert.equal(value.tokenClosed, true);
        if (typeof value.alwaysOnTopBefore === 'boolean') c.assert.equal(value.alwaysOnTopAfter, value.alwaysOnTopBefore);
        else c.assert.ok(failure, 'UI_CAPTION_MISSING_ORIGINAL_TOPMOST');
        proof.topmostRestoration.observed = value;
        if (!cleanupOnly) proof.topmostRestoration.normalWithinSetup = Date.now() < deadline;
      } catch (error) {
        proof.topmostRestoration.errors.push({ name: error.name, message: error.message, cleanupOnly });
        c.log(config, 'v16.ui_caption_topmost_restore_failed', error, { cleanupOnly, originalError: failure });
        failure ??= error; throw error;
      } finally {
        (proof.topmostRestoration.attempts ||= []).push({ cleanupOnly, startedAt: new Date(restoreStarted).toISOString(),
          finishedAt: new Date().toISOString(), elapsedMs: Date.now() - restoreStarted, deadlineAt: new Date(restoreDeadline).toISOString() });
      }
    };
    if (topmostAttempted) {
      const alreadyFailed = Boolean(failure);
      try { await restore(alreadyFailed ? Date.now() + config.captionRestoreCleanupMs : deadline, alreadyFailed); }
      catch {
        // 正常恢复过期后仍给独立有界清理机会；不再激活、输入或授予 setup 信用。
        if (!alreadyFailed) { try { await restore(Date.now() + config.captionRestoreCleanupMs, true); } catch {} }
      }
    }
    if (!failure && nativePassed && !proof.topmostRestoration.normalWithinSetup) {
      failure = new Error('UI_CAPTION_RESTORE_OUTSIDE_SETUP_DEADLINE');
      proof.issues.push({ name: failure.name, message: failure.message });
      c.log(config, 'v16.ui_caption_setup_deadline_failed', failure);
    }
    proof.passed = !failure && nativePassed && proof.topmostRestoration.normalWithinSetup;
    proof.finishedAt=new Date().toISOString();proof.elapsedMs=Date.now()-startedMs;
    try {proof.receipt=writer.json('caption/setup.json',proof);}
    catch(error) {c.log(config,'v16.ui_caption_setup_receipt_failed',error,{originalError:failure});failure??=error;}
  }
  if(failure) throw failure;
  return proof;
}
module.exports={activateOwnedCaption};


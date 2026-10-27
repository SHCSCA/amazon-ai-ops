const { spawn } = require('node:child_process');
const { createCaptionArtifacts, validateShellIdentity } = require('./v16-ui-owned-caption-artifacts');
async function runCaptionChild(config, directory, request, deadline) {
  const c = createCaptionArtifacts(config.writer);
  const stdoutPath=c.path.join(directory,'native.stdout.log'), stderrPath=c.path.join(directory,'native.stderr.log');
  const reportPath=c.path.join(directory,'native-report.json');
  const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',config.captionScript.path,
    '-InputFile',request.path,'-ReportFile',reportPath];
  const row={kind:'v16-owned-caption-child',startedAt:new Date().toISOString(),executable:config.nativeShell,args,
    shellBefore:config.shellIdentity,spawnObserved:false,exitObserved:null,closeObserved:null,error:null,timedOut:false,ownedKillAttempted:false};
  let out,err,timer,killTimer,closeTimer,failure;
  try {
    validateShellIdentity(config.trustedRuntime, config.shellIdentity); c.validate(config.captionScript); c.validate(config.captionSource);
    out=c.fs.openSync(stdoutPath,'wx'); err=c.fs.openSync(stderrPath,'wx');
    const remaining=deadline-Date.now(); c.assert.ok(remaining>0,'UI_CAPTION_SETUP_DEADLINE');
    const owned=spawn(config.nativeShell.realPath,args,{cwd:config.root,env:config.trustedRuntime.environment,shell:false,windowsHide:true,stdio:['ignore',out,err]});
    row.pid=owned.pid??null;
    await new Promise((resolve,reject)=>{
      owned.once('spawn',()=>{row.spawnObserved=true;row.spawnObservedAt=new Date().toISOString();});
      owned.once('error',error=>{row.error={name:error.name,message:error.message};failure??=error;});
      owned.once('exit',(code,signal)=>{row.exitObserved={code,signal,at:new Date().toISOString()};});
      owned.once('close',(code,signal)=>{row.closeObserved={code,signal,at:new Date().toISOString()};resolve();});
      timer=setTimeout(()=>{
        row.timedOut=true; failure??=new Error('UI_CAPTION_SETUP_DEADLINE');
        row.ownedCleanupGraceMs=config.captionHelperCleanupGraceMs;
        killTimer=setTimeout(()=>{
          try {
            if(!row.exitObserved && Number.isSafeInteger(owned.pid)) {
              row.ownedKillAttempted=true; row.ownedKillReturned=owned.kill('SIGKILL');
            }
          } catch(error) {row.ownedKillError={name:error.name,message:error.message};}
        },config.captionHelperCleanupGraceMs);
        closeTimer=setTimeout(()=>reject(failure),config.ownedForcedCloseMs);
      },remaining);
    });
  } catch(error) {failure??=error;}
  finally {
    clearTimeout(timer); clearTimeout(killTimer); clearTimeout(closeTimer);
    for(const fd of [out,err]) if(fd!==undefined) try {c.fs.closeSync(fd);}
    catch(error) {failure??=error;c.log(config,'v16.ui_caption_child_log_close_failed',error);}
    try { row.shellAfter = validateShellIdentity(config.trustedRuntime, config.shellIdentity); }
    catch(error) { failure??=error; c.log(config,'v16.ui_caption_shell_drift',error); }
    row.finishedAt=new Date().toISOString();
    if(failure) row.error??={name:failure.name,message:failure.message};
    for(const [key,file] of [['stdout',stdoutPath],['stderr',stderrPath],['report',reportPath]]) {
      try {if(c.fs.existsSync(file)) row[key]=c.record(file);}
      catch(error) {failure??=error;c.log(config,'v16.ui_caption_child_artifact_failed',error,{key,originalError:failure});}
    }
    try {row.receipt=c.write(c.path.join(directory,'native-child.json'),row);}
    catch(error) {c.log(config,'v16.ui_caption_child_receipt_failed',error,{originalError:failure});failure??=error;}
  }
  if(failure) throw failure;
  return row;
}
module.exports={runCaptionChild};


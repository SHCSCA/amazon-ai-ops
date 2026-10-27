// 按职责复用原有严格校验，公共入口继续保持兼容。
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DEFAULT_EXCLUSIVE_WINDOW_COMMAND_TIMEOUT_MS, EXCLUSIVE_WINDOW_CREATE_COMMAND, EXCLUSIVE_WINDOW_PROTOCOL, EXCLUSIVE_WINDOW_RELEASE_COMMAND, boundedError, cleanAbsolute, fail, protocolError, sha256 } = require('./s7-launch-operator-contracts.js');
const { EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP } = require('./s7-launch-operator-helper-bootstrap.js');
const { EXCLUSIVE_WINDOW_HELPER_SCRIPT } = require('./s7-launch-operator-helper-script.js');
const { resolveTrustedWindowsPowerShell } = require('./s7-launch-operator-security.js');

function exclusiveHelperEnvironment(env, databasePath, executablePath, workingDirectory) {
    const result = {};
    for (const [key, value] of Object.entries(env)) {
        if (typeof value === 'string' && !key.includes('\0') && !value.includes('\0')) {
            result[key] = value;
        }
    }
    result.AAO_S7_EXCLUSIVE_DB_B64 = Buffer.from(databasePath, 'utf8').toString('base64');
    result.AAO_S7_EXECUTABLE_B64 = Buffer.from(executablePath, 'utf8').toString('base64');
    result.AAO_S7_WORKING_DIRECTORY_B64 = Buffer.from(workingDirectory, 'utf8').toString('base64');
    return result;
}

function createExclusiveProtocolChannel(child) {
    if (!child?.stdin
        || !child?.stdout
        || typeof child.stdin.write !== 'function'
        || typeof child.stdout.on !== 'function') {
        fail('Exclusive-window helper stdio is unavailable.');
    }
    child.stdout.setEncoding?.('utf8');
    let buffer = '';
    let terminal = null;
    const queued = [];
    const waiters = [];
    let closeOutcome = null;
    let resolveClose;
    const closePromise = new Promise((resolve) => {
        resolveClose = resolve;
    });
    const rejectAll = (error) => {
        while (waiters.length) {
            const waiter = waiters.shift();
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }
    };
    const deliver = () => {
        while (queued.length && waiters.length) {
            const proof = queued.shift();
            const waiter = waiters.shift();
            clearTimeout(waiter.timer);
            if (proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL
                || proof?.status !== waiter.expectedStatus) {
                const message = proof?.status === 'ERROR'
                    ? `Exclusive-window helper failed during ${proof?.phase || 'unknown phase'}.`
                    : `Exclusive-window helper emitted ${proof?.status || 'invalid proof'} while ${waiter.expectedStatus} was required.`;
                waiter.reject(protocolError(message, 'PROTOCOL_SEQUENCE_MISMATCH', proof));
            }
            else {
                waiter.resolve(proof);
            }
        }
    };
    const onData = (chunk) => {
        if (terminal)
            return;
        buffer += String(chunk);
        if (buffer.length > 65536) {
            terminal = protocolError('Exclusive-window helper proof stream exceeded its bounded payload.', 'PROTOCOL_PAYLOAD_EXCEEDED');
            rejectAll(terminal);
            return;
        }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line)
                continue;
            try {
                const proof = JSON.parse(line);
                if (proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL || typeof proof?.status !== 'string') {
                    throw new Error('invalid protocol proof');
                }
                queued.push(proof);
                deliver();
            }
            catch {
                terminal = protocolError('Exclusive-window helper emitted invalid JSON proof.', 'PROTOCOL_INVALID_JSON');
                rejectAll(terminal);
                return;
            }
        }
    };
    const finish = (outcome) => {
        if (closeOutcome)
            return;
        closeOutcome = outcome;
        resolveClose(outcome);
        if (!terminal && outcome.outcome !== 'close') {
            terminal = protocolError('Exclusive-window helper process failed.', 'PROTOCOL_PROCESS_ERROR');
        }
        else if (!terminal && waiters.length) {
            terminal = protocolError('Exclusive-window helper closed before the required proof.', 'PROTOCOL_CLOSED_EARLY');
        }
        if (terminal)
            rejectAll(terminal);
    };
    child.stdout.on('data', onData);
    child.once('error', () => finish({ outcome: 'process-error' }));
    child.once('close', (code, signal) => finish({ outcome: 'close', code, signal }));
    return {
        wait(expectedStatus, timeoutMs) {
            if (terminal)
                return Promise.reject(terminal);
            if (closeOutcome && queued.length === 0) {
                return Promise.reject(protocolError(`Exclusive-window helper already closed before ${expectedStatus}.`, 'PROTOCOL_CLOSED_EARLY'));
            }
            return new Promise((resolve, reject) => {
                const waiter = {
                    expectedStatus,
                    resolve,
                    reject,
                    timer: setTimeout(() => {
                        const index = waiters.indexOf(waiter);
                        if (index >= 0)
                            waiters.splice(index, 1);
                        reject(protocolError(`Exclusive-window helper ${expectedStatus} proof timed out.`, 'PROTOCOL_TIMEOUT'));
                    }, timeoutMs),
                };
                waiters.push(waiter);
                deliver();
            });
        },
        send(command) {
            if (terminal || closeOutcome || child.stdin.destroyed) {
                fail('Exclusive-window helper is unavailable for a protocol command.');
            }
            child.stdin.write(`${command}\n`);
        },
        closePromise,
        snapshot() {
            return {
                queuedProofs: queued.slice(-4).map((proof) => ({
                    protocol: typeof proof?.protocol === 'string' ? proof.protocol : null,
                    status: typeof proof?.status === 'string' ? proof.status : null,
                    helperPid: Number.isInteger(Number(proof?.helperPid))
                        ? Number(proof.helperPid)
                        : null,
                    pid: Number.isInteger(Number(proof?.pid)) ? Number(proof.pid) : null,
                    phase: typeof proof?.phase === 'string' ? proof.phase.slice(0, 120) : null,
                })),
                partialText: buffer.slice(-1024),
                partialBytes: Buffer.byteLength(buffer, 'utf8'),
                terminalCode: terminal?.code || null,
                closeOutcome,
            };
        },
    };
}

function closeExclusiveHelperInput(child) {
    let helperInputState = 'UNKNOWN';
    let helperInputCloseError = null;
    try {
        if (!child?.stdin) {
            helperInputState = 'UNKNOWN';
        }
        else if (child.stdin.destroyed || child.stdin.writableEnded) {
            helperInputState = 'ALREADY_CLOSED';
        }
        else {
            child.stdin.end();
            helperInputState = 'CLOSE_REQUESTED';
        }
    }
    catch (error) {
        helperInputState = 'CLOSE_FAILED';
        helperInputCloseError = boundedError(error);
    }
    child?.unref?.();
    child?.stdin?.unref?.();
    child?.stdout?.unref?.();
    return {
        helperInputState,
        helperInputCloseError,
        helperProcessUnrefRequested: Boolean(child?.unref),
        helperStdinUnrefRequested: Boolean(child?.stdin?.unref),
        helperStdoutUnrefRequested: Boolean(child?.stdout?.unref),
    };
}

async function defaultAcquireLaunchExclusiveWindow(databasePath, executablePath, targetEnvironment, timeoutMs) {
    const resolvedDatabase = cleanAbsolute(databasePath, 'Launch-exclusive database');
    const resolvedExecutable = cleanAbsolute(executablePath, 'Launch executable');
    const workingDirectory = path.dirname(resolvedExecutable);
    const trustedPowerShell = resolveTrustedWindowsPowerShell(process.env);
    const child = spawn(trustedPowerShell.realPath, ['-NoProfile', '-NonInteractive', '-Command', EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP], {
        detached: false,
        env: exclusiveHelperEnvironment(targetEnvironment, resolvedDatabase, resolvedExecutable, workingDirectory),
        shell: false,
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
    });
    const channel = createExclusiveProtocolChannel(child);
    try {
        const proof = await channel.wait('READY', timeoutMs);
        return { child, helperPid: child.pid, proof, channel };
    }
    catch (error) {
        const cleanup = closeExclusiveHelperInput(child);
        await Promise.race([
            channel.closePromise,
            new Promise((resolve) => {
                const timer = setTimeout(() => resolve({ outcome: 'timeout' }), 20000);
                timer.unref?.();
            }),
        ]);
        const originalProof = error?.proof && typeof error.proof === 'object'
            ? error.proof
            : {};
        if (error instanceof Error) {
            error.proof = {
                ...originalProof,
                protocol: originalProof.protocol || EXCLUSIVE_WINDOW_PROTOCOL,
                status: 'ACQUISITION_UNTRUSTED',
                observedProofStatus: typeof originalProof.status === 'string'
                    ? originalProof.status.slice(0, 80)
                    : null,
                helperPid: Number.isInteger(Number(originalProof.helperPid))
                    ? Number(originalProof.helperPid)
                    : Number.isInteger(child.pid)
                        ? child.pid
                        : null,
                phase: originalProof.phase || 'await-ready',
                scriptSha256: sha256(EXCLUSIVE_WINDOW_HELPER_SCRIPT),
                lateProofBuffer: channel.snapshot(),
                helperInputState: cleanup.helperInputState,
                helperInputCloseError: cleanup.helperInputCloseError,
                helperProcessUnrefRequested: cleanup.helperProcessUnrefRequested,
                helperStdinUnrefRequested: cleanup.helperStdinUnrefRequested,
                helperStdoutUnrefRequested: cleanup.helperStdoutUnrefRequested,
            };
        }
        throw error;
    }
}

async function defaultCreateSuspendedPackage(windowHandle, timeoutMs, startupGatePlan) {
    if (!startupGatePlan || typeof startupGatePlan !== 'object') {
        fail('S7 startup gate plan is required before CREATE_SUSPENDED.');
    }
    const encodedPlan = Buffer.from(JSON.stringify(startupGatePlan), 'utf8').toString('base64');
    const proofPromise = windowHandle.channel.wait('SPAWNED', timeoutMs);
    windowHandle.channel.send(`${EXCLUSIVE_WINDOW_CREATE_COMMAND} ${encodedPlan}`);
    return proofPromise;
}

async function defaultReleaseAndResumePackage(windowHandle, timeoutMs) {
    const proofPromise = windowHandle.channel.wait('RESUMED', timeoutMs);
    windowHandle.channel.send(EXCLUSIVE_WINDOW_RELEASE_COMMAND);
    return proofPromise;
}

async function defaultWaitForManagedPackageClose(windowHandle, timeoutMs) {
    try {
        const proof = await windowHandle.channel.wait('CLOSED', timeoutMs);
        const helperClose = await Promise.race([
            windowHandle.channel.closePromise,
            new Promise((resolve) => {
                const timer = setTimeout(() => resolve({ outcome: 'timeout' }), DEFAULT_EXCLUSIVE_WINDOW_COMMAND_TIMEOUT_MS);
                timer.unref?.();
            }),
        ]);
        return {
            outcome: 'close',
            code: Number(proof.exitCode),
            signal: proof.signal ?? null,
            closedAt: proof.closedAt,
            proof,
            helperClose,
        };
    }
    catch (error) {
        if (error?.code === 'PROTOCOL_TIMEOUT')
            return { outcome: 'timeout' };
        return {
            outcome: 'process-monitor-error',
            errorCode: error?.code || 'PROTOCOL_ERROR',
            errorProof: error?.proof || null,
        };
    }
}

function defaultDetachManagedLaunch(windowHandle) {
    const child = windowHandle?.child;
    const cleanup = closeExclusiveHelperInput(child);
    return {
        detachedFromOperator: true,
        ...cleanup,
        processKillInvoked: false,
        helperPid: Number.isInteger(child?.pid) ? child.pid : null,
    };
}

function defaultAbortUnlaunchedExclusiveWindow(windowHandle) {
    const cleanup = closeExclusiveHelperInput(windowHandle?.child);
    return {
        ...cleanup,
        processKillInvoked: false,
        packageProcessCreated: false,
    };
}

module.exports = { exclusiveHelperEnvironment, createExclusiveProtocolChannel, closeExclusiveHelperInput, defaultAcquireLaunchExclusiveWindow, defaultCreateSuspendedPackage, defaultReleaseAndResumePackage, defaultWaitForManagedPackageClose, defaultDetachManagedLaunch, defaultAbortUnlaunchedExclusiveWindow };

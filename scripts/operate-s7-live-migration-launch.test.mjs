// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { EXCLUSIVE_WINDOW_HELPER_SCRIPT, defaultAcquireLaunchExclusiveWindow, defaultInspectWindowsPathSecurity, defaultProtectWindowsDirectory, defaultProtectWindowsFile, describe, expect, fileArtifact, fs, it, os, path, roots, run, spawnSync, vi } from './s7-launch-operator-test-environment.mjs';
import { write } from './s7-launch-operator-test-artifacts.mjs';
import { setup } from './s7-launch-operator-test-setup.mjs';
import { prepareArgs } from './s7-launch-operator-test-workflow.mjs';
describe('operate-s7-live-migration-launch', () => {
it('keeps nanosecond file timestamps identical to the ordinary stat API', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-file-time-'));
    roots.push(root);
    const target = path.join(root, 'identity.bin');
    write(target, 'timestamp-fixture');
    expect(fileArtifact(target, 'timestamp fixture').mtimeMs).toBe(fs.statSync(target).mtimeMs);
});
it('preserves large Windows file IDs and rejects replacements hidden by Number rounding', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-large-file-id-'));
    roots.push(root);
    const target = path.join(root, 'identity.bin');
    write(target, 'stable identity content');
    const exactId = 142426338215754362n;
    expect(Number(exactId)).toBe(Number(exactId + 1n));
    const originals = Object.fromEntries(['lstatSync', 'statSync', 'fstatSync'].map(key => [key, fs[key].bind(fs)]));
    let replaceDuringRead = false;
    let handleReads = 0;
    const spies = Object.keys(originals).map(key => vi.spyOn(fs, key).mockImplementation((value, options) => {
        const stat = originals[key](value, options);
        if (!options?.bigint)
            return stat;
        const ino = key === 'fstatSync' && replaceDuringRead && ++handleReads === 2 ? exactId + 1n : exactId;
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino });
    }));
    try {
        const artifact = fileArtifact(target, 'Large Windows file ID');
        expect(artifact.identity.ino).toBe(exactId.toString());
        expect(JSON.parse(JSON.stringify(artifact)).identity.ino).toBe('142426338215754362');
        replaceDuringRead = true;
        expect(() => fileArtifact(target, 'Replaced file ID')).toThrow(/changed while it was being read/);
    }
    finally {
        for (const spy of spies)
            spy.mockRestore();
    }
});

it.runIf(process.platform === 'win32')('keeps the Windows suspended-launch helper syntactically valid without executing it', () => {
    const result = spawnSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_SCRIPT_B64));[void][scriptblock]::Create($s);[Console]::Out.Write('OK')",
    ], {
        encoding: 'utf8',
        env: {
            ...process.env,
            AAO_SCRIPT_B64: Buffer.from(EXCLUSIVE_WINDOW_HELPER_SCRIPT, 'utf8').toString('base64'),
        },
        windowsHide: true,
        timeout: 20000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('OK');
});

it.runIf(process.platform === 'win32')('fails closed on inherited or high-risk Windows ACLs and accepts an explicitly protected user-owned root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-acl-'));
    roots.push(root);
    const protectedRoot = path.join(root, 'protected');
    const inheritedRoot = path.join(root, 'inherited');
    const highRiskRoot = path.join(root, 'high-risk');
    fs.mkdirSync(protectedRoot);
    fs.mkdirSync(inheritedRoot);
    fs.mkdirSync(highRiskRoot);
    defaultProtectWindowsDirectory(protectedRoot);
    expect(defaultInspectWindowsPathSecurity(protectedRoot, {
        label: 'Synthetic protected recovery root',
        type: 'directory',
        requireProtected: true,
    })).toMatchObject({
        passed: true,
        inheritanceProtected: true,
        highRiskWritePrincipalCount: 0,
    });
    expect(() => defaultInspectWindowsPathSecurity(inheritedRoot, {
        label: 'Synthetic inherited recovery root',
        type: 'directory',
        requireProtected: true,
    })).toThrow(/inheritance|high-risk principal|unapproved principal/i);
    defaultProtectWindowsDirectory(highRiskRoot);
    const addEveryone = spawnSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
            "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:S7_ACL_PATH_B64))",
            '$acl=[System.IO.Directory]::GetAccessControl($p)',
            '$sid=[System.Security.Principal.SecurityIdentifier]::new("S-1-1-0")',
            '$rule=[System.Security.AccessControl.FileSystemAccessRule]::new(',
            '  $sid,',
            '  [System.Security.AccessControl.FileSystemRights]::FullControl,',
            '  [System.Security.AccessControl.InheritanceFlags]::None,',
            '  [System.Security.AccessControl.PropagationFlags]::None,',
            '  [System.Security.AccessControl.AccessControlType]::Allow',
            ')',
            '[void]$acl.AddAccessRule($rule)',
            '[System.IO.Directory]::SetAccessControl($p,$acl)',
        ].join('\n'),
    ], {
        encoding: 'utf8',
        env: {
            ...process.env,
            S7_ACL_PATH_B64: Buffer.from(highRiskRoot, 'utf8').toString('base64'),
        },
        windowsHide: true,
        timeout: 20000,
    });
    expect(addEveryone.error).toBeUndefined();
    expect(addEveryone.status, addEveryone.stderr).toBe(0);
    expect(() => defaultInspectWindowsPathSecurity(highRiskRoot, {
        label: 'Synthetic high-risk recovery root',
        type: 'directory',
        requireProtected: true,
    })).toThrow(/high-risk principal/i);
    const wired = setup();
    wired.context.inspectWindowsPathSecurity = defaultInspectWindowsPathSecurity;
    defaultProtectWindowsFile(wired.db);
    await expect(run(prepareArgs(wired, path.join(wired.approvalOutputRoot, 'acl-rejected.json')), wired.context)).rejects.toThrow(/inheritance|high-risk principal|unapproved principal/i);
    defaultProtectWindowsDirectory(wired.approvalOutputRoot);
    wired.context.protectWindowsFile = defaultProtectWindowsFile;
    const passedOutput = path.join(wired.approvalOutputRoot, 'acl-passed.json');
    await expect(run(prepareArgs(wired, passedOutput), wired.context)).resolves.toMatchObject({ exitCode: 0, outputPath: passedOutput });
    expect(defaultInspectWindowsPathSecurity(passedOutput, {
        label: 'Synthetic protected approval packet',
        type: 'file',
        requireProtected: false,
    })).toMatchObject({ passed: true, ownerSid: expect.any(String) });
}, 60000);

it.runIf(process.platform === 'win32')('retains helper identity, script hash, late proof buffer, and cleanup state when READY acquisition times out', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-ready-timeout-'));
    roots.push(root);
    const db = path.join(root, 'synthetic.db');
    const exe = path.join(root, 'never-created.exe');
    write(db, 'synthetic-ready-timeout-db');
    write(exe, 'not-an-executable');
    let captured;
    try {
        await defaultAcquireLaunchExclusiveWindow(db, exe, {
            SYSTEMROOT: process.env.SystemRoot || 'C:\\Windows',
            WINDIR: process.env.WINDIR || 'C:\\Windows',
            COMSPEC: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
            PATH: process.env.PATH || '',
            PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
            TEMP: root,
            TMP: root,
        }, 1);
    }
    catch (error) {
        captured = error;
    }
    expect(captured).toBeInstanceOf(Error);
    expect(captured.proof).toMatchObject({
        protocol: 's7-live-migration-exclusive-window/v1',
        status: 'ACQUISITION_UNTRUSTED',
        phase: 'await-ready',
        helperInputState: 'CLOSE_REQUESTED',
        helperProcessUnrefRequested: true,
        helperStdinUnrefRequested: true,
        helperStdoutUnrefRequested: true,
    });
    expect(captured.proof.helperPid).toBeGreaterThan(0);
    expect(captured.proof.scriptSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(captured.proof.lateProofBuffer).toMatchObject({
        queuedProofs: expect.any(Array),
        partialBytes: expect.any(Number),
    });
}, 60000);
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Main Lingxing stable-identity enrollment wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

  it('rejects saved enrollment before entering the visible-browser transition', () => {
    const login = source.slice(
      source.indexOf('async function handleBrowserLogin'),
      source.indexOf('async function performBrowserLoginInUserLane'),
    );
    const pendingGuard = login.indexOf("lingxingIdentityReadiness === 'enrollment_pending'");
    const transition = login.indexOf('runUserVisibleBrowserTransition({');
    expect(pendingGuard).toBeGreaterThan(-1);
    expect(pendingGuard).toBeLessThan(transition);
    expect(login.slice(pendingGuard, transition)).toContain("request.credentialSource !== 'typed'");
  });

  it('enrolls from Main-only evidence before committing ready session metadata', () => {
    const login = source.slice(
      source.indexOf('async function performBrowserLoginInUserLane'),
      source.indexOf('async function handleBrowserLogout'),
    );
    const reusedGuard = login.indexOf("connections.lingxingIdentityReadiness === 'enrollment_pending'");
    const downloadCenter = login.indexOf('await navigateToLingxingDownloadCenter(');
    const enroll = login.indexOf('state.storeRepo.enrollLingxingStableExternalAccount({');
    const readyCommit = login.indexOf('const readyLingxingConnection = state.db!.transaction');
    const sessionReady = login.indexOf('state.storeRepo!.saveSessionMetadata({', readyCommit);
    expect(reusedGuard).toBeGreaterThan(-1);
    expect(login.slice(reusedGuard, enroll)).toContain('erpSessionReused');
    expect(downloadCenter).toBeGreaterThan(reusedGuard);
    expect(downloadCenter).toBeLessThan(enroll);
    expect(enroll).toBeGreaterThan(reusedGuard);
    expect(readyCommit).toBeGreaterThan(enroll);
    expect(sessionReady).toBeGreaterThan(readyCommit);
    expect(login.slice(enroll, readyCommit)).toContain('expectedUpdatedAt: connections.lingxing.updatedAt');
  });

  it('requires explicit typed authority before resetting only the active store Lingxing session', () => {
    const login = source.slice(
      source.indexOf('async function performBrowserLoginInUserLane'),
      source.indexOf('async function handleBrowserLogout'),
    );
    const recovery = login.indexOf('await recoverLingxingEnrollmentSession({');
    const clearCookies = login.indexOf('await browserContext.clearCookies()', recovery);
    const enroll = login.indexOf('state.storeRepo.enrollLingxingStableExternalAccount({');
    expect(recovery).toBeGreaterThan(-1);
    expect(login.slice(recovery, clearCookies)).toContain(
      "request.resetLingxingSessionForEnrollment === true",
    );
    expect(login.slice(recovery, clearCookies)).toContain('window.localStorage.clear()');
    expect(login.slice(recovery, clearCookies)).toContain('window.sessionStorage.clear()');
    expect(clearCookies).toBeGreaterThan(recovery);
    expect(enroll).toBeGreaterThan(clearCookies);
    expect(login.slice(recovery, enroll)).not.toMatch(/rmSync|removeSync|delete.*Profile/i);
  });

  it('uses only collectionStoreName as the Lingxing collection selector', () => {
    const target = source.slice(
      source.indexOf('function authorizedLingxingCollectionTarget'),
      source.indexOf('function projectBusinessReportFileForRenderer'),
    );
    expect(target).toContain('connection.collectionStoreName?.trim()');
    expect(target).not.toContain('connection.externalAccountId?.trim()');
  });
});

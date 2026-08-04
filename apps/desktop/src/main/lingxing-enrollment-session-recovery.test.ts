import { describe, expect, it, vi } from 'vitest';
import {
  LINGXING_ENROLLMENT_SESSION_RECOVERY_REQUIRED,
  recoverLingxingEnrollmentSession,
  type LingxingEnrollmentSessionRecoveryPort,
} from './lingxing-enrollment-session-recovery';

function recoveryPort(loginFormReady = true): LingxingEnrollmentSessionRecoveryPort {
  return {
    bringToFront: vi.fn(async () => undefined),
    clearStoreSession: vi.fn(async () => undefined),
    navigateToLogin: vi.fn(async () => undefined),
    isLoginFormReady: vi.fn(async () => loginFormReady),
  };
}

describe('Lingxing pending-enrollment session recovery', () => {
  it('does nothing when enrollment is already configured or no session was reused', async () => {
    const port = recoveryPort();
    await expect(recoverLingxingEnrollmentSession({
      enrollmentPending: false,
      sessionReused: true,
      resetConfirmed: false,
      port,
    })).resolves.toBe(false);
    await expect(recoverLingxingEnrollmentSession({
      enrollmentPending: true,
      sessionReused: false,
      resetConfirmed: false,
      port,
    })).resolves.toBe(false);
    expect(port.bringToFront).not.toHaveBeenCalled();
    expect(port.clearStoreSession).not.toHaveBeenCalled();
  });

  it('fails closed without mutating the store profile until the operator confirms reset', async () => {
    const port = recoveryPort();
    await expect(recoverLingxingEnrollmentSession({
      enrollmentPending: true,
      sessionReused: true,
      resetConfirmed: false,
      port,
    })).rejects.toMatchObject({ code: LINGXING_ENROLLMENT_SESSION_RECOVERY_REQUIRED });
    expect(port.bringToFront).toHaveBeenCalledOnce();
    expect(port.clearStoreSession).not.toHaveBeenCalled();
    expect(port.navigateToLogin).not.toHaveBeenCalled();
  });

  it('resets only after confirmation and requires a visible login form before enrollment continues', async () => {
    const port = recoveryPort();
    await expect(recoverLingxingEnrollmentSession({
      enrollmentPending: true,
      sessionReused: true,
      resetConfirmed: true,
      port,
    })).resolves.toBe(true);
    expect(port.clearStoreSession).toHaveBeenCalledOnce();
    expect(port.navigateToLogin).toHaveBeenCalledOnce();
    expect(port.isLoginFormReady).toHaveBeenCalledOnce();
  });

  it('does not authorize enrollment when reset fails to reach the visible login form', async () => {
    const port = recoveryPort(false);
    await expect(recoverLingxingEnrollmentSession({
      enrollmentPending: true,
      sessionReused: true,
      resetConfirmed: true,
      port,
    })).rejects.toThrow(/稳定身份仍未绑定/);
  });
});

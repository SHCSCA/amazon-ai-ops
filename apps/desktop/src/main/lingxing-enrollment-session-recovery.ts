export const LINGXING_ENROLLMENT_SESSION_RECOVERY_REQUIRED =
  'LINGXING_ENROLLMENT_SESSION_RECOVERY_REQUIRED';

export interface LingxingEnrollmentSessionRecoveryPort {
  bringToFront(): Promise<void>;
  clearStoreSession(): Promise<void>;
  navigateToLogin(): Promise<void>;
  isLoginFormReady(): Promise<boolean>;
}

export interface RecoverLingxingEnrollmentSessionInput {
  enrollmentPending: boolean;
  sessionReused: boolean;
  resetConfirmed: boolean;
  port: LingxingEnrollmentSessionRecoveryPort;
}

/**
 * A pending stable-identity enrollment cannot trust an already-authenticated
 * persistent profile. Resetting that store-bound session is allowed only when
 * the operator explicitly confirms it in the login request.
 */
export async function recoverLingxingEnrollmentSession(
  input: RecoverLingxingEnrollmentSessionInput,
): Promise<boolean> {
  if (!input.enrollmentPending || !input.sessionReused) return false;

  await input.port.bringToFront();
  if (!input.resetConfirmed) {
    const error = new Error(
      '检测到该店铺复用了已有领星登录会话，首次绑定无法确认本次账号。'
      + '请确认“重置该店铺领星会话”后重试；系统不会静默删除浏览器配置。',
    ) as Error & { code?: string };
    error.code = LINGXING_ENROLLMENT_SESSION_RECOVERY_REQUIRED;
    throw error;
  }

  await input.port.clearStoreSession();
  await input.port.navigateToLogin();
  if (!await input.port.isLoginFormReady()) {
    throw new Error('该店铺领星会话已重置，但未进入可见登录页；稳定身份仍未绑定，请重试。');
  }
  return true;
}

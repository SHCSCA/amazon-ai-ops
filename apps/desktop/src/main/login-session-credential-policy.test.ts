import { describe, expect, it } from 'vitest';
import {
  decideLoginSessionCredentialPolicy,
  isPackageUiSavedSessionContinuationAllowed,
} from './login-session-credential-policy';

describe('login session credential policy', () => {
  it('preserves the secure credential and distrusts the requested username when a typed login reuses ERP state', () => {
    expect(decideLoginSessionCredentialPolicy({
      credentialSource: 'typed',
      erpSessionReused: true,
      rememberPassword: true,
    })).toEqual({
      credentialAction: 'preserve',
      credentialPersistence: 'not_saved_unverified_session',
      sessionIdentityVerified: false,
      trustRequestedUsername: false,
    });
  });

  it('does not clear the secure credential when an unremembered typed login reuses ERP state', () => {
    expect(decideLoginSessionCredentialPolicy({
      credentialSource: 'typed',
      erpSessionReused: true,
      rememberPassword: false,
    })).toEqual({
      credentialAction: 'preserve',
      credentialPersistence: 'not_saved_unverified_session',
      sessionIdentityVerified: false,
      trustRequestedUsername: false,
    });
  });

  it('saves a remembered typed password only after a visible ERP login succeeds', () => {
    expect(decideLoginSessionCredentialPolicy({
      credentialSource: 'typed',
      erpSessionReused: false,
      rememberPassword: true,
    })).toEqual({
      credentialAction: 'save',
      credentialPersistence: 'saved',
      sessionIdentityVerified: true,
      trustRequestedUsername: true,
    });
  });

  it('clears remembered credentials after a visible typed login when remembering is disabled', () => {
    expect(decideLoginSessionCredentialPolicy({
      credentialSource: 'typed',
      erpSessionReused: false,
      rememberPassword: false,
    })).toEqual({
      credentialAction: 'clear',
      credentialPersistence: 'cleared',
      sessionIdentityVerified: true,
      trustRequestedUsername: true,
    });
  });

  it('keeps saved credentials Main-managed but distrusts their username when another ERP session is reused', () => {
    expect(decideLoginSessionCredentialPolicy({
      credentialSource: 'saved',
      erpSessionReused: true,
      rememberPassword: true,
    })).toEqual({
      credentialAction: 'none',
      credentialPersistence: 'main_managed',
      sessionIdentityVerified: false,
      trustRequestedUsername: false,
    });
  });

  it('trusts a saved username only after the saved password completes a visible ERP login', () => {
    expect(decideLoginSessionCredentialPolicy({
      credentialSource: 'saved',
      erpSessionReused: false,
      rememberPassword: true,
    })).toEqual({
      credentialAction: 'none',
      credentialPersistence: 'main_managed',
      sessionIdentityVerified: true,
      trustRequestedUsername: true,
    });
  });

  it('allows one unverified saved-session continuation only inside the package UI read-only runtime', () => {
    const policy = decideLoginSessionCredentialPolicy({
      credentialSource: 'saved',
      erpSessionReused: true,
      rememberPassword: true,
    });
    expect(isPackageUiSavedSessionContinuationAllowed({
      credentialSource: 'saved',
      erpSessionReused: true,
      packageUiReadOnlyRuntime: true,
      policy,
    })).toBe(true);
    expect(isPackageUiSavedSessionContinuationAllowed({
      credentialSource: 'saved',
      erpSessionReused: true,
      packageUiReadOnlyRuntime: false,
      policy,
    })).toBe(false);
  });

  it('rejects typed, non-reused, verified, or non-Main-managed continuations even in evidence mode', () => {
    const unverifiedSavedPolicy = decideLoginSessionCredentialPolicy({
      credentialSource: 'saved',
      erpSessionReused: true,
      rememberPassword: true,
    });
    expect(isPackageUiSavedSessionContinuationAllowed({
      credentialSource: 'typed',
      erpSessionReused: true,
      packageUiReadOnlyRuntime: true,
      policy: unverifiedSavedPolicy,
    })).toBe(false);
    expect(isPackageUiSavedSessionContinuationAllowed({
      credentialSource: 'saved',
      erpSessionReused: false,
      packageUiReadOnlyRuntime: true,
      policy: unverifiedSavedPolicy,
    })).toBe(false);
    expect(isPackageUiSavedSessionContinuationAllowed({
      credentialSource: 'saved',
      erpSessionReused: true,
      packageUiReadOnlyRuntime: true,
      policy: {
        ...unverifiedSavedPolicy,
        credentialPersistence: 'saved',
      },
    })).toBe(false);
    expect(isPackageUiSavedSessionContinuationAllowed({
      credentialSource: 'saved',
      erpSessionReused: true,
      packageUiReadOnlyRuntime: true,
      policy: {
        ...unverifiedSavedPolicy,
        sessionIdentityVerified: true,
      },
    })).toBe(false);
  });
});

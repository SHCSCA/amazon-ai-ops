import type { BrowserLoginCredentialPersistence } from '../shared/login-contract';

export type LoginCredentialAction = 'save' | 'clear' | 'preserve' | 'none';

export interface LoginSessionCredentialPolicyInput {
  credentialSource: 'saved' | 'typed';
  erpSessionReused: boolean;
  rememberPassword: boolean;
}

export interface LoginSessionCredentialPolicy {
  credentialAction: LoginCredentialAction;
  credentialPersistence: BrowserLoginCredentialPersistence;
  sessionIdentityVerified: boolean;
  trustRequestedUsername: boolean;
}

export function decideLoginSessionCredentialPolicy(
  input: LoginSessionCredentialPolicyInput,
): LoginSessionCredentialPolicy {
  if (input.credentialSource === 'typed' && input.erpSessionReused) {
    return {
      credentialAction: 'preserve',
      credentialPersistence: 'not_saved_unverified_session',
      sessionIdentityVerified: false,
      trustRequestedUsername: false,
    };
  }

  if (input.credentialSource === 'saved' && input.erpSessionReused) {
    return {
      credentialAction: 'none',
      credentialPersistence: 'main_managed',
      sessionIdentityVerified: false,
      trustRequestedUsername: false,
    };
  }

  if (input.credentialSource === 'typed' && input.rememberPassword) {
    return {
      credentialAction: 'save',
      credentialPersistence: 'saved',
      sessionIdentityVerified: true,
      trustRequestedUsername: true,
    };
  }

  if (input.credentialSource === 'typed') {
    return {
      credentialAction: 'clear',
      credentialPersistence: 'cleared',
      sessionIdentityVerified: true,
      trustRequestedUsername: true,
    };
  }

  return {
    credentialAction: 'none',
    credentialPersistence: 'main_managed',
    sessionIdentityVerified: true,
    trustRequestedUsername: true,
  };
}

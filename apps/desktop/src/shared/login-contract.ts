export type BrowserLoginRequest =
  | {
      username: string;
      credentialSource: 'saved';
      rememberPassword: true;
    }
  | {
      username: string;
      credentialSource: 'typed';
      password: string;
      rememberPassword: boolean;
    };

export type BrowserLoginCredentialPersistence =
  | 'saved'
  | 'cleared'
  | 'main_managed'
  | 'not_saved_unverified_session';

export interface BrowserLoginResult {
  ok: true;
  currentStore: string;
  erpSessionReused: boolean;
  sessionIdentityVerified: boolean;
  adsEntryMode: 'erp_ads_entry';
  adsUrl: string;
  adsTitle: string;
  credentialPersistence: BrowserLoginCredentialPersistence;
}

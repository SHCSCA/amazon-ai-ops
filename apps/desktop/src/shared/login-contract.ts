import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

type BrowserLoginAuthority = {
  storeContext: StoreContextEnvelope;
  amazonAdsProfileId: string;
};

export type BrowserLoginRequest = BrowserLoginAuthority & (
  {
      username: string;
      credentialSource: 'saved';
      rememberPassword: true;
    }
  | {
      username: string;
      credentialSource: 'typed';
      password: string;
      rememberPassword: boolean;
    }
);

export type BrowserLoginCredentialPersistence =
  | 'saved'
  | 'cleared'
  | 'main_managed'
  | 'not_saved_unverified_session';

export interface BrowserLoginResult {
  ok: true;
  credentialSource: 'saved' | 'typed';
  currentStore: string;
  erpSessionReady: true;
  erpSessionReused: boolean;
  sessionIdentityVerified: boolean;
  adsSessionReady: boolean;
  adsEntryMode?: 'erp_ads_entry';
  adsUrl?: string;
  adsTitle?: string;
  adsUnavailableReason?: string;
  credentialPersistence: BrowserLoginCredentialPersistence;
}

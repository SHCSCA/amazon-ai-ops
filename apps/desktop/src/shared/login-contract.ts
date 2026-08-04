import type { StoreContextEnvelope, StoreId } from '@amazon-ai-ops/shared-types';

export type SavedLoginCredentialState =
  | 'none'
  | 'encrypted_ready'
  | 'migrated'
  | 'encryption_unavailable'
  | 'encrypted_corrupt'
  | 'migration_failed';

export interface StoreScopedSavedLoginCredentialStatus {
  /** Main-captured authority. Null means no active store and therefore no credential namespace. */
  storeId: StoreId | null;
  username: string;
  rememberPassword: boolean;
  passwordAvailable: boolean;
  credentialState: SavedLoginCredentialState;
  packageUiEvidenceMode: boolean;
  freshTypedProofRequired: boolean;
}

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
      /** Explicit authority to clear only this store's Lingxing session state during first enrollment. */
      resetLingxingSessionForEnrollment?: boolean;
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

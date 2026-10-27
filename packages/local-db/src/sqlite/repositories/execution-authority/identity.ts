import  {
  type AdKeywordAliasResolutionRecord,
  type AdKeywordIdentityVersionRecord,
  type RecordAdKeywordAliasResolutionInput,
  type RegisterAdKeywordIdentityInput,
  type ResolveCanonicalKeywordInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { IdentityRow, AliasRow } from './contracts';
import { ExecutionAuthorityRepositoryError } from './errors';
import { mapIdentity, mapAlias } from './rows';
import  {
  normalizeContext,
  idOf,
  safeProjectionText,
  positiveInt,
  sha256Of,
  timestampOf,
  hashObject,
  notFound,
  referenceConflict,
  revisionConflict,
} from './values';
import type { ExecutionAuthorityRepositoryContext } from './context';
export function registerCanonicalKeywordIdentity(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: RegisterAdKeywordIdentityInput): AdKeywordIdentityVersionRecord {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
        this.assertContext(context, input.adsAccountId);
        const adEntityId = idOf(input.adEntityId, 'adEntityId');
        const entityRevision = positiveInt(input.entityRevision, 'entityRevision');
        const latestAuthority = this.db.prepare(`
        SELECT authority_id AS authorityId, entity_revision AS entityRevision,
               entity_type AS entityType, proof_sha256 AS proofSha256
        FROM verified_ad_entity_authority
        WHERE store_id = ? AND ad_entity_id = ?
        ORDER BY entity_revision DESC, created_at DESC, authority_id DESC LIMIT 1
      `).get(context.storeId, adEntityId) as {
            authorityId: string;
            entityRevision: number;
            entityType: string;
            proofSha256: string;
        } | undefined;
        if (!latestAuthority)
            throw notFound(`Stage 5 Ads entity ${adEntityId} was not found.`);
        if (latestAuthority.entityType !== 'keyword') {
            throw referenceConflict('Execution V1 accepts only a Stage 5 keyword authority.');
        }
        if (latestAuthority.entityRevision !== entityRevision) {
            throw revisionConflict(`Stage 5 Ads entity revision is stale; expected ${latestAuthority.entityRevision}, received ${entityRevision}.`);
        }
        const adsAccountId = idOf(input.adsAccountId, 'adsAccountId');
        const campaignId = idOf(input.campaignId, 'campaignId');
        const adGroupId = idOf(input.adGroupId, 'adGroupId');
        const keywordId = idOf(input.keywordId, 'keywordId');
        const observedBidCents = positiveInt(input.observedBidCents, 'observedBidCents');
        const pageIdentityHash = sha256Of(input.pageIdentityHash, 'pageIdentityHash');
        const sourceAuthorityProofSha256 = sha256Of(latestAuthority.proofSha256, 'sourceAuthorityProofSha256');
        const resolutionProofSha256 = sha256Of(input.resolutionProofSha256, 'resolutionProofSha256');
        const resolvedAt = timestampOf(input.resolvedAt, 'resolvedAt');
        if (Date.parse(resolvedAt) > this.now().getTime()) {
            throw referenceConflict('Canonical keyword resolution cannot be observed in the future.');
        }
        const resolvedBy = idOf(input.resolvedBy, 'resolvedBy');
        const canonicalKeywordId = `ad-keyword:${hashObject([
            context.storeId, adsAccountId, campaignId, adGroupId, keywordId,
        ]).slice(0, 40)}`;
        const existing = this.db.prepare(`
        SELECT * FROM ad_keyword_identity_versions
        WHERE store_id = ? AND ad_entity_id = ? AND entity_revision = ?
        ORDER BY object_revision DESC, created_at DESC, identity_version_id DESC
        LIMIT 1
      `).get(context.storeId, adEntityId, entityRevision) as IdentityRow | undefined;
        if (existing) {
            const mapped = mapIdentity(existing);
            const stableMapping = mapped.canonicalKeywordId === canonicalKeywordId
                && mapped.adsAccountId === adsAccountId
                && mapped.campaignId === campaignId
                && mapped.adGroupId === adGroupId
                && mapped.keywordId === keywordId
                && mapped.pageIdentityHash === pageIdentityHash
                && mapped.sourceAuthorityId === latestAuthority.authorityId
                && mapped.sourceAuthorityProofSha256 === sourceAuthorityProofSha256;
            if (!stableMapping) {
                throw referenceConflict('Stage 5 entity revision drifted across canonical ids, page identity, or source authority.');
            }
            const sameResolution = mapped.resolvedSessionGeneration === context.sessionGeneration
                && mapped.observedBidCents === observedBidCents
                && mapped.resolutionProofSha256 === resolutionProofSha256;
            if (sameResolution) {
                return mapped;
            }
        }
        const objectRevision = Number((this.db.prepare(`
        SELECT COALESCE(MAX(object_revision), 0) + 1 AS revision
        FROM ad_keyword_identity_versions WHERE store_id = ? AND canonical_keyword_id = ?
      `).get(context.storeId, canonicalKeywordId) as {
            revision: number;
        }).revision);
        const createdAt = this.timestamp();
        const identityVersionId = `kwid-${hashObject([
            context.storeId, adEntityId, entityRevision, canonicalKeywordId, objectRevision,
        ]).slice(0, 40)}`;
        this.db.prepare(`
        INSERT INTO ad_keyword_identity_versions (
          identity_version_id, store_id, marketplace, currency, canonical_keyword_id,
          ad_entity_id, entity_revision, ads_account_id, campaign_id, ad_group_id,
          keyword_id, object_revision, observed_bid_cents, page_identity_hash,
          source_authority_id, source_authority_proof_sha256, resolution_proof_sha256,
          resolved_session_generation, resolved_at, resolved_by, created_at
        ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(identityVersionId, context.storeId, canonicalKeywordId, adEntityId, entityRevision, adsAccountId, campaignId, adGroupId, keywordId, objectRevision, observedBidCents, pageIdentityHash, latestAuthority.authorityId, sourceAuthorityProofSha256, resolutionProofSha256, context.sessionGeneration, resolvedAt, resolvedBy, createdAt);
        return this.requireIdentityVersion(context.storeId, canonicalKeywordId, objectRevision);
    });
}
export function resolveCanonicalKeyword(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: ResolveCanonicalKeywordInput): AdKeywordIdentityVersionRecord {
    const context = normalizeContext(contextInput);
    this.assertContext(context, input.adsAccountId);
    const row = this.db.prepare(`
      SELECT * FROM ad_keyword_identity_versions
      WHERE store_id = ? AND ads_account_id = ? AND campaign_id = ?
        AND ad_group_id = ? AND keyword_id = ?
      ORDER BY object_revision DESC, created_at DESC, identity_version_id DESC LIMIT 1
    `).get(context.storeId, idOf(input.adsAccountId, 'adsAccountId'), idOf(input.campaignId, 'campaignId'), idOf(input.adGroupId, 'adGroupId'), idOf(input.keywordId, 'keywordId')) as IdentityRow | undefined;
    if (!row)
        throw notFound('Canonical keyword identity was not found.');
    if (input.expectedObjectRevision !== undefined
        && positiveInt(input.expectedObjectRevision, 'expectedObjectRevision') !== row.object_revision) {
        throw revisionConflict(`Canonical keyword revision is stale; expected ${row.object_revision}, received ${input.expectedObjectRevision}.`);
    }
    return mapIdentity(row);
}
export function listCanonicalKeywordIdentities(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope): readonly AdKeywordIdentityVersionRecord[] {
    const context = normalizeContext(contextInput);
    this.assertContext(context);
    return (this.db.prepare(`
      SELECT identity.* FROM ad_keyword_identity_versions identity
      WHERE identity.store_id = ? AND NOT EXISTS (
        SELECT 1 FROM ad_keyword_identity_versions newer
        WHERE newer.store_id = identity.store_id
          AND newer.canonical_keyword_id = identity.canonical_keyword_id
          AND newer.object_revision > identity.object_revision
      ) ORDER BY identity.canonical_keyword_id
    `).all(context.storeId) as IdentityRow[]).map(mapIdentity);
}
export function recordCanonicalKeywordAliasResolution(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: RecordAdKeywordAliasResolutionInput): AdKeywordAliasResolutionRecord {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
        this.assertContext(context);
        const canonicalKeywordId = idOf(input.canonicalKeywordId, 'canonicalKeywordId');
        const objectRevision = positiveInt(input.objectRevision, 'objectRevision');
        this.requireIdentityVersion(context.storeId, canonicalKeywordId, objectRevision);
        const aliasHash = sha256Of(input.aliasHash, 'aliasHash');
        const resolvedAt = timestampOf(input.resolvedAt, 'resolvedAt');
        if (Date.parse(resolvedAt) > this.now().getTime()) {
            throw referenceConflict('Canonical keyword alias resolution cannot be observed in the future.');
        }
        const prior = this.db.prepare(`
        SELECT COALESCE(MAX(resolution_revision), 0) AS revision
        FROM ad_keyword_alias_resolutions WHERE store_id = ? AND alias_type = ? AND alias_hash = ?
      `).get(context.storeId, input.aliasType, aliasHash) as {
            revision: number;
        };
        const resolutionRevision = Number(prior.revision) + 1;
        const id = idOf(input.id, 'id');
        this.db.prepare(`
        INSERT INTO ad_keyword_alias_resolutions (
          id, store_id, alias_type, alias_hash, canonical_keyword_id, object_revision,
          resolution_revision, status, reason, resolved_session_generation,
          resolved_at, resolved_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, context.storeId, input.aliasType, aliasHash, canonicalKeywordId, objectRevision, resolutionRevision, input.status, input.reason === undefined ? null : safeProjectionText(input.reason, 'reason'), context.sessionGeneration, resolvedAt, idOf(input.resolvedBy, 'resolvedBy'));
        return mapAlias(this.db.prepare(`
        SELECT * FROM ad_keyword_alias_resolutions WHERE store_id = ? AND id = ?
      `).get(context.storeId, id) as AliasRow);
    });
}
export function requireIdentityVersion(this: ExecutionAuthorityRepositoryContext, storeId: string, canonicalKeywordId: string, objectRevision: number): AdKeywordIdentityVersionRecord {
    const row = this.db.prepare(`
      SELECT * FROM ad_keyword_identity_versions
      WHERE store_id = ? AND canonical_keyword_id = ? AND object_revision = ?
    `).get(storeId, canonicalKeywordId, objectRevision) as IdentityRow | undefined;
    if (!row)
        throw notFound('Canonical keyword identity revision was not found.');
    return mapIdentity(row);
}
export function requireLatestIdentityForEntity(this: ExecutionAuthorityRepositoryContext, context: StoreContextEnvelope, adEntityId: string, entityRevision: number): AdKeywordIdentityVersionRecord {
    const latestAuthority = this.db.prepare(`
      SELECT entity_revision AS revision FROM verified_ad_entity_authority
      WHERE store_id = ? AND ad_entity_id = ?
      ORDER BY entity_revision DESC, created_at DESC, authority_id DESC LIMIT 1
    `).get(context.storeId, adEntityId) as {
        revision: number;
    } | undefined;
    if (!latestAuthority || latestAuthority.revision !== entityRevision) {
        throw revisionConflict('Proposal is not bound to the latest Stage 5 Ads entity revision.');
    }
    const row = this.db.prepare(`
      SELECT identity.* FROM ad_keyword_identity_versions identity
      WHERE identity.store_id = ? AND identity.ad_entity_id = ? AND identity.entity_revision = ?
      ORDER BY identity.object_revision DESC, identity.created_at DESC, identity.identity_version_id DESC
      LIMIT 1
    `).get(context.storeId, adEntityId, entityRevision) as IdentityRow | undefined;
    if (!row)
        throw referenceConflict('Proposal has no latest canonical keyword identity for its Stage 5 entity revision.');
    const identity = mapIdentity(row);
    if (identity.resolvedSessionGeneration !== context.sessionGeneration) {
        throw new ExecutionAuthorityRepositoryError('STALE_CONTEXT', 'Canonical keyword identity must be resolved again in the current Amazon Ads session generation.');
    }
    return identity;
}

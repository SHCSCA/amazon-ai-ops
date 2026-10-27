// 按职责复用原有严格校验，公共入口继续保持兼容。
const { EXPECTED_REPORT_TYPES, BUSINESS_TIMEZONE, evaluateContinuousOperationSnapshot, loadAuthoritySnapshotManifest, readContinuousOperationSnapshot, recentCompletedUsBusinessDates, } = require('./verify-s7-continuous-operation');
const { normalizedId, providerGapPrefix, stableRef, storeAliasMap, timestampAtOrBefore } = require('./stage8-operator-contracts.js');
const { tableSet } = require('./stage8-operator-schema.js');

function storeRows(database, selectedIds) {
    const tables = tableSet(database);
    if (!tables.has('stores'))
        return [];
    const all = database.prepare(`
    SELECT store_id AS storeId, browser_profile_id AS browserProfileId,
           marketplace, currency, display_name AS displayName, status,
           business_timezone AS businessTimezone
    FROM stores
    ORDER BY lower(store_id)
  `).all();
    if (selectedIds.length === 0) {
        const active = all.filter((row) => (row.status === 'active'
            && row.marketplace === 'US'
            && row.currency === 'USD'));
        return active.length === 2 ? active : [];
    }
    const selected = new Set(selectedIds);
    return all.filter((row) => selected.has(normalizedId(row.storeId)));
}

function sessionOperationalGaps(session, generatedAtMs) {
    const prefix = providerGapPrefix(session.provider);
    const gaps = [];
    if (!session.present)
        gaps.push(`${prefix}_SESSION_MISSING`);
    else {
        if (session.status !== 'ready')
            gaps.push(`${prefix}_SESSION_NOT_READY`);
        if (!session.profileMatchesStore)
            gaps.push(`${prefix}_SESSION_PROFILE_MISMATCH`);
        if (!timestampAtOrBefore(session.observedAt, generatedAtMs)) {
            gaps.push(`${prefix}_SESSION_OBSERVED_AT_INVALID`);
        }
        if (!timestampAtOrBefore(session.verifiedAt, generatedAtMs)) {
            gaps.push(`${prefix}_SESSION_VERIFIED_AT_INVALID`);
        }
        if (session.expiresAt !== null) {
            const expiresAtMs = Date.parse(String(session.expiresAt));
            if (!Number.isFinite(expiresAtMs))
                gaps.push(`${prefix}_SESSION_EXPIRES_AT_INVALID`);
            else if (expiresAtMs <= generatedAtMs)
                gaps.push(`${prefix}_SESSION_EXPIRED`);
        }
    }
    return gaps;
}

function inspectStores(database, selectedIds, generatedAt = new Date().toISOString()) {
    const tables = tableSet(database);
    const generatedAtMs = Date.parse(generatedAt);
    const allStoreCount = tables.has('stores')
        ? Number(database.prepare('SELECT COUNT(*) AS count FROM stores').get().count)
        : 0;
    const activeUsUsdCount = tables.has('stores')
        ? Number(database.prepare(`
      SELECT COUNT(*) AS count FROM stores
      WHERE status = 'active' AND marketplace = 'US' AND currency = 'USD'
    `).get().count)
        : 0;
    const selected = storeRows(database, selectedIds);
    const aliases = storeAliasMap(selected);
    const connections = tables.has('store_connections')
        ? database.prepare(`
      SELECT store_id AS storeId, provider, status, last_verified_at AS lastVerifiedAt,
             last_failure_code AS lastFailureCode
      FROM store_connections
    `).all()
        : [];
    const sessions = tables.has('store_session_metadata')
        ? database.prepare(`
      SELECT store_id AS storeId, provider, browser_profile_id AS browserProfileId,
             status, session_generation AS sessionGeneration,
             observed_at AS observedAt, verified_at AS verifiedAt,
             expires_at AS expiresAt, failure_code AS failureCode
      FROM store_session_metadata
    `).all()
        : [];
    const items = selected.map((store) => {
        const storeConnections = connections.filter((row) => normalizedId(row.storeId) === normalizedId(store.storeId));
        const storeSessions = sessions.filter((row) => normalizedId(row.storeId) === normalizedId(store.storeId));
        return {
            alias: aliases.get(normalizedId(store.storeId)),
            authority: {
                active: store.status === 'active',
                businessTimezone: store.businessTimezone,
                currency: store.currency,
                marketplace: store.marketplace,
            },
            connections: ['lingxing', 'amazon_ads'].map((provider) => {
                const row = storeConnections.find((item) => item.provider === provider);
                return {
                    hasFailureCode: Boolean(row?.lastFailureCode),
                    lastVerifiedAt: row?.lastVerifiedAt || null,
                    present: Boolean(row),
                    provider,
                    status: row?.status || 'not_configured',
                };
            }),
            profileRef: stableRef('profile', store.browserProfileId),
            sessions: ['lingxing', 'amazon_ads'].map((provider) => {
                const row = storeSessions.find((item) => item.provider === provider);
                return {
                    expiresAt: row?.expiresAt || null,
                    generation: Number(row?.sessionGeneration ?? 0),
                    hasFailureCode: Boolean(row?.failureCode),
                    observedAt: row?.observedAt || null,
                    present: Boolean(row),
                    profileMatchesStore: row
                        ? normalizedId(row.browserProfileId) === normalizedId(store.browserProfileId)
                        : false,
                    provider,
                    status: row?.status || 'unknown',
                    verifiedAt: row?.verifiedAt || null,
                };
            }),
        };
    });
    for (const item of items) {
        const gaps = [];
        for (const connection of item.connections) {
            const prefix = providerGapPrefix(connection.provider);
            if (!connection.present)
                gaps.push(`${prefix}_CONNECTION_MISSING`);
            else if (connection.status !== 'ready')
                gaps.push(`${prefix}_CONNECTION_NOT_READY`);
        }
        for (const session of item.sessions) {
            gaps.push(...sessionOperationalGaps(session, generatedAtMs));
        }
        item.operationalStatus = {
            gaps,
            status: gaps.length === 0 ? 'READY' : 'BLOCKED',
        };
    }
    const profiles = selected.map((store) => normalizedId(store.browserProfileId)).filter(Boolean);
    const authorityValid = activeUsUsdCount === 2
        && selected.length === 2
        && new Set(profiles).size === 2
        && profiles.length === 2
        && items.every((item) => (item.authority.active
            && item.authority.marketplace === 'US'
            && item.authority.currency === 'USD'
            && item.authority.businessTimezone === BUSINESS_TIMEZONE));
    const operationalReady = items.length === 2
        && items.every((item) => item.operationalStatus.status === 'READY');
    return {
        activeUsUsdCount,
        allStoreCount,
        aliases,
        items,
        operationalStatus: {
            status: operationalReady ? 'READY' : 'BLOCKED',
            stores: items.map((item) => ({
                gaps: item.operationalStatus.gaps,
                status: item.operationalStatus.status,
                storeAlias: item.alias,
            })),
        },
        rawStores: selected,
        selectedCount: selected.length,
        authorityStatus: authorityValid ? 'READY' : 'NEEDS_CONFIGURATION',
        status: authorityValid && operationalReady ? 'READY' : 'NEEDS_CONFIGURATION',
    };
}

module.exports = { storeRows, sessionOperationalGaps, inspectStores };

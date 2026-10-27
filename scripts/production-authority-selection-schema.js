// 按职责复用原有严格校验，公共入口继续保持兼容。

const { V11_STORE_PROVIDER_IDENTITY_COLUMNS, V11_STORE_PROVIDER_IDENTITY_INDEX, V11_STORE_PROVIDER_IDENTITY_ROW_INVARIANTS, V11_STORE_PROVIDER_IDENTITY_TRIGGERS, canonicalSql, fail } = require('./production-authority-selection-contracts.js');

function tableNames(database) {
    return new Set(database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `).all().map((row) => String(row.name)));
}

function storeProviderIdentityV11SchemaContract() {
    return {
        targetVersion: 11,
        columns: V11_STORE_PROVIDER_IDENTITY_COLUMNS.map((column) => ({ ...column })),
        uniquePartialIndex: {
            name: V11_STORE_PROVIDER_IDENTITY_INDEX.name,
            table: V11_STORE_PROVIDER_IDENTITY_INDEX.table,
            unique: true,
            partial: true,
            columns: [...V11_STORE_PROVIDER_IDENTITY_INDEX.columns],
            where: 'normalized_external_account_id IS NOT NULL',
        },
        triggers: Object.keys(V11_STORE_PROVIDER_IDENTITY_TRIGGERS),
        rowInvariants: [...V11_STORE_PROVIDER_IDENTITY_ROW_INVARIANTS],
    };
}

function normalizeV11Identity(value, label) {
    if (value === null)
        return null;
    if (typeof value !== 'string')
        throw new Error(`${label} must be a string or NULL`);
    const raw = value.trim();
    if (!raw)
        return null;
    const normalized = raw.normalize('NFKC').trim();
    if (!normalized)
        return null;
    if (normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw new Error(`${label} exceeds the v11 identity boundary`);
    }
    return normalized.toLowerCase();
}

function inspectStoreProviderIdentityV11Rows(database) {
    const violations = [];
    const stores = database.prepare(`
    SELECT store_id, marketplace, currency, business_timezone
    FROM stores
    WHERE marketplace <> 'US'
       OR currency <> 'USD'
       OR business_timezone <> 'America/Los_Angeles'
    ORDER BY store_id
  `).all();
    for (const row of stores) {
        violations.push(`store ${row.store_id} has unsupported authority ${row.marketplace}/${row.currency}/${row.business_timezone}`);
    }
    const rows = database.prepare(`
    SELECT id, store_id, provider, external_account_id,
      normalized_external_account_id, collection_store_name,
      normalized_collection_store_name
    FROM store_connections
    ORDER BY provider, id
  `).all();
    const owners = new Map();
    for (const row of rows) {
        try {
            if (row.provider !== 'lingxing' && row.provider !== 'amazon_ads') {
                violations.push(`connection ${row.id} has unsupported provider ${row.provider}`);
                continue;
            }
            const expectedExternal = normalizeV11Identity(row.external_account_id, `connection ${row.id} external identity`);
            const persistedExternal = row.normalized_external_account_id ?? null;
            if ((row.external_account_id === null) !== (persistedExternal === null)
                || persistedExternal !== expectedExternal) {
                violations.push(`connection ${row.id} has inconsistent raw/normalized provider identity`);
            }
            const expectedSelector = normalizeV11Identity(row.collection_store_name, `connection ${row.id} Lingxing selector`);
            const persistedSelector = row.normalized_collection_store_name ?? null;
            if (row.provider === 'amazon_ads'
                && (row.collection_store_name !== null || persistedSelector !== null)) {
                violations.push(`amazon_ads connection ${row.id} carries a Lingxing selector`);
            }
            if ((row.collection_store_name === null) !== (persistedSelector === null)
                || persistedSelector !== expectedSelector) {
                violations.push(`connection ${row.id} has inconsistent raw/normalized Lingxing selector`);
            }
            if (expectedExternal !== null) {
                const key = `${row.provider}\u0000${expectedExternal}`;
                const owner = owners.get(key);
                if (owner) {
                    violations.push(`provider identity ${row.provider}/${expectedExternal} has multiple owners ${owner.id}/${row.id}`);
                }
                else {
                    owners.set(key, row);
                }
            }
        }
        catch (error) {
            violations.push(error instanceof Error ? error.message : String(error));
        }
    }
    return violations;
}

function inspectStoreProviderIdentityV11Schema(database) {
    const violations = [];
    const table = database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'store_connections'
  `).get();
    if (!table) {
        return {
            ...storeProviderIdentityV11SchemaContract(),
            passed: false,
            violations: ['store_connections table is missing'],
            rowInvariantViolations: ['row invariants could not be evaluated'],
        };
    }
    const tableColumns = database.pragma('table_info("store_connections")');
    for (const expected of V11_STORE_PROVIDER_IDENTITY_COLUMNS) {
        const actual = tableColumns.find((column) => String(column.name) === expected.name);
        if (!actual
            || String(actual.type ?? '').toUpperCase() !== expected.type
            || Number(actual.notnull) !== expected.notNull
            || (actual.dflt_value ?? null) !== expected.defaultValue
            || Number(actual.pk) !== expected.primaryKey) {
            violations.push(`column ${expected.name} is missing or differs from the v11 contract`);
        }
    }
    const index = database.prepare(`
    SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = ?
  `).get(V11_STORE_PROVIDER_IDENTITY_INDEX.name);
    const indexList = database.pragma('index_list("store_connections")');
    const indexFlags = indexList.find((candidate) => String(candidate.name) === V11_STORE_PROVIDER_IDENTITY_INDEX.name);
    const indexColumns = index
        ? database.pragma(`index_xinfo("${V11_STORE_PROVIDER_IDENTITY_INDEX.name}")`)
            .filter((column) => Number(column.key) === 1)
            .sort((left, right) => Number(left.seqno) - Number(right.seqno))
            .map((column) => String(column.name))
        : [];
    if (!index
        || Number(indexFlags?.unique) !== V11_STORE_PROVIDER_IDENTITY_INDEX.unique
        || Number(indexFlags?.partial) !== V11_STORE_PROVIDER_IDENTITY_INDEX.partial
        || JSON.stringify(indexColumns) !== JSON.stringify(V11_STORE_PROVIDER_IDENTITY_INDEX.columns)
        || canonicalSql(index.sql) !== canonicalSql(V11_STORE_PROVIDER_IDENTITY_INDEX.sql)) {
        violations.push(`index ${V11_STORE_PROVIDER_IDENTITY_INDEX.name} is missing or differs from the v11 contract`);
    }
    for (const [name, expectedSql] of Object.entries(V11_STORE_PROVIDER_IDENTITY_TRIGGERS)) {
        const trigger = database.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?
    `).get(name);
        if (!trigger || canonicalSql(trigger.sql) !== canonicalSql(expectedSql)) {
            violations.push(`trigger ${name} is missing or differs from the v11 contract`);
        }
    }
    let rowInvariantViolations = [];
    if (violations.some((violation) => violation.startsWith('column '))) {
        rowInvariantViolations = ['row invariants could not be evaluated against incomplete v11 columns'];
    }
    else {
        try {
            rowInvariantViolations = inspectStoreProviderIdentityV11Rows(database);
        }
        catch (error) {
            rowInvariantViolations = [error instanceof Error ? error.message : String(error)];
        }
    }
    violations.push(...rowInvariantViolations);
    return {
        ...storeProviderIdentityV11SchemaContract(),
        passed: violations.length === 0,
        violations,
        rowInvariantViolations,
    };
}

function assertStoreProviderIdentityV11Schema(database, label = 'v11 store provider identity schema') {
    const inspection = inspectStoreProviderIdentityV11Schema(database);
    if (!inspection.passed) {
        fail(`${label} is invalid: ${inspection.violations.join('; ')}`);
    }
    return inspection;
}

module.exports = { tableNames, storeProviderIdentityV11SchemaContract, normalizeV11Identity, inspectStoreProviderIdentityV11Rows, inspectStoreProviderIdentityV11Schema, assertStoreProviderIdentityV11Schema };

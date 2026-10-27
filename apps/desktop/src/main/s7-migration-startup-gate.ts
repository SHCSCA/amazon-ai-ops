// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import { defaultReadStableFile, defaultInspectDirectory, defaultBuildAppContentManifest, defaultWriteProtectedExclusiveJson } from './s7-startup-gate-files';
import { defaultInspectWindowsPathSecurity, defaultInspectTrustedPowerShell, defaultProtectWindowsPath } from './s7-startup-gate-security';
import { defaultReadAuthoritySchemaVersion, defaultInspectPostMigrationAuthority, postMigrationContractSha256 } from './s7-startup-gate-authority';
import { sha256, stableJson } from './s7-startup-gate-contracts';

export const S7_STARTUP_GATE_TESTING = Object.freeze({
    defaultReadStableFile,
    defaultInspectDirectory,
    defaultInspectWindowsPathSecurity,
    defaultBuildAppContentManifest,
    defaultReadAuthoritySchemaVersion,
    defaultInspectPostMigrationAuthority,
    defaultInspectTrustedPowerShell,
    defaultProtectWindowsPath,
    defaultWriteProtectedExclusiveJson,
    postMigrationContractSha256,
    sha256,
    stableJson,
});

export { S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_ACTIVE_FILE, S7_STARTUP_GATE_BOUND_FILE, S7_STARTUP_GATE_HANDOFF_READY_FILE, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE, S7_STARTUP_GATE_ADMISSION_FILE, S7_STARTUP_GATE_CLOSED_FILE, S7_STARTUP_GATE_FINALIZED_FILE, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE, S7_STARTUP_GATE_ACTIVE_KIND, S7_STARTUP_GATE_ACTIVE_SCHEMA, S7_STARTUP_GATE_BOUND_KIND, S7_STARTUP_GATE_BOUND_SCHEMA, S7_STARTUP_GATE_HANDOFF_READY_KIND, S7_STARTUP_GATE_HANDOFF_READY_SCHEMA, S7_STARTUP_GATE_HANDOFF_RELEASED_KIND, S7_STARTUP_GATE_HANDOFF_RELEASED_SCHEMA, S7_STARTUP_GATE_ADMISSION_KIND, S7_STARTUP_GATE_ADMISSION_SCHEMA, S7_STARTUP_GATE_CLOSED_KIND, S7_STARTUP_GATE_CLOSED_SCHEMA, S7_STARTUP_GATE_FINALIZED_KIND, S7_STARTUP_GATE_FINALIZED_SCHEMA, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA, S7_STARTUP_GATE_ENV, type S7FileIdentity, type S7StableFileArtifact, type S7WindowsPathSecurity, type S7AuthorityPathProtectionPort, type S7StartupGateAppPort, type S7EvidenceUserDataIdentity, type EnforceS7MainStartupGateOptions, type S7MainStartupAdmission, type CompleteS7MainStartupAdmissionOptions } from './s7-startup-gate-contracts';

export { s7PostMigrationAuthorityContract, defaultInspectPostMigrationAuthority } from './s7-startup-gate-authority';

export { protectFreshS7AuthorityPath, resolveCanonicalAuthorityUserDataDir } from './s7-startup-gate-runtime';

export { inspectS7AdmittedRecoveryChain, requireS7PostWriteHold } from './s7-startup-gate-chain';

export { enforceS7MainStartupGate } from './s7-startup-gate-admission';

export { completeS7MainStartupAdmission } from './s7-startup-gate-completion';

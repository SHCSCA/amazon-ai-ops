const { BUNDLE_KIND, BUNDLE_SCHEMA_VERSION, GATE_IDS, PACKAGE_IDENTITY_FIELDS, CURRENT_REVALIDATION_KIND, artifactRecord, normalizeSha256, normalizedPath, normalizedPackageIdentity, parseArgs, pathIsInside, readJson, samePath, sameOptionalPath, sha256File } = require('./s7-delivery-export-contracts.js');
const { assertCurrentRevalidation, runReadyRevalidation } = require('./s7-delivery-export-revalidation.js');
const { classifyReferencedArtifact, collectHashedArtifactReferences, validateOperationalEvidenceSemantics, validateReferencedArtifact } = require('./s7-delivery-export-references.js');
const { exportBundle, readmeContract, main } = require('./s7-delivery-export-publication.js');
const { inspectCanonicalPackage, validateAuthoritySnapshot, validateReadinessReport } = require('./s7-delivery-export-identity.js');

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 's7.delivery.export.failed', { error })) + '\n'); process.exitCode = 1; }
}

module.exports = { BUNDLE_KIND, BUNDLE_SCHEMA_VERSION, GATE_IDS, PACKAGE_IDENTITY_FIELDS, CURRENT_REVALIDATION_KIND, artifactRecord, assertCurrentRevalidation, classifyReferencedArtifact, collectHashedArtifactReferences, exportBundle, inspectCanonicalPackage, normalizeSha256, normalizedPath, normalizedPackageIdentity, parseArgs, pathIsInside, readJson, readmeContract, runReadyRevalidation, samePath, sameOptionalPath, sha256File, validateAuthoritySnapshot, validateOperationalEvidenceSemantics, validateReadinessReport, validateReferencedArtifact };

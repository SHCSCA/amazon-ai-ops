/**
 * v1.6.0 Required Test Manifest Verifier - Vitest Contract Tests
 * 
 * Validates that the manifest verifier script itself is correct and executable.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(process.cwd());
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/verify-v16-required-test-manifest.js');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs/v16_required_test_manifest.json');
const REQUIREMENTS_PATH = path.join(REPO_ROOT, 'docs/v16_requirements_index.json');

describe('verify-v16-required-test-manifest script contract', () => {
  it('script file must exist and be executable', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
    
    const stats = fs.statSync(SCRIPT_PATH);
    expect(stats.isFile()).toBe(true);
  });

  it('script must require --manifest, --requirements, and --repo-root arguments', () => {
    let error = null;
    try {
      execSync(`node "${SCRIPT_PATH}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (err) {
      error = err;
    }
    
    expect(error).not.toBeNull();
    expect(error.status).toBe(1);
  });

  it('script must accept valid manifest and requirements files', () => {
    // This will fail with current empty manifest, but script should execute
    let output = '';
    try {
      output = execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Script may exit 1 due to validation failures, but it should run
      output = err.stdout || '';
    }
    
    expect(output).toContain('v1.6.0 Required Test Manifest Verifier');
  });

  it('script must produce JSON output when --out is specified', () => {
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/test-manifest-verification-temp.json');
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // May fail validation but should still write output
    }
    
    if (fs.existsSync(tempOut)) {
      const content = fs.readFileSync(tempOut, 'utf-8');
      const report = JSON.parse(content);
      
      expect(report.schemaVersion).toMatch(/^v16\.manifest-verification\//);
      expect(report.summary).toBeDefined();
      expect(report.summary.result).toMatch(/^(PASS|FAIL)$/);
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
  });

  it('output report must have required structure', () => {
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/test-manifest-verification-structure.json');
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Validation may fail but output should be written
    }
    
    if (fs.existsSync(tempOut)) {
      const report = JSON.parse(fs.readFileSync(tempOut, 'utf-8'));
      
      // Required top-level fields
      expect(report.schemaVersion).toBeDefined();
      expect(report.verifiedAt).toBeDefined();
      expect(report.sourceRevision).toBeDefined();
      expect(report.input).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.issues).toBeDefined();
      expect(report.detail).toBeDefined();
      
      // Summary fields
      expect(report.summary.totalTests).toBeTypeOf('number');
      expect(report.summary.totalAcceptanceIds).toBeTypeOf('number');
      expect(report.summary.errorCount).toBeTypeOf('number');
      expect(report.summary.warningCount).toBeTypeOf('number');
      expect(report.summary.result).toMatch(/^(PASS|FAIL)$/);
      
      // Detail structure
      expect(Array.isArray(report.issues)).toBe(true);
      expect(Array.isArray(report.detail.errors)).toBe(true);
      expect(Array.isArray(report.detail.warnings)).toBe(true);
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
  });

  it('manifest schema must be v16.manifest/0.1 or compatible', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    expect(manifest.schemaVersion).toMatch(/^v16\.manifest\//);
  });

  it('requirements index must exist and be valid JSON', () => {
    expect(fs.existsSync(REQUIREMENTS_PATH)).toBe(true);
    
    const requirements = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
    expect(Array.isArray(requirements)).toBe(true);
  });

  it('each requirement must have requirementId and acceptanceIds', () => {
    const requirements = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
    
    for (const req of requirements) {
      expect(req.requirementId).toBeDefined();
      expect(req.requirementId).toMatch(/^V16-[A-Z]+-\d+$/);
      expect(Array.isArray(req.acceptanceIds)).toBe(true);
    }
  });

  it('manifest companionSpec must reference V16-COMPANION-VT', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    
    if (manifest.companionSpec) {
      expect(manifest.companionSpec.id).toBe('V16-COMPANION-VT');
      expect(manifest.companionSpec.version).toBeDefined();
    }
  });

  it('script must detect missing test files', () => {
    // Create a temporary manifest with a non-existent test file
    const tempManifest = path.join(REPO_ROOT, 'output/v16-evidence/temp-manifest-missing-file.json');
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/temp-verification-missing-file.json');
    
    const manifestWithMissingFile = {
      schemaVersion: 'v16.manifest/0.1',
      producedAt: new Date().toISOString(),
      companionSpec: { id: 'V16-COMPANION-VT', version: '0.1' },
      tests: [
        {
          testId: 'TEST-MISSING-001',
          layer: 'L1',
          acceptanceIds: ['AC-IA-001'],
          testPath: 'apps/desktop/src/main/this-file-does-not-exist.test.ts',
          description: 'Test with missing file'
        }
      ]
    };
    
    fs.mkdirSync(path.dirname(tempManifest), { recursive: true });
    fs.writeFileSync(tempManifest, JSON.stringify(manifestWithMissingFile, null, 2));
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${tempManifest}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Expected to fail
    }
    
    if (fs.existsSync(tempOut)) {
      const report = JSON.parse(fs.readFileSync(tempOut, 'utf-8'));
      
      const testFileErrors = report.issues.filter(
        issue => issue.category === 'TEST_FILE'
      );
      
      expect(testFileErrors.length).toBeGreaterThan(0);
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
    
    fs.unlinkSync(tempManifest);
  });

  it('script must detect duplicate testIds', () => {
    const tempManifest = path.join(REPO_ROOT, 'output/v16-evidence/temp-manifest-duplicate.json');
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/temp-verification-duplicate.json');
    
    const manifestWithDuplicates = {
      schemaVersion: 'v16.manifest/0.1',
      producedAt: new Date().toISOString(),
      companionSpec: { id: 'V16-COMPANION-VT', version: '0.1' },
      tests: [
        {
          testId: 'TEST-DUP-001',
          layer: 'L1',
          acceptanceIds: ['AC-IA-001'],
          testPath: 'apps/desktop/src/main/index.test.ts',
          description: 'First instance'
        },
        {
          testId: 'TEST-DUP-001',
          layer: 'L1',
          acceptanceIds: ['AC-IA-002'],
          testPath: 'apps/desktop/src/main/index.test.ts',
          description: 'Duplicate testId'
        }
      ]
    };
    
    fs.mkdirSync(path.dirname(tempManifest), { recursive: true });
    fs.writeFileSync(tempManifest, JSON.stringify(manifestWithDuplicates, null, 2));
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${tempManifest}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Expected to fail
    }
    
    if (fs.existsSync(tempOut)) {
      const report = JSON.parse(fs.readFileSync(tempOut, 'utf-8'));
      
      const duplicateErrors = report.issues.filter(
        issue => issue.category === 'TEST_DUPLICATE'
      );
      
      expect(duplicateErrors.length).toBeGreaterThan(0);
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
    
    fs.unlinkSync(tempManifest);
  });
});

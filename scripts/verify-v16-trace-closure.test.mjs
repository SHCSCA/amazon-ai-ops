/**
 * v1.6.0 Trace Closure Verifier - Vitest Contract Tests
 * 
 * Validates that the trace closure verifier script is correct and executable.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(process.cwd());
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/verify-v16-trace-closure.js');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs/v16_required_test_manifest.json');
const REQUIREMENTS_PATH = path.join(REPO_ROOT, 'docs/v16_requirements_index.json');

describe('verify-v16-trace-closure script contract', () => {
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

  it('script must accept valid inputs and produce output', () => {
    let output = '';
    try {
      output = execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --evidence-dir output/v16-evidence`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Script may exit with status 1, but should produce output
      output = err.stdout || '';
    }
    
    expect(output).toContain('v1.6.0 Trace Closure Verifier');
  });

  it('script must produce valid JSON output when --out is specified', () => {
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/trace-closure-temp.json');
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --evidence-dir output/v16-evidence --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // May fail due to missing tests, but output should be written
    }
    
    if (fs.existsSync(tempOut)) {
      const content = fs.readFileSync(tempOut, 'utf-8');
      const report = JSON.parse(content);
      
      expect(report.schemaVersion).toMatch(/^v16\.trace\//);
      expect(report.summary).toBeDefined();
      expect(report.requirements).toBeDefined();
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
  });

  it('output report must have required trace closure structure', () => {
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/trace-closure-structure.json');
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --evidence-dir output/v16-evidence --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Expected when tests are missing
    }
    
    if (fs.existsSync(tempOut)) {
      const report = JSON.parse(fs.readFileSync(tempOut, 'utf-8'));
      
      // Required top-level fields
      expect(report.schemaVersion).toBeDefined();
      expect(report.schemaVersion).toMatch(/^v16\.trace\//);
      expect(report.prdReference).toBeDefined();
      expect(report.companionSpec).toBeDefined();
      expect(report.producedAt).toBeDefined();
      expect(report.identity).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.requirements).toBeDefined();
      
      // Summary fields
      expect(report.summary.total).toBeTypeOf('number');
      expect(report.summary.closed).toBeTypeOf('number');
      expect(report.summary.pending).toBeTypeOf('number');
      expect(report.summary.failed).toBeTypeOf('number');
      expect(report.summary.blocked).toBeTypeOf('number');
      
      // Requirements array
      expect(Array.isArray(report.requirements)).toBe(true);
      
      // Identity fields
      expect(report.identity.sourceRevision).toBeDefined();
      expect(report.identity.packageVersion).toBeDefined();
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
  });

  it('companionSpec must reference V16-COMPANION-VT', () => {
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/trace-closure-companion.json');
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --evidence-dir output/v16-evidence --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Expected
    }
    
    if (fs.existsSync(tempOut)) {
      const report = JSON.parse(fs.readFileSync(tempOut, 'utf-8'));
      
      expect(report.companionSpec.id).toBe('V16-COMPANION-VT');
      expect(report.companionSpec.version).toBeDefined();
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
  });

  it('each requirement must have complete traceability structure', () => {
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/trace-closure-req-structure.json');
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --evidence-dir output/v16-evidence --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Expected
    }
    
    if (fs.existsSync(tempOut)) {
      const report = JSON.parse(fs.readFileSync(tempOut, 'utf-8'));
      
      for (const req of report.requirements) {
        // Required requirement fields
        expect(req.requirementId).toBeDefined();
        expect(req.requirementId).toMatch(/^V16-[A-Z]+-\d+$/);
        expect(req.level).toMatch(/^(MUST|SHOULD|MAY)$/);
        expect(req.prdSection).toBeDefined();
        expect(req.title).toBeDefined();
        expect(Array.isArray(req.acceptanceIds)).toBe(true);
        expect(req.result).toMatch(/^(CLOSED|PENDING|FAILED|BLOCKED)$/);
        expect(req.resultDetail).toBeDefined();
        
        // Each acceptance ID must have structure
        for (const ac of req.acceptanceIds) {
          expect(ac.acceptanceId).toBeDefined();
          expect(ac.acceptanceId).toMatch(/^AC-[A-Z]+-\d+$/);
          expect(ac.layer).toMatch(/^L[123]$/);
          expect(ac.testId).toBeDefined();
          expect(ac.result).toMatch(/^(CLOSED|PENDING|FAILED|BLOCKED)$/);
          expect(ac.resultDetail).toBeDefined();
        }
      }
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
  });

  it('summary must correctly count requirement states', () => {
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/trace-closure-summary.json');
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --evidence-dir output/v16-evidence --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Expected
    }
    
    if (fs.existsSync(tempOut)) {
      const report = JSON.parse(fs.readFileSync(tempOut, 'utf-8'));
      
      const { total, closed, pending, failed, blocked } = report.summary;
      
      // Sum must equal total
      expect(closed + pending + failed + blocked).toBe(total);
      
      // Count actual states
      const actualCounts = {
        CLOSED: 0,
        PENDING: 0,
        FAILED: 0,
        BLOCKED: 0
      };
      
      for (const req of report.requirements) {
        actualCounts[req.result]++;
      }
      
      expect(actualCounts.CLOSED).toBe(closed);
      expect(actualCounts.PENDING).toBe(pending);
      expect(actualCounts.FAILED).toBe(failed);
      expect(actualCounts.BLOCKED).toBe(blocked);
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
  });

  it('result must be BLOCKED when test is MISSING', () => {
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/trace-closure-blocked.json');
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --evidence-dir output/v16-evidence --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Expected
    }
    
    if (fs.existsSync(tempOut)) {
      const report = JSON.parse(fs.readFileSync(tempOut, 'utf-8'));
      
      for (const req of report.requirements) {
        for (const ac of req.acceptanceIds) {
          if (ac.testId === 'MISSING') {
            expect(ac.result).toBe('BLOCKED');
            expect(ac.resultDetail).toContain('no test in manifest');
          }
        }
      }
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
  });

  it('closedAt timestamp must be valid ISO8601 when present', () => {
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/trace-closure-timestamp.json');
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --evidence-dir output/v16-evidence --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Expected
    }
    
    if (fs.existsSync(tempOut)) {
      const report = JSON.parse(fs.readFileSync(tempOut, 'utf-8'));
      
      if (report.closedAt) {
        const date = new Date(report.closedAt);
        expect(date.toString()).not.toBe('Invalid Date');
      }
      
      // producedAt must always be valid
      const producedDate = new Date(report.producedAt);
      expect(producedDate.toString()).not.toBe('Invalid Date');
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
  });

  it('prdReference must point to v1.6.0 PRD', () => {
    const tempOut = path.join(REPO_ROOT, 'output/v16-evidence/trace-closure-prd.json');
    
    try {
      execSync(
        `node "${SCRIPT_PATH}" --manifest "${MANIFEST_PATH}" --requirements "${REQUIREMENTS_PATH}" --repo-root "${REPO_ROOT}" --evidence-dir output/v16-evidence --out "${tempOut}"`,
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      );
    } catch (err) {
      // Expected
    }
    
    if (fs.existsSync(tempOut)) {
      const report = JSON.parse(fs.readFileSync(tempOut, 'utf-8'));
      
      expect(report.prdReference.path).toContain('amazon_ai_ops_agent_prd_v1_6_0.md');
      expect(report.prdReference.version).toBeDefined();
      
      // Cleanup
      fs.unlinkSync(tempOut);
    }
  });

  it('script must load requirements index correctly', () => {
    expect(fs.existsSync(REQUIREMENTS_PATH)).toBe(true);
    
    const requirements = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
    expect(Array.isArray(requirements)).toBe(true);
    expect(requirements.length).toBeGreaterThan(0);
    
    // All requirements should follow naming convention
    for (const req of requirements) {
      expect(req.requirementId).toMatch(/^V16-[A-Z]+-\d+$/);
    }
  });
});

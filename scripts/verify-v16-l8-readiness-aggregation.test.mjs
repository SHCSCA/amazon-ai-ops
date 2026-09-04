import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyL8Aggregation } from './verify-v16-l8-readiness-aggregation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(WORKSPACE_ROOT, 'output', 'test-temp');

describe('verify-v16-l8-readiness-aggregation', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // 清理临时文件
    if (fs.existsSync(TEMP_DIR)) {
      fs.readdirSync(TEMP_DIR).forEach(file => {
        fs.unlinkSync(path.join(TEMP_DIR, file));
      });
    }
  });

  describe('基本结构验证', () => {
    it('should fail when file does not exist', () => {
      const nonExistentPath = path.join(TEMP_DIR, 'non-existent.json');
      const results = verifyL8Aggregation(nonExistentPath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'FILE_EXISTS' })
      );
    });

    it('should fail when JSON is invalid', () => {
      const invalidPath = path.join(TEMP_DIR, 'invalid.json');
      fs.writeFileSync(invalidPath, 'not valid json{', 'utf8');
      
      const results = verifyL8Aggregation(invalidPath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'JSON_PARSE' })
      );
    });

    it('should fail when required fields are missing', () => {
      const incompletePath = path.join(TEMP_DIR, 'incomplete.json');
      fs.writeFileSync(incompletePath, JSON.stringify({
        schemaVersion: '1.0.0',
        timestamp: new Date().toISOString()
        // 缺少其他必需字段
      }), 'utf8');
      
      const results = verifyL8Aggregation(incompletePath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'SCHEMA_COMPLETE' })
      );
    });
  });

  describe('readinessStatus 验证', () => {
    it('should pass with valid APP_NEEDS_WORK status', () => {
      const validPath = path.join(TEMP_DIR, 'valid-needs-work.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      fs.writeFileSync(validPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(validPath);
      
      expect(results.passed).toContain('READINESS_STATUS_VALID');
    });

    it('should pass with valid APP_READY status', () => {
      const validPath = path.join(TEMP_DIR, 'valid-ready.json');
      const data = createValidAggregation('APP_READY');
      data.blockers = []; // APP_READY 需要无 blocker
      data.summary.blocker_count = 0;
      data.summary.gated_count = 0;
      data.evidence.gated = [];
      fs.writeFileSync(validPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(validPath);
      
      expect(results.passed).toContain('READINESS_STATUS_VALID');
    });

    it('should fail with invalid readinessStatus value', () => {
      const invalidPath = path.join(TEMP_DIR, 'invalid-status.json');
      const data = createValidAggregation('INVALID_STATUS');
      fs.writeFileSync(invalidPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(invalidPath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'READINESS_STATUS_VALID' })
      );
    });
  });

  describe('逻辑一致性验证', () => {
    it('should fail when gated layers exist but no GATED_LAYERS blocker', () => {
      const inconsistentPath = path.join(TEMP_DIR, 'gated-no-blocker.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      data.evidence.gated = [
        { testId: 'V16-T-L4-TEST', layer: 'L4', reason: 'USER_PROHIBITION' }
      ];
      data.blockers = []; // 缺少 GATED_LAYERS blocker
      data.summary.blocker_count = 0;
      fs.writeFileSync(inconsistentPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(inconsistentPath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'GATED_BLOCKER_REQUIRED' })
      );
    });

    it('should fail when blockers exist but status is APP_READY', () => {
      const inconsistentPath = path.join(TEMP_DIR, 'blockers-but-ready.json');
      const data = createValidAggregation('APP_READY');
      data.blockers = [
        { type: 'TEST_BLOCKER', message: 'Test blocker' }
      ];
      data.summary.blocker_count = 1;
      fs.writeFileSync(inconsistentPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(inconsistentPath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'BLOCKERS_FORCE_NEEDS_WORK' })
      );
    });

    it('should fail when gated tests exist but status is APP_READY', () => {
      const inconsistentPath = path.join(TEMP_DIR, 'gated-but-ready.json');
      const data = createValidAggregation('APP_READY');
      data.evidence.gated = [
        { testId: 'V16-T-L4-TEST', layer: 'L4', reason: 'USER_PROHIBITION' }
      ];
      data.summary.gated_count = 1;
      data.blockers = []; // APP_READY 但有 gated
      data.summary.blocker_count = 0;
      fs.writeFileSync(inconsistentPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(inconsistentPath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'GATED_FORCES_NEEDS_WORK' })
      );
    });

    it('should pass when gated layers have corresponding blocker and APP_NEEDS_WORK', () => {
      const consistentPath = path.join(TEMP_DIR, 'gated-consistent.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      data.evidence.gated = [
        { testId: 'V16-T-L4-TEST', layer: 'L4', reason: 'USER_PROHIBITION' }
      ];
      data.blockers = [
        { 
          type: 'GATED_LAYERS', 
          count: 1,
          message: '1 L4-L7 tests are gated by user prohibition',
          gatedBuckets: ['L4-bucket']
        }
      ];
      data.summary.gated_count = 1;
      data.summary.blocker_count = 1;
      fs.writeFileSync(consistentPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(consistentPath);
      
      expect(results.passed).toContain('GATED_BLOCKER_REQUIRED');
      expect(results.passed).toContain('BLOCKERS_FORCE_NEEDS_WORK');
      expect(results.passed).toContain('GATED_FORCES_NEEDS_WORK');
    });
  });

  describe('Summary 验证', () => {
    it('should fail when summary fields are missing', () => {
      const incompletePath = path.join(TEMP_DIR, 'incomplete-summary.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      delete data.summary.L1_total;
      fs.writeFileSync(incompletePath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(incompletePath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'SUMMARY_COMPLETE' })
      );
    });

    it('should fail when totalTests is less than 1', () => {
      const invalidPath = path.join(TEMP_DIR, 'zero-tests.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      data.summary.totalTests = 0;
      fs.writeFileSync(invalidPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(invalidPath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'SUMMARY_TOTAL_TESTS' })
      );
    });

    it('should warn when blocker_count does not match blockers array length', () => {
      const mismatchPath = path.join(TEMP_DIR, 'blocker-count-mismatch.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      data.summary.blocker_count = 5; // 但实际只有 1 个
      fs.writeFileSync(mismatchPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(mismatchPath);
      
      expect(results.warnings.some(w => w.includes('blocker_count'))).toBe(true);
    });
  });

  describe('Evidence 结构验证', () => {
    it('should fail when evidence layers are missing', () => {
      const incompletePath = path.join(TEMP_DIR, 'missing-layers.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      delete data.evidence.L2;
      fs.writeFileSync(incompletePath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(incompletePath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'EVIDENCE_LAYERS' })
      );
    });

    it('should pass when gated layers are recorded', () => {
      const gatedPath = path.join(TEMP_DIR, 'with-gated.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      data.evidence.gated = [
        { testId: 'V16-T-L4-TEST', layer: 'L4', reason: 'USER_PROHIBITION' }
      ];
      data.blockers.push({
        type: 'GATED_LAYERS',
        count: 1,
        message: 'L4-L7 gated'
      });
      data.summary.gated_count = 1;
      data.summary.blocker_count = 2;
      fs.writeFileSync(gatedPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(gatedPath);
      
      expect(results.passed).toContain('GATED_LAYERS_RECORDED');
    });
  });

  describe('Blocker 结构验证', () => {
    it('should fail when blocker missing type field', () => {
      const invalidPath = path.join(TEMP_DIR, 'blocker-no-type.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      data.blockers.push({ message: 'No type' }); // 缺少 type
      data.summary.blocker_count = 2;
      fs.writeFileSync(invalidPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(invalidPath);
      
      expect(results.failed.some(f => f.check.includes('BLOCKER_') && f.check.includes('_TYPE'))).toBe(true);
    });

    it('should fail when blocker missing message field', () => {
      const invalidPath = path.join(TEMP_DIR, 'blocker-no-message.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      data.blockers.push({ type: 'TEST_BLOCKER' }); // 缺少 message
      data.summary.blocker_count = 2;
      fs.writeFileSync(invalidPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(invalidPath);
      
      expect(results.failed.some(f => f.check.includes('BLOCKER_') && f.check.includes('_MESSAGE'))).toBe(true);
    });
  });

  describe('Timestamp 验证', () => {
    it('should pass with valid ISO timestamp', () => {
      const validPath = path.join(TEMP_DIR, 'valid-timestamp.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      data.timestamp = new Date().toISOString();
      fs.writeFileSync(validPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(validPath);
      
      expect(results.passed).toContain('TIMESTAMP_VALID');
    });

    it('should fail with invalid timestamp', () => {
      const invalidPath = path.join(TEMP_DIR, 'invalid-timestamp.json');
      const data = createValidAggregation('APP_NEEDS_WORK');
      data.timestamp = 'not-a-date';
      fs.writeFileSync(invalidPath, JSON.stringify(data), 'utf8');
      
      const results = verifyL8Aggregation(invalidPath);
      
      expect(results.failed).toContainEqual(
        expect.objectContaining({ check: 'TIMESTAMP_VALID' })
      );
    });
  });
});

/**
 * 创建有效的聚合数据模板
 */
function createValidAggregation(readinessStatus) {
  return {
    schemaVersion: '1.0.0',
    timestamp: new Date().toISOString(),
    readinessStatus,
    summary: {
      totalTests: 20,
      L1_passed: 5,
      L1_total: 5,
      L2_passed: 8,
      L2_total: 10,
      L3_passed: 2,
      L3_total: 3,
      gated_count: 2,
      blocker_count: 1,
      warning_count: 0
    },
    blockers: [
      {
        type: 'GATED_LAYERS',
        count: 2,
        message: '2 L4-L7 tests are gated by user prohibition',
        gatedBuckets: ['L4-bucket', 'L5-bucket']
      }
    ],
    warnings: [],
    evidence: {
      L1: [
        { testId: 'V16-T-L1-TEST-1', status: 'pass', exists: true },
        { testId: 'V16-T-L1-TEST-2', status: 'pass', exists: true }
      ],
      L2: [
        { testId: 'V16-T-L2-TEST-1', status: 'pass', exists: true },
        { testId: 'V16-T-L2-TEST-2', status: 'pass', exists: true }
      ],
      L3: [
        { testId: 'V16-T-L3-TEST-1', status: 'pass', exists: true }
      ],
      gated: [
        { testId: 'V16-T-L4-TEST', layer: 'L4', reason: 'USER_PROHIBITION' },
        { testId: 'V16-T-L5-TEST', layer: 'L5', reason: 'USER_PROHIBITION' }
      ]
    }
  };
}

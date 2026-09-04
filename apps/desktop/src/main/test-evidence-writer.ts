import * as fs from 'fs';
import * as path from 'path';

export interface TestEvidenceMetadata {
  testId: string;
  title: string;
  layer: string;
  testFile: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  duration: number;
  timestamp: string;
}

export function writeTestEvidence(metadata: TestEvidenceMetadata): void {
  const outputDir = path.join(process.cwd(), 'output', 'v16-evidence');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const evidence = {
    schemaVersion: 'v16.evidence/0.1',
    testId: metadata.testId,
    title: metadata.title,
    layer: metadata.layer,
    testFile: metadata.testFile,
    executionTime: metadata.timestamp,
    duration: metadata.duration,
    result: {
      passed: metadata.failedTests === 0 && metadata.totalTests > 0,
      total: metadata.totalTests,
      passed: metadata.passedTests,
      failed: metadata.failedTests,
      skipped: metadata.skippedTests,
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
    },
  };

  const outputFile = path.join(outputDir, `${metadata.testId.toLowerCase().replace(/[^a-z0-9]/g, '_')}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(evidence, null, 2), 'utf8');
}

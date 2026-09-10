// Compatibility entry: execute the actual runner and retain its exit code and raw report.
import('./generate-v16-l1-evidence.mjs').catch(error => { console.error(error.message); process.exitCode = 1; });

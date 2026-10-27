const { runChild } = require('../../../../scripts/sqlite-authority-currentness');
const { createRuntimeLogRecord } = require('../../../../packages/shared-types/src/runtime-log-format.cjs');
if (process.argv[2] !== '--readonly-online-backup-child') {
  process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'delivery.backup_child_mode_required')) + '\n');
  process.exitCode = 1;
} else {
  void runChild(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'delivery.backup_child_failed', { error })) + '\n');
    process.exitCode = 1;
  });
}
export {};

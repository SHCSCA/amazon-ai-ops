import * as fs from 'node:fs';
import { sanitizeRuntimeLogValue } from './runtime-log-sanitizer';
import { createRuntimeLogRecord, type RuntimeLogLevel, type RuntimeLogPort } from '@amazon-ai-ops/shared-types';
import { appendRetainedRuntimeLog } from './runtime-log-files';
import { captureRuntimeLogRetention, DEFAULT_RUNTIME_LOG_RETENTION, type RuntimeLogRetentionPolicy } from './runtime-log-policy';
export type { RuntimeLogLevel, RuntimeLogPort, RuntimeLogRecord } from '@amazon-ai-ops/shared-types';

interface RuntimeLoggerOptions {
  now?: () => Date;
  append?: (directory: string, date: string, line: string) => void;
  write?: (level: RuntimeLogLevel, line: string) => void;
  fallback?: (line: string) => void;
}

export class RuntimeLogger implements RuntimeLogPort {
  private outputDirectory: string | null = null;
  private retention = DEFAULT_RUNTIME_LOG_RETENTION;
  private readonly now: () => Date;
  private readonly append: NonNullable<RuntimeLoggerOptions['append']>;
  private readonly stream: NonNullable<RuntimeLoggerOptions['write']>;
  private readonly fallback: NonNullable<RuntimeLoggerOptions['fallback']>;

  constructor(options: RuntimeLoggerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.append = options.append ?? ((directory, date, line) => appendRetainedRuntimeLog(directory, date, line, this.retention));
    this.stream = options.write ?? ((level, line) => {
      fs.writeSync(level === 'error' ? process.stderr.fd : process.stdout.fd, line);
    });
    this.fallback = options.fallback ?? ((line) => { fs.writeSync(process.stderr.fd, line); });
  }

  setOutputDirectory(directory: string, policy: RuntimeLogRetentionPolicy = DEFAULT_RUNTIME_LOG_RETENTION): void {
    this.retention = captureRuntimeLogRetention(policy);
    this.outputDirectory = directory;
  }

  info(event: string, context?: Record<string, unknown>): void {
    this.write('info', event, context);
  }

  warn(event: string, context?: Record<string, unknown>): void {
    this.write('warn', event, context);
  }

  error(event: string, context?: Record<string, unknown>): void {
    this.write('error', event, context);
  }

  private write(level: RuntimeLogLevel, event: string, context?: Record<string, unknown>): void {
    let record;
    try {
      record = createRuntimeLogRecord(level, event, context, this.now());
    } catch (error) {
      record = createRuntimeLogRecord('error', 'runtime.log_encoding_failed', { error });
    }
    const line = `${JSON.stringify(record)}\n`;
    const failures: Record<string, unknown> = {};
    let fileWritten = false;
    if (this.outputDirectory) {
      try {
        this.append(this.outputDirectory, record.timestamp.slice(0, 10), line);
        fileWritten = true;
      } catch (error) {
        failures.fileError = error;
      }
    }
    try {
      this.stream(level, line);
    } catch (error) {
      failures.streamError = error;
      this.writeFallback(line);
    }
    if (Object.keys(failures).length === 0) return;
    const diagnostic = `${JSON.stringify({
      timestamp: record.timestamp, level: 'error', event: 'runtime.logger_write_failed',
      context: sanitizeRuntimeLogValue({ originalEvent: event, ...failures }),
    })}\n`;
    if (fileWritten && this.outputDirectory) {
      try {
        this.append(this.outputDirectory, record.timestamp.slice(0, 10), diagnostic);
      } catch {
        // 日志出口已失败，诊断直接转入剩余出口，避免递归记录。
      }
    }
    try {
      this.stream('error', diagnostic);
    } catch {
      this.writeFallback(diagnostic);
    }
  }

  private writeFallback(line: string): void {
    try {
      this.fallback(line);
    } catch {
      // 所有出口不可用时只能终止记录，不能覆盖业务异常或改变退出状态。
    }
  }
}

export const runtimeLogger = new RuntimeLogger();

import { describe, expect, it } from 'vitest';
import {
  Connection,
  Database,
  DUCKDB_RUNTIME_LOADER_CONTRACT,
} from './runtime';

describe('DuckDB packaged runtime loader', () => {
  it('loads the native N-API binding without the node-pre-gyp runtime toolchain', () => {
    expect(DUCKDB_RUNTIME_LOADER_CONTRACT).toBe('amazon-ai-ops:duckdb-direct-native-binding/v1');
    expect(typeof Database).toBe('function');
    expect(typeof Connection).toBe('function');
    expect(typeof Database.prototype.exec).toBe('function');
    expect(typeof Database.prototype.close).toBe('function');
    expect(typeof Connection.prototype.all).toBe('function');

    const database = new Database(':memory:');
    database.close();
  });
});

import type {
  Connection as DuckDbConnection,
  Database as DuckDbDatabase,
  Statement as DuckDbStatement,
} from 'duckdb';

export const DUCKDB_RUNTIME_LOADER_CONTRACT = 'amazon-ai-ops:duckdb-direct-native-binding/v1';

type DuckDbBinding = {
  Connection: typeof import('duckdb').Connection;
  Database: typeof import('duckdb').Database;
  Statement: typeof import('duckdb').Statement;
};

type DatabaseWithDefaultConnection = DuckDbDatabase & {
  close_internal: (...args: any[]) => unknown;
  default_connection?: DuckDbConnection | null;
};

// The official duckdb JS loader depends on @mapbox/node-pre-gyp only to locate
// this already-installed N-API binary. Electron Builder's pnpm production
// dependency collector intentionally packages direct dependencies only, so the
// indirect locator is absent in the Windows package. Loading the native binding
// directly keeps the packaged runtime deterministic and avoids shipping the
// node-gyp installation toolchain.
const binding = require('duckdb/lib/binding/duckdb.node') as DuckDbBinding;

const { Connection, Database, Statement } = binding;

function defaultConnection(database: DatabaseWithDefaultConnection): DuckDbConnection {
  if (!database.default_connection) {
    database.default_connection = new Connection(database);
  }
  return database.default_connection;
}

function installOfficialConvenienceMethods(): void {
  const connectionPrototype = Connection.prototype as DuckDbConnection;
  const databasePrototype = Database.prototype as DatabaseWithDefaultConnection;

  if (typeof connectionPrototype.run !== 'function') {
    connectionPrototype.run = function run(this: DuckDbConnection, sql: string, ...args: any[]) {
      const statement = new Statement(this, sql);
      return statement.run(...args);
    } as DuckDbConnection['run'];
  }

  if (typeof connectionPrototype.all !== 'function') {
    connectionPrototype.all = function all(this: DuckDbConnection, sql: string, ...args: any[]) {
      const statement = new Statement(this, sql);
      return statement.all(...args);
    } as DuckDbConnection['all'];
  }

  if (typeof databasePrototype.exec !== 'function') {
    databasePrototype.exec = function exec(this: DatabaseWithDefaultConnection, sql: string, ...args: any[]) {
      const connection = defaultConnection(this);
      const connectionExec = connection.exec as (...callArgs: any[]) => unknown;
      return connectionExec.call(connection, sql, ...args);
    } as DuckDbDatabase['exec'];
  }

  if (typeof databasePrototype.close !== 'function') {
    databasePrototype.close = function close(this: DatabaseWithDefaultConnection, ...args: any[]) {
      if (this.default_connection) {
        this.default_connection.close();
        this.default_connection = null;
      }
      return this.close_internal(...args);
    } as DuckDbDatabase['close'];
  }
}

installOfficialConvenienceMethods();

export { Connection, Database, Statement };
export type { DuckDbConnection, DuckDbDatabase, DuckDbStatement };

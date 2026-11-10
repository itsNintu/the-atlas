export type SQLiteRunResult = { changes: number; lastInsertRowid?: number | bigint };

/** The small synchronous SQLite surface shared by Bun and Durable Objects. */
export interface SQLiteDatabase {
  exec(sql: string): any;
  query(sql: string): {
    all(...params: any[]): any[];
    get(...params: any[]): any;
    run(...params: any[]): SQLiteRunResult;
  };
  transaction<T>(fn: () => T): { immediate(): T };
  function?(name: string, options: unknown, fn: (value: any) => any): unknown;
  close(): void;
}

/** Cloudflare's synchronous SQLite API, adapted without changing Atlas queries. */
export class DurableObjectSQLite implements SQLiteDatabase {
  private sql: any;
  constructor(private storage: any) {
    this.sql = storage.sql;
  }
  exec(sql: string) {
    return this.sql.exec(sql);
  }
  query(sql: string) {
    const cursor = () => this.sql.exec(sql, ...params);
    let params: any[] = [];
    return {
      all: (...values: any[]) => {
        params = values;
        return cursor().toArray();
      },
      get: (...values: any[]) => {
        params = values;
        return cursor().toArray()[0] ?? null;
      },
      run: (...values: any[]) => {
        params = values;
        const result = cursor();
        result.toArray();
        return { changes: Number(result.rowsWritten ?? 0) };
      },
    };
  }
  transaction<T>(fn: () => T) {
    return { immediate: () => this.storage.transactionSync(fn) };
  }
  close() {
    // Durable Object storage lifetime belongs to the object, not a request.
  }
}

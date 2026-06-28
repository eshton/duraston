/**
 * Minimal ambient types for Node's built-in `node:sqlite` (used here as the
 * local stand-in for Golem's per-agent SQLite). We declare only the subset
 * SqliteStore uses, mirroring the same narrow-surface approach as globals.d.ts.
 */
declare module "node:sqlite" {
  export class StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

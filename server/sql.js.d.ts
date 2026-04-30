declare module "sql.js" {
  interface Database {
    run(sql: string, params?: any[]): void;
    exec(sql: string, params?: any[]): { columns: string[]; values: any[][] }[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, any>;
    free(): void;
  }

  export default function initSqlJs(): Promise<{ Database: new (data?: ArrayLike<number> | null) => Database }>;
}

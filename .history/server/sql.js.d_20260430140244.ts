declare module "sql.js" {
    interface SqlJsStatic {
        Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
    }

    interface QueryExecResult {
        columns: string[];
        values: any[][];
    }

    interface Statement {
        bind(params?: any[]): boolean;
        step(): boolean;
        getAsObject(): Record<string, any>;
        free(): void;
    }

    interface Database {
        run(sql: string, params?: any[]): Database;
        exec(sql: string, params?: any[]): QueryExecResult[];
        prepare(sql: string): Statement;
        export(): Uint8Array;
        close(): void;
    }

    export default function initSqlJs(): Promise<SqlJsStatic>;
    export { Database };
}

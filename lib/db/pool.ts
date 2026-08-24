import mysql, { type Pool } from "mysql2/promise";
import { getDatabaseConfig } from "./config";

const globalDatabase = globalThis as typeof globalThis & { __aiTeachingMysqlPool?: Pool };

/** 创建进程级连接池；开发热更新时复用连接，避免不断建立新池。 */
export function getDatabasePool(): Pool {
  if (!globalDatabase.__aiTeachingMysqlPool) {
    const config = getDatabaseConfig();
    globalDatabase.__aiTeachingMysqlPool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: "utf8mb4",
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
  }
  return globalDatabase.__aiTeachingMysqlPool;
}

/** 执行最小查询确认数据库、连接池和凭据均可用。 */
export async function checkDatabaseHealth(): Promise<{ database: string; version: string }> {
  const pool = getDatabasePool();
  const [rows] = await pool.query<Array<{ databaseName: string; version: string }> & import("mysql2").RowDataPacket[]>(
    "SELECT DATABASE() AS databaseName, VERSION() AS version",
  );
  return { database: rows[0].databaseName, version: rows[0].version };
}

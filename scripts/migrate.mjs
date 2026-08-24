import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

function readDatabaseConfig() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is required");
  const url = new URL(rawUrl);
  if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must use mysql://");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error("Database name contains unsafe characters");
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

/** 创建目标数据库并按文件名前缀顺序执行尚未应用的 SQL 迁移。 */
async function migrate() {
  const config = readDatabaseConfig();
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    charset: "utf8mb4",
    multipleStatements: true,
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await connection.changeUser({ database: config.database });
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(64) NOT NULL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        applied_at BIGINT UNSIGNED NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
    `);

    const migrationDirectory = resolve(process.cwd(), "migrations");
    const files = (await readdir(migrationDirectory)).filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file)).sort();
    for (const filename of files) {
      const version = filename.split("_", 1)[0];
      const [rows] = await connection.execute("SELECT version FROM schema_migrations WHERE version = ?", [version]);
      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`skip ${filename}`);
        continue;
      }

      const sql = await readFile(resolve(migrationDirectory, filename), "utf8");
      // DDL 在 MySQL 中会隐式提交，因此迁移文件必须保持幂等；仅在全部语句成功后登记版本。
      await connection.query(sql);
      await connection.execute("INSERT INTO schema_migrations (version, filename, applied_at) VALUES (?, ?, ?)", [version, filename, Date.now()]);
      console.log(`applied ${filename}`);
    }
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
});

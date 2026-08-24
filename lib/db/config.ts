import { z } from "zod";

const DatabaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("mysql://"),
});

export type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

/** 只在服务端解析数据库 URL，并对库名做标识符白名单校验。 */
export function getDatabaseConfig(): DatabaseConfig {
  const environment = DatabaseEnvironmentSchema.parse(process.env);
  const url = new URL(environment.DATABASE_URL);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error("INVALID_DATABASE_NAME");
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

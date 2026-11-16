import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __vesperPgPool?: Pool;
};

/**
 * The connection pool is created on first use rather than at import time, so
 * `next build` and unit tests can load modules without a database, and a
 * missing DATABASE_URL produces one clear message instead of a build crash.
 */
function getPool(): Pool {
  if (globalForDb.__vesperPgPool) return globalForDb.__vesperPgPool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local, set DATABASE_URL to your Postgres " +
        "connection string, then run `npm run db:migrate`. See README.md.",
    );
  }

  const created = new Pool({ connectionString: databaseUrl });
  // Cached on globalThis so dev-server hot reloads reuse one pool.
  globalForDb.__vesperPgPool = created;
  return created;
}

function lazy<T extends object>(create: () => T): T {
  let instance: T | undefined;
  return new Proxy({} as T, {
    get(_target, property) {
      instance ??= create();
      const value = Reflect.get(instance, property, instance);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  });
}

export const pool: Pool = lazy(getPool);
export const db: NodePgDatabase = lazy(() => drizzle(getPool()));

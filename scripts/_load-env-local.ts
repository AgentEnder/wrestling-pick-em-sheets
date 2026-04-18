import { existsSync } from "node:fs";
import path from "node:path";

// Loaded as a side-effect import so env vars are populated before any
// subsequent module (e.g. the DB client) reads process.env at import time.
// Static imports evaluate their dependencies in source-declaration order,
// so any script that lists `import "./_load-env-local.ts";` first gets the
// env loaded before the rest of its imports evaluate.
const envFile = path.resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// The DB client (lib/server/db/client.ts) defaults to a local sqlite file
// when NODE_ENV !== "production" unless USE_TURSO_IN_DEV=1. Scripts want
// to run against whatever the env file points at, so force the Turso path
// when credentials are available.
if (
  process.env.TURSO_DATABASE_URL &&
  process.env.TURSO_AUTH_TOKEN &&
  process.env.USE_TURSO_IN_DEV !== "1"
) {
  process.env.USE_TURSO_IN_DEV = "1";
}

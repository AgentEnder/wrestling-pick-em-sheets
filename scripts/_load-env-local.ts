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

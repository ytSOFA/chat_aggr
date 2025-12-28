import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { safeLog } from "./utils/redact";
import { createApp } from "./app";

function loadDotEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "backend", ".env")
  ];

  const envPath = candidates.find((p) => fs.existsSync(p));
  if (!envPath) return;

  dotenv.config({ path: envPath });
}

loadDotEnv();

function getVersion(): string {
  return process.env.npm_package_version ?? process.env.APP_VERSION ?? "dev";
}

const app = createApp();

const host = process.env.HOST?.trim() || "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
app.listen(port, host, () => {
  safeLog("[backend] listening", { host, port, version: getVersion() });
});

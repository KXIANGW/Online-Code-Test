import { RealOciClient } from "./oci";
import { Puller } from "./puller";
import { createServer } from "./server";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const languagesFile = process.env["LANGUAGES_FILE"] ?? "/config/languages.yaml";
  const rootfsBaseDir = process.env["ROOTFS_BASE_DIR"] ?? "/var/lib/oct/rootfs";
  const port = parseInt(process.env["PORT"] ?? "8081", 10);
  const reloadToken = process.env["RELOAD_TOKEN"]; // optional shared secret

  const pollIntervalMs = process.env["POLL_INTERVAL_MS"]
    ? parseInt(requireEnv("POLL_INTERVAL_MS"), 10)
    : 5 * 60 * 1000;

  const puller = new Puller({
    languagesFile,
    rootfsBaseDir,
    client: new RealOciClient(),
    pollIntervalMs,
  });

  const server = createServer({ port, puller, reloadToken });
  server.listen(port, () => {
    console.log(`[puller] http listening on :${port}`);
  });

  process.on("SIGTERM", () => void shutdown(server, puller));
  process.on("SIGINT", () => void shutdown(server, puller));

  await puller.start();
  console.log("[puller] initial reconcile complete, entering poll loop");
}

async function shutdown(server: import("http").Server, puller: Puller): Promise<void> {
  server.close();
  await puller.stop();
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[puller] fatal startup error", err);
    process.exit(1);
  });
}

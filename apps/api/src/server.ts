/** API entrypoint: bootstrap the runtime, build the app, listen, handle shutdown. */
import { buildApp } from "./app.js";
import { closeApiRuntime, createApiRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const rt = createApiRuntime();
  const app = buildApp(rt);

  await app.listen({ host: "0.0.0.0", port: rt.env.API_PORT });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await closeApiRuntime(rt);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

void main();

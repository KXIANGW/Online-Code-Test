import amqp, { type Channel, type ChannelModel } from "amqplib";
import { config } from "./config";
import { pool } from "./db/client";
import { startJudgeConsumer } from "./consumers/judge.consumer";
import { loadLanguages } from "./engine/languages";
import { createHealthServer, type HealthState } from "./healthcheck";

const JUDGE_TASKS_QUEUE = "judge.tasks";
const JUDGE_RESULTS_EXCHANGE = "judge.results";
const JUDGE_RESULTS_BACKEND_QUEUE = "judge.results.backend";
const JUDGE_DLQ = "judge.dlq";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let shuttingDown = false;

const healthState: HealthState = { rabbitConnected: false };

async function main(): Promise<void> {
  const healthPort = parseInt(process.env["HEALTH_PORT"] ?? "8080", 10);
  const healthServer = createHealthServer(healthState, healthPort);

  process.on("SIGTERM", () => void shutdown("SIGTERM", healthServer));
  process.on("SIGINT", () => void shutdown("SIGINT", healthServer));

  await connectWithRetry();
}

async function connectWithRetry(attempt = 0): Promise<void> {
  try {
    await connectOnce();
    console.log("[worker] judge consumer started");
  } catch (err) {
    if (shuttingDown) return;
    const delay = Math.min(30000, 1000 * 2 ** attempt);
    console.error(`[worker] connection failed; retrying in ${delay}ms`, err);
    setTimeout(() => {
      connectWithRetry(attempt + 1).catch((retryErr) => {
        console.error("[worker] retry failed", retryErr);
      });
    }, delay);
  }
}

async function connectOnce(): Promise<void> {
  const nextConnection = await amqp.connect(config.rabbitmqUrl);
  connection = nextConnection;
  nextConnection.on("close", () => {
    healthState.rabbitConnected = false;
    channel = null;
    connection = null;
    if (!shuttingDown) {
      connectWithRetry().catch((err) => console.error("[worker] reconnect failed", err));
    }
  });
  nextConnection.on("error", (err) => {
    console.error("[worker] rabbitmq connection error", err);
  });

  const languages = loadLanguages();
  const nextChannel = await nextConnection.createChannel();
  channel = nextChannel;
  await assertTopology(nextChannel);
  await startJudgeConsumer(nextChannel, languages);
  healthState.rabbitConnected = true;
}

async function assertTopology(ch: Channel): Promise<void> {
  await ch.assertQueue(JUDGE_DLQ, { durable: true });
  await ch.assertQueue(JUDGE_TASKS_QUEUE, {
    durable: true,
    deadLetterExchange: "",
    deadLetterRoutingKey: JUDGE_DLQ,
  });
  await ch.assertExchange(JUDGE_RESULTS_EXCHANGE, "fanout", { durable: true });
  await ch.assertQueue(JUDGE_RESULTS_BACKEND_QUEUE, { durable: true });
  await ch.bindQueue(JUDGE_RESULTS_BACKEND_QUEUE, JUDGE_RESULTS_EXCHANGE, "");
}

async function shutdown(signal: string, healthServer: import("node:http").Server): Promise<void> {
  shuttingDown = true;
  console.log(`[worker] received ${signal}; shutting down`);
  healthServer.close();
  await channel?.close().catch(() => undefined);
  await connection?.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[worker] fatal startup error", err);
    process.exit(1);
  });
}

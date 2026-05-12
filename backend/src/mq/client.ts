import amqp, { type Channel, type ChannelModel } from "amqplib";
import { env } from "../env";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export const JUDGE_TASKS_QUEUE = "judge.tasks";
export const JUDGE_RESULTS_EXCHANGE = "judge.results";
export const JUDGE_RESULTS_BACKEND_QUEUE = "judge.results.backend";
export const JUDGE_DLQ = "judge.dlq";

export async function getChannel(): Promise<Channel> {
  if (channel) return channel;

  const nextConnection = await amqp.connect(env.RABBITMQ_URL);
  connection = nextConnection;
  nextConnection.on("close", () => {
    connection = null;
    channel = null;
  });
  nextConnection.on("error", () => {
    connection = null;
    channel = null;
  });

  const nextChannel = await nextConnection.createChannel();
  channel = nextChannel;
  nextChannel.on("close", () => {
    channel = null;
  });
  nextChannel.on("error", () => {
    channel = null;
  });

  await assertJudgeTopology(nextChannel);
  return nextChannel;
}

export async function assertJudgeTopology(ch: Channel): Promise<void> {
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

export async function closeMq(): Promise<void> {
  const currentChannel = channel;
  const currentConnection = connection;
  channel = null;
  connection = null;

  await currentChannel?.close().catch(() => undefined);
  await currentConnection?.close().catch(() => undefined);
}

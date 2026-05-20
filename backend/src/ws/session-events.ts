import { randomUUID } from "node:crypto";
import os from "node:os";
import type Redis from "ioredis";
import { redis } from "../db/redis";
import { publishToSession } from "./hub";

type SessionEventEnvelope = {
  origin: string;
  sessionId: number;
  payload: unknown;
};

type RedisPublisher = Pick<Redis, "publish">;
type RedisSubscriber = Pick<Redis, "connect" | "duplicate" | "on" | "quit" | "subscribe">;
type Logger = {
  warn(message: string): void;
  warn(context: unknown, message: string): void;
};

export const WS_SESSION_EVENTS_CHANNEL = "oct:ws:session-events";

let instanceId = `${os.hostname()}-${randomUUID()}`;
let publisher: RedisPublisher = redis;
let subscriber: RedisSubscriber | null = null;
let started = false;

function parseEnvelope(raw: string): SessionEventEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SessionEventEnvelope>;
    if (
      typeof parsed.origin !== "string" ||
      typeof parsed.sessionId !== "number" ||
      !Number.isInteger(parsed.sessionId) ||
      parsed.payload === undefined
    ) {
      return null;
    }

    return {
      origin: parsed.origin,
      sessionId: parsed.sessionId,
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}

export async function publishSessionEvent(sessionId: number, payload: unknown): Promise<number> {
  const delivered = publishToSession(sessionId, payload);
  const envelope: SessionEventEnvelope = { origin: instanceId, sessionId, payload };

  publisher.publish(WS_SESSION_EVENTS_CHANNEL, JSON.stringify(envelope)).catch((err) => {
    console.warn("[ws] failed to publish session event to Redis", err);
  });

  return delivered;
}

export function handleSessionEventBusMessage(raw: string): number {
  const envelope = parseEnvelope(raw);
  if (!envelope || envelope.origin === instanceId) return 0;
  return publishToSession(envelope.sessionId, envelope.payload);
}

export async function startSessionEventBus(logger?: Logger): Promise<void> {
  if (started) return;

  const nextSubscriber = redis.duplicate({ lazyConnect: true });
  nextSubscriber.on("message", (channel: string, message: string) => {
    if (channel === WS_SESSION_EVENTS_CHANNEL) handleSessionEventBusMessage(message);
  });
  nextSubscriber.on("error", (err: unknown) => {
    logger?.warn({ err }, "Redis session event subscriber error");
  });

  await nextSubscriber.connect();
  await nextSubscriber.subscribe(WS_SESSION_EVENTS_CHANNEL);
  subscriber = nextSubscriber;
  started = true;
}

export async function closeSessionEventBus(): Promise<void> {
  const currentSubscriber = subscriber;
  subscriber = null;
  started = false;
  if (currentSubscriber) await currentSubscriber.quit().catch(() => undefined);
}

export function configureSessionEventBusForTests(options: {
  instanceId: string;
  publisher: RedisPublisher;
}): void {
  instanceId = options.instanceId;
  publisher = options.publisher;
}

export function resetSessionEventBusForTests(): void {
  instanceId = `${os.hostname()}-${randomUUID()}`;
  publisher = redis;
  subscriber = null;
  started = false;
}

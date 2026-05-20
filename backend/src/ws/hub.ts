type WsClient = {
  readyState?: number;
  send(data: string): void;
  close(): void;
  on(event: "message" | "close" | "error", listener: (data?: unknown) => void): void;
};

const OPEN = 1;
const subscribers = new Map<number, Set<WsClient>>();

export function countActiveSubscribers(): number {
  let total = 0;
  for (const clients of subscribers.values()) total += clients.size;
  return total;
}

export function subscribeToSession(sessionId: number, client: WsClient): void {
  const clients = subscribers.get(sessionId) ?? new Set<WsClient>();
  clients.add(client);
  subscribers.set(sessionId, clients);
}

export function unsubscribeClient(client: WsClient): void {
  for (const [sessionId, clients] of subscribers) {
    clients.delete(client);
    if (clients.size === 0) subscribers.delete(sessionId);
  }
}

export function publishToSession(sessionId: number, payload: unknown): number {
  const clients = subscribers.get(sessionId);
  if (!clients) return 0;

  const message = JSON.stringify(payload);
  let sent = 0;

  for (const client of clients) {
    if (client.readyState !== undefined && client.readyState !== OPEN) {
      clients.delete(client);
      continue;
    }

    client.send(message);
    sent += 1;
  }

  if (clients.size === 0) subscribers.delete(sessionId);
  return sent;
}

export function resetSubscribersForTests(): void {
  subscribers.clear();
}

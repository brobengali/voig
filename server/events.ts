import type { Response } from "express";

export interface VaultEvent {
  type:
    | "call.updated"
    | "call.progress"
    | "room.founder_joined"
    | "room.recording"
    | "room.submitted";
  callId: string;
  stage?: string;
  message?: string;
  timestamp: string;
}

const clients = new Set<Response>();

export function registerSseClient(res: Response): () => void {
  clients.add(res);
  return () => {
    clients.delete(res);
  };
}

export function broadcastVaultEvent(event: Omit<VaultEvent, "timestamp">): void {
  const payload: VaultEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  const encoded = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(encoded);
    } catch {
      clients.delete(res);
    }
  }
}

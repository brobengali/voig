import type {
  BlindspotLedger,
  CallRecord,
  RoomPublicMeta,
  ThesisProfile,
  VaultStatus,
} from "./types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  vaultStatus: () => requestJson<VaultStatus>("/api/vault/status"),
  vaultInit: (passphrase: string) =>
    requestJson<{ ok: boolean }>("/api/vault/init", {
      method: "POST",
      body: JSON.stringify({ passphrase }),
    }),
  vaultUnlock: (passphrase: string) =>
    requestJson<{ ok: boolean; resumedCalls?: number }>("/api/vault/unlock", {
      method: "POST",
      body: JSON.stringify({ passphrase }),
    }),
  vaultLock: () =>
    requestJson<{ ok: boolean }>("/api/vault/lock", { method: "POST" }),

  listThesis: () => requestJson<{ profiles: ThesisProfile[] }>("/api/thesis"),
  saveThesis: (profile: Partial<ThesisProfile>) =>
    requestJson<{ profile: ThesisProfile }>("/api/thesis", {
      method: "POST",
      body: JSON.stringify(profile),
    }),
  deleteThesis: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/thesis/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  listCalls: () => requestJson<{ calls: CallRecord[] }>("/api/calls"),
  getCall: (id: string) =>
    requestJson<{ call: CallRecord }>(`/api/calls/${encodeURIComponent(id)}`),
  deleteCall: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/calls/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  reanalyzeCall: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/calls/${encodeURIComponent(id)}/reanalyze`, {
      method: "POST",
    }),
  calibrateCritique: (
    callId: string,
    critiqueId: string,
    verdict: "fair_hit" | "knew_from_deck" | "off_base"
  ) =>
    requestJson<{ ok: boolean }>(`/api/calls/${encodeURIComponent(callId)}/calibrate`, {
      method: "POST",
      body: JSON.stringify({ critiqueId, verdict }),
    }),
  getLedger: () => requestJson<BlindspotLedger>("/api/ledger"),

  ingestCall: (formData: FormData) =>
    requestJson<{ id: string; status: string }>("/api/calls/ingest", {
      method: "POST",
      body: formData,
    }),

  createRoom: (formData: FormData) =>
    requestJson<{ id: string; roomUrl: string; expiresAt: string }>("/api/rooms", {
      method: "POST",
      body: formData,
    }),

  getRoomPublic: (roomId: string, token: string) =>
    requestJson<{ roomStatus: string; status: string; publicMeta: RoomPublicMeta }>(
      `/api/rooms/${encodeURIComponent(roomId)}/public?token=${encodeURIComponent(token)}`
    ),
  postRoomPresence: (
    roomId: string,
    token: string,
    state: "joined" | "recording" | "paused"
  ) =>
    requestJson<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(roomId)}/presence`, {
      method: "POST",
      body: JSON.stringify({ token, state }),
    }),
  submitRoomAudio: (roomId: string, formData: FormData) =>
    requestJson<{ ok: boolean; submitted: boolean }>(
      `/api/rooms/${encodeURIComponent(roomId)}/submit`,
      {
        method: "POST",
        body: formData,
      }
    ),
};

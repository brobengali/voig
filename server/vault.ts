import crypto from "node:crypto";
import fs from "node:fs";
import { config } from "./config.js";
import {
  decryptBuffer,
  decryptJson,
  deriveKey,
  deriveSubKey,
  encryptBuffer,
  encryptJson,
  hashPassphraseVerifier,
  verifyPassphrase,
} from "./crypto.js";
import { CallRow, db, getBlobPath, VaultMetaRow } from "./db.js";
import {
  CalibrationRecord,
  CallAnalysis,
  CallMeta,
  DecryptedCallRecord,
  RoomPublicMeta,
  ThesisProfile,
  ThesisProfileInputSchema,
  TranscriptSegment,
} from "./types.js";

let activeDek: Buffer | null = null;

export function isVaultInitialized(): boolean {
  const row = db.prepare("SELECT id FROM vault_meta WHERE id = 1").get();
  return Boolean(row);
}

export function isVaultUnlocked(): boolean {
  return activeDek !== null;
}

export function getActiveDek(): Buffer {
  if (!activeDek) {
    throw new Error("VAULT_LOCKED");
  }
  return activeDek;
}

export function initializeVault(passphrase: string): void {
  if (isVaultInitialized()) {
    throw new Error("Vault is already initialized.");
  }
  if (passphrase.length < 10) {
    throw new Error("Passphrase must be at least 10 characters.");
  }

  const saltHex = crypto.randomBytes(16).toString("hex");
  const kek = deriveKey(passphrase, saltHex);
  const dek = crypto.randomBytes(32);
  const wrappedDek = encryptBuffer(dek, kek).toString("base64");
  const verifier = hashPassphraseVerifier(passphrase, saltHex);

  db.prepare(
    `INSERT INTO vault_meta (id, salt, wrapped_dek, passphrase_verifier, created_at)
     VALUES (1, ?, ?, ?, ?)`
  ).run(saltHex, wrappedDek, verifier, new Date().toISOString());

  activeDek = dek;
}

export function unlockVault(passphrase: string): boolean {
  const meta = db
    .prepare("SELECT * FROM vault_meta WHERE id = 1")
    .get() as VaultMetaRow | undefined;
  if (!meta) {
    throw new Error("Vault is not initialized.");
  }
  if (!verifyPassphrase(passphrase, meta.salt, meta.passphrase_verifier)) {
    return false;
  }
  const kek = deriveKey(passphrase, meta.salt);
  const dek = decryptBuffer(Buffer.from(meta.wrapped_dek, "base64"), kek);
  activeDek = dek;
  return true;
}

export function lockVault(): void {
  if (activeDek) {
    activeDek.fill(0);
    activeDek = null;
  }
}

export function listThesisProfiles(): ThesisProfile[] {
  const dek = getActiveDek();
  const rows = db
    .prepare("SELECT id, encrypted_payload, created_at, updated_at FROM thesis_profiles ORDER BY updated_at DESC")
    .all() as Array<{
      id: string;
      encrypted_payload: string;
      created_at: string;
      updated_at: string;
    }>;

  return rows.map((row) => {
    const parsed = decryptJson<Omit<ThesisProfile, "id" | "createdAt" | "updatedAt">>(
      row.encrypted_payload,
      dek
    );
    return {
      ...parsed,
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export function saveThesisProfile(rawInput: unknown): ThesisProfile {
  const dek = getActiveDek();
  const input = ThesisProfileInputSchema.parse(rawInput);
  const now = new Date().toISOString();
  const id = input.id?.trim() || crypto.randomUUID();
  const { id: _ignored, ...body } = input;
  const encrypted = encryptJson(body, dek);

  const existing = db
    .prepare("SELECT created_at FROM thesis_profiles WHERE id = ?")
    .get(id) as { created_at: string } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE thesis_profiles SET encrypted_payload = ?, updated_at = ? WHERE id = ?"
    ).run(encrypted, now, id);
    return { ...body, id, createdAt: existing.created_at, updatedAt: now };
  }

  db.prepare(
    "INSERT INTO thesis_profiles (id, encrypted_payload, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(id, encrypted, now, now);

  return { ...body, id, createdAt: now, updatedAt: now };
}

export function deleteThesisProfile(id: string): boolean {
  getActiveDek();
  const res = db.prepare("DELETE FROM thesis_profiles WHERE id = ?").run(id);
  return res.changes > 0;
}

export function createCallRecord(params: {
  sourceType: "pitch_room" | "upload" | "live_capture" | "transcript";
  status: string;
  roomStatus?: string;
  meta: CallMeta;
  roomPublic?: RoomPublicMeta | null;
  transcript?: TranscriptSegment[] | null;
}): { id: string; roomUploadKey: Buffer | null } {
  const dek = getActiveDek();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  let roomKeyWrappedDek: string | null = null;
  let roomKeyWrappedServer: string | null = null;
  let roomUploadKey: Buffer | null = null;
  let encryptedRoomPublic: string | null = null;

  if (params.roomPublic) {
    roomUploadKey = crypto.randomBytes(32);
    const serverWrapKey = deriveSubKey(config.roomTokenSecret, `room-wrap:${id}`);
    roomKeyWrappedDek = encryptBuffer(roomUploadKey, dek).toString("base64");
    roomKeyWrappedServer = encryptBuffer(roomUploadKey, serverWrapKey).toString("base64");
    encryptedRoomPublic = encryptJson(params.roomPublic, serverWrapKey);
  }

  db.prepare(
    `INSERT INTO calls (
      id, status, source_type, room_status, created_at, updated_at,
      encrypted_meta, encrypted_room_public, encrypted_transcript,
      room_key_wrapped_dek, room_key_wrapped_server
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.status,
    params.sourceType,
    params.roomStatus ?? "none",
    now,
    now,
    encryptJson(params.meta, dek),
    encryptedRoomPublic,
    params.transcript ? encryptJson(params.transcript, dek) : null,
    roomKeyWrappedDek,
    roomKeyWrappedServer
  );

  return { id, roomUploadKey };
}

export function updateCallStatus(
  id: string,
  updates: {
    status?: string;
    roomStatus?: string;
    errorMessage?: string | null;
  }
): void {
  const now = new Date().toISOString();
  const row = db
    .prepare("SELECT status, room_status, error_message FROM calls WHERE id = ?")
    .get(id) as { status: string; room_status: string; error_message: string | null } | undefined;
  if (!row) return;

  db.prepare(
    `UPDATE calls SET status = ?, room_status = ?, error_message = ?, updated_at = ? WHERE id = ?`
  ).run(
    updates.status ?? row.status,
    updates.roomStatus ?? row.room_status,
    updates.errorMessage !== undefined ? updates.errorMessage : row.error_message,
    now,
    id
  );
}

export function storeEncryptedAudioForCall(
  id: string,
  audioBuffer: Buffer,
  mimeType: string,
  useRoomKey = false
): void {
  const blobPath = getBlobPath(id);
  let encKey: Buffer;

  if (useRoomKey) {
    const row = db
      .prepare("SELECT room_key_wrapped_server FROM calls WHERE id = ?")
      .get(id) as { room_key_wrapped_server: string | null } | undefined;
    if (!row?.room_key_wrapped_server) {
      throw new Error("Missing room encryption key.");
    }
    const serverWrapKey = deriveSubKey(config.roomTokenSecret, `room-wrap:${id}`);
    encKey = decryptBuffer(Buffer.from(row.room_key_wrapped_server, "base64"), serverWrapKey);
  } else {
    encKey = getActiveDek();
  }

  const encrypted = encryptBuffer(audioBuffer, encKey);
  fs.writeFileSync(blobPath, encrypted);

  db.prepare(
    "UPDATE calls SET audio_blob_path = ?, audio_mime = ?, updated_at = ? WHERE id = ?"
  ).run(id, mimeType, new Date().toISOString(), id);
}

export function storeRoomPendingTranscript(roomId: string, transcriptText: string): void {
  const row = db
    .prepare("SELECT room_key_wrapped_server FROM calls WHERE id = ?")
    .get(roomId) as { room_key_wrapped_server: string | null } | undefined;
  if (!row?.room_key_wrapped_server) {
    throw new Error("Missing room encryption key.");
  }
  const serverWrapKey = deriveSubKey(config.roomTokenSecret, `room-wrap:${roomId}`);
  const encKey = decryptBuffer(
    Buffer.from(row.room_key_wrapped_server, "base64"),
    serverWrapKey
  );
  const encrypted = encryptJson({ text: transcriptText }, encKey);
  db.prepare(
    "UPDATE calls SET room_pending_transcript = ?, updated_at = ? WHERE id = ?"
  ).run(encrypted, new Date().toISOString(), roomId);
}

export function updateCallTranscript(id: string, segments: TranscriptSegment[]): void {
  const dek = getActiveDek();
  db.prepare(
    "UPDATE calls SET encrypted_transcript = ?, updated_at = ? WHERE id = ?"
  ).run(encryptJson(segments, dek), new Date().toISOString(), id);
}

export function readDecryptedAudioForCall(id: string): { buffer: Buffer; mimeType: string } | null {
  const dek = getActiveDek();
  const row = db
    .prepare("SELECT audio_blob_path, audio_mime, room_key_wrapped_dek FROM calls WHERE id = ?")
    .get(id) as
    | {
        audio_blob_path: string | null;
        audio_mime: string | null;
        room_key_wrapped_dek: string | null;
      }
    | undefined;

  if (!row?.audio_blob_path || !row.audio_mime) return null;
  const blobPath = getBlobPath(row.audio_blob_path);
  if (!fs.existsSync(blobPath)) return null;

  const encrypted = fs.readFileSync(blobPath);
  const key = row.room_key_wrapped_dek
    ? decryptBuffer(Buffer.from(row.room_key_wrapped_dek, "base64"), dek)
    : dek;

  return {
    buffer: decryptBuffer(encrypted, key),
    mimeType: row.audio_mime,
  };
}

export function saveCallResults(
  id: string,
  payload: {
    transcript?: TranscriptSegment[];
    analysis?: CallAnalysis;
    durationSeconds?: number;
    status?: string;
  }
): void {
  const dek = getActiveDek();
  const row = db
    .prepare("SELECT encrypted_meta FROM calls WHERE id = ?")
    .get(id) as { encrypted_meta: string } | undefined;
  if (!row) return;

  let encryptedMeta = row.encrypted_meta;
  if (payload.durationSeconds !== undefined) {
    const meta = decryptJson<CallMeta>(row.encrypted_meta, dek);
    meta.durationSeconds = payload.durationSeconds;
    encryptedMeta = encryptJson(meta, dek);
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE calls SET
      encrypted_meta = ?,
      encrypted_transcript = COALESCE(?, encrypted_transcript),
      encrypted_analysis = COALESCE(?, encrypted_analysis),
      status = COALESCE(?, status),
      error_message = NULL,
      updated_at = ?
     WHERE id = ?`
  ).run(
    encryptedMeta,
    payload.transcript ? encryptJson(payload.transcript, dek) : null,
    payload.analysis ? encryptJson(payload.analysis, dek) : null,
    payload.status ?? null,
    now,
    id
  );
}

export function getRoomPublicInfo(roomId: string): {
  roomStatus: string;
  status: string;
  publicMeta: RoomPublicMeta;
} | null {
  const row = db
    .prepare("SELECT status, room_status, encrypted_room_public FROM calls WHERE id = ?")
    .get(roomId) as
    | { status: string; room_status: string; encrypted_room_public: string | null }
    | undefined;
  if (!row?.encrypted_room_public) return null;

  const serverWrapKey = deriveSubKey(config.roomTokenSecret, `room-wrap:${roomId}`);
  const publicMeta = decryptJson<RoomPublicMeta>(row.encrypted_room_public, serverWrapKey);
  return {
    roomStatus: row.room_status,
    status: row.status,
    publicMeta,
  };
}

function hydrateCallRow(row: CallRow, dek: Buffer): DecryptedCallRecord {
  const meta = decryptJson<CallMeta>(row.encrypted_meta, dek);
  let roomPublic: RoomPublicMeta | null = null;
  if (row.encrypted_room_public) {
    try {
      const serverWrapKey = deriveSubKey(config.roomTokenSecret, `room-wrap:${row.id}`);
      roomPublic = decryptJson<RoomPublicMeta>(row.encrypted_room_public, serverWrapKey);
    } catch {
      roomPublic = null;
    }
  }

  let transcript = row.encrypted_transcript
    ? decryptJson<TranscriptSegment[]>(row.encrypted_transcript, dek)
    : null;

  if (!transcript && row.room_pending_transcript && row.room_key_wrapped_dek) {
    try {
      const roomKey = decryptBuffer(Buffer.from(row.room_key_wrapped_dek, "base64"), dek);
      const pending = decryptJson<{ text: string }>(row.room_pending_transcript, roomKey);
      if (pending.text?.trim()) {
        transcript = [
          {
            id: "raw-input",
            speaker: "Founder Pitch",
            role: "founder",
            startSec: 0,
            endSec: 0,
            text: pending.text.trim(),
          },
        ];
        db.prepare(
          "UPDATE calls SET encrypted_transcript = ?, room_pending_transcript = NULL WHERE id = ?"
        ).run(encryptJson(transcript, dek), row.id);
      }
    } catch {
      // ignore malformed pending transcript
    }
  }
  const analysis = row.encrypted_analysis
    ? decryptJson<CallAnalysis>(row.encrypted_analysis, dek)
    : null;

  const calRows = db
    .prepare("SELECT critique_id, verdict, created_at FROM feedback_calibrations WHERE call_id = ?")
    .all(row.id) as Array<{ critique_id: string; verdict: CalibrationRecord["verdict"]; created_at: string }>;

  const calibrations: Record<string, CalibrationRecord> = {};
  for (const c of calRows) {
    calibrations[c.critique_id] = {
      critiqueId: c.critique_id,
      verdict: c.verdict,
      createdAt: c.created_at,
    };
  }

  return {
    id: row.id,
    status: row.status,
    sourceType: row.source_type,
    roomStatus: row.room_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    meta,
    roomPublic,
    transcript,
    analysis,
    hasAudio: Boolean(row.audio_blob_path),
    audioMime: row.audio_mime,
    errorMessage: row.error_message,
    calibrations,
  };
}

export function listCalls(): DecryptedCallRecord[] {
  const dek = getActiveDek();
  const rows = db
    .prepare("SELECT * FROM calls ORDER BY created_at DESC")
    .all() as unknown as CallRow[];
  return rows.map((row) => hydrateCallRow(row, dek));
}

export function getCall(id: string): DecryptedCallRecord | null {
  const dek = getActiveDek();
  const row = db.prepare("SELECT * FROM calls WHERE id = ?").get(id) as CallRow | undefined;
  if (!row) return null;
  return hydrateCallRow(row, dek);
}

export function deleteCall(id: string): boolean {
  getActiveDek();
  const row = db
    .prepare("SELECT audio_blob_path FROM calls WHERE id = ?")
    .get(id) as { audio_blob_path: string | null } | undefined;
  if (!row) return false;

  if (row.audio_blob_path) {
    try {
      const blobPath = getBlobPath(row.audio_blob_path);
      if (fs.existsSync(blobPath)) {
        fs.unlinkSync(blobPath);
      }
    } catch {
      // ignore missing blob
    }
  }
  const res = db.prepare("DELETE FROM calls WHERE id = ?").run(id);
  return res.changes > 0;
}

export function setCalibration(
  callId: string,
  critiqueId: string,
  verdict: CalibrationRecord["verdict"]
): void {
  getActiveDek();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO feedback_calibrations (id, call_id, critique_id, verdict, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(call_id, critique_id) DO UPDATE SET verdict = excluded.verdict, created_at = excluded.created_at`
  ).run(crypto.randomUUID(), callId, critiqueId, verdict, now);
}

export function listPendingUnlockCallIds(): string[] {
  const rows = db
    .prepare("SELECT id FROM calls WHERE status = 'pending_unlock'")
    .all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function computeBlindspotLedger() {
  const calls = listCalls().filter((c) => c.analysis);
  if (calls.length === 0) {
    return {
      totalCallsAnalyzed: 0,
      avgInvestorTalkPct: 0,
      avgDisciplineScore: 0,
      avgFollowupDepth: 0,
      topBiases: [] as Array<{ category: string; count: number; fairHits: number }>,
      recentTrend: [] as Array<{
        callId: string;
        companyName: string;
        disciplineScore: number;
        investorTalkPct: number;
        createdAt: string;
      }>,
      calibrationPrecision: { fairHit: 0, knewFromDeck: 0, offBase: 0 },
    };
  }

  let talkSum = 0;
  let scoreSum = 0;
  let depthSum = 0;
  const biasMap = new Map<string, { count: number; fairHits: number }>();
  const calCounts = { fairHit: 0, knewFromDeck: 0, offBase: 0 };

  for (const call of calls) {
    const a = call.analysis!;
    talkSum += a.dynamics.investorTalkPct;
    scoreSum += a.overallDisciplineScore;
    depthSum += a.dynamics.followupDepthScore;

    for (const c of a.critiques) {
      const cal = call.calibrations[c.id];
      if (cal?.verdict === "fair_hit") calCounts.fairHit += 1;
      else if (cal?.verdict === "knew_from_deck") calCounts.knewFromDeck += 1;
      else if (cal?.verdict === "off_base") calCounts.offBase += 1;

      if (c.severity !== "strength") {
        const prev = biasMap.get(c.category) ?? { count: 0, fairHits: 0 };
        prev.count += 1;
        if (cal?.verdict === "fair_hit") prev.fairHits += 1;
        biasMap.set(c.category, prev);
      }
    }
  }

  const topBiases = Array.from(biasMap.entries())
    .map(([category, stats]) => ({ category, ...stats }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    totalCallsAnalyzed: calls.length,
    avgInvestorTalkPct: Math.round(talkSum / calls.length),
    avgDisciplineScore: Math.round(scoreSum / calls.length),
    avgFollowupDepth: Number((depthSum / calls.length).toFixed(1)),
    topBiases,
    recentTrend: calls.slice(0, 12).map((c) => ({
      callId: c.id,
      companyName: c.meta.companyName,
      disciplineScore: c.analysis!.overallDisciplineScore,
      investorTalkPct: c.analysis!.dynamics.investorTalkPct,
      createdAt: c.createdAt,
    })),
    calibrationPrecision: calCounts,
  };
}

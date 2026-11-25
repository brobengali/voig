import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

fs.mkdirSync(config.vaultDataDir, { recursive: true });
fs.mkdirSync(path.join(config.vaultDataDir, "blobs"), { recursive: true });

const dbPath = path.join(config.vaultDataDir, "vault.sqlite");
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS vault_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    salt TEXT NOT NULL,
    wrapped_dek TEXT NOT NULL,
    passphrase_verifier TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS thesis_profiles (
    id TEXT PRIMARY KEY,
    encrypted_payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    source_type TEXT NOT NULL,
    room_status TEXT NOT NULL DEFAULT 'none',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    encrypted_meta TEXT NOT NULL,
    encrypted_room_public TEXT,
    encrypted_transcript TEXT,
    encrypted_analysis TEXT,
    audio_blob_path TEXT,
    audio_mime TEXT,
    room_key_wrapped_dek TEXT,
    room_key_wrapped_server TEXT,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS feedback_calibrations (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    critique_id TEXT NOT NULL,
    verdict TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(call_id, critique_id),
    FOREIGN KEY(call_id) REFERENCES calls(id) ON DELETE CASCADE
  );
`);

export interface VaultMetaRow {
  id: number;
  salt: string;
  wrapped_dek: string;
  passphrase_verifier: string;
  created_at: string;
}

export interface CallRow {
  id: string;
  status: string;
  source_type: string;
  room_status: string;
  created_at: string;
  updated_at: string;
  encrypted_meta: string;
  encrypted_room_public: string | null;
  encrypted_transcript: string | null;
  encrypted_analysis: string | null;
  audio_blob_path: string | null;
  audio_mime: string | null;
  room_key_wrapped_dek: string | null;
  room_key_wrapped_server: string | null;
  error_message: string | null;
}

export function getBlobPath(blobId: string): string {
  const safeId = blobId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) throw new Error("Invalid blob identifier");
  const resolved = path.resolve(config.vaultDataDir, "blobs", `${safeId}.enc`);
  const base = path.resolve(config.vaultDataDir, "blobs");
  if (!resolved.startsWith(base + path.sep)) {
    throw new Error("Path traversal attempt rejected");
  }
  return resolved;
}

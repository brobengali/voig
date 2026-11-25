import crypto from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  HOST: z.string().min(1).default("127.0.0.1"),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:5173"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_API_VERSION: z.string().min(1).default("v1"),
  GEMINI_MODEL_TRANSCRIBE: z.string().min(1).default("gemini-3.5-transcribe"),
  GEMINI_MODEL_CRITIC: z.string().min(1).default("gemini-4-hydrogen"),
  GEMINI_MODEL_SYNTHESIS: z.string().min(1).default("gemini-4-carbon"),
  SESSION_SECRET: z.string().optional().default(""),
  ROOM_TOKEN_SECRET: z.string().optional().default(""),
  VAULT_DATA_DIR: z.string().min(1).default("./vault_data"),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(500).default(100),
  SESSION_TTL_HOURS: z.coerce.number().min(0.5).max(168).default(12),
  ROOM_TOKEN_TTL_HOURS: z.coerce.number().min(0.5).max(168).default(24),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = EnvSchema.parse(process.env);

function resolveSecret(value: string, label: string): string {
  if (value && value.length >= 32) {
    return value;
  }
  console.warn(
    `[SECURITY] ${label} is missing or <32 chars in .env; generated an ephemeral in-memory secret for this process.`
  );
  return crypto.randomBytes(32).toString("hex");
}

export const config = {
  port: parsed.PORT,
  host: parsed.HOST,
  appOrigin: parsed.APP_ORIGIN,
  publicBaseUrl: parsed.PUBLIC_BASE_URL.replace(/\/+$/, ""),
  geminiApiKey: parsed.GEMINI_API_KEY.trim(),
  geminiApiVersion: parsed.GEMINI_API_VERSION,
  models: {
    transcribe: parsed.GEMINI_MODEL_TRANSCRIBE,
    critic: parsed.GEMINI_MODEL_CRITIC,
    synthesis: parsed.GEMINI_MODEL_SYNTHESIS,
  },
  sessionSecret: resolveSecret(parsed.SESSION_SECRET, "SESSION_SECRET"),
  roomTokenSecret: resolveSecret(parsed.ROOM_TOKEN_SECRET, "ROOM_TOKEN_SECRET"),
  vaultDataDir: path.resolve(process.cwd(), parsed.VAULT_DATA_DIR),
  maxUploadBytes: parsed.MAX_UPLOAD_MB * 1024 * 1024,
  sessionTtlMs: parsed.SESSION_TTL_HOURS * 60 * 60 * 1000,
  roomTokenTtlMs: parsed.ROOM_TOKEN_TTL_HOURS * 60 * 60 * 1000,
  isProd: parsed.NODE_ENV === "production",
} as const;

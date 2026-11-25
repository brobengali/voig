import crypto from "node:crypto";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { config } from "./config.js";
import { signToken, verifyToken } from "./crypto.js";
import { broadcastVaultEvent, registerSseClient } from "./events.js";
import {
  extractDeckSummary,
  processCallPipeline,
  retranscribeExistingCall,
  transcribeAudioBufferToText,
} from "./agent.js";
import { CallObjectiveSchema } from "./types.js";
import {
  computeBlindspotLedger,
  createCallRecord,
  deleteCall,
  deleteThesisProfile,
  getCall,
  getRoomPublicInfo,
  initializeVault,
  isVaultInitialized,
  isVaultUnlocked,
  listCalls,
  listPendingUnlockCallIds,
  listThesisProfiles,
  lockVault,
  readDecryptedAudioForCall,
  saveThesisProfile,
  setCalibration,
  storeEncryptedAudioForCall,
  storeRoomPendingTranscript,
  unlockVault,
  updateCallStatus,
  updateCallTranscript,
} from "./vault.js";

const SESSION_COOKIE = "redline_session";

const ALLOWED_AUDIO_MIMES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/flac",
  "video/webm",
  "video/mp4",
]);

const ALLOWED_DECK_MIMES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 2,
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Try again shortly." },
});

const roomLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function setSessionCookie(res: Response): void {
  const token = signToken(
    {
      role: "investor",
      nonce: crypto.randomBytes(12).toString("hex"),
      exp: Date.now() + config.sessionTtlMs,
    },
    config.sessionSecret
  );

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: config.sessionTtlMs,
    path: "/",
  });
}

function hasValidSessionCookie(req: Request): boolean {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string") return false;
  const payload = verifyToken<{ role?: string; exp?: number }>(token, config.sessionSecret);
  return payload?.role === "investor";
}

function requireInvestorAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isVaultUnlocked() || !hasValidSessionCookie(req)) {
    res.status(401).json({ error: "Vault is locked or session expired." });
    return;
  }

  // CSRF check on mutating requests
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin) {
      const allowedOrigins = new Set([
        config.appOrigin,
        config.publicBaseUrl,
        `http://localhost:${config.port}`,
        `http://127.0.0.1:${config.port}`,
      ]);
      if (!allowedOrigins.has(origin)) {
        res.status(403).json({ error: "Cross-origin request rejected." });
        return;
      }
    }
  }

  next();
}

function verifyRoomToken(roomId: string, token: unknown): boolean {
  if (typeof token !== "string" || !token) return false;
  const payload = verifyToken<{ roomId?: string; scope?: string; exp?: number }>(
    token,
    config.roomTokenSecret
  );
  return payload?.scope === "founder_room" && payload?.roomId === roomId;
}

function cleanMime(raw: string | undefined): string {
  return (raw || "audio/webm").split(";")[0].trim().toLowerCase();
}

export function createApiRouter(): Router {
  const router = express.Router();

  // --- Vault status & auth ---
  router.get("/vault/status", (req, res) => {
    res.json({
      initialized: isVaultInitialized(),
      unlocked: isVaultUnlocked(),
      authenticated: isVaultUnlocked() && hasValidSessionCookie(req),
      geminiConfigured: Boolean(config.geminiApiKey),
      models: config.models,
      maxUploadMb: Math.round(config.maxUploadBytes / (1024 * 1024)),
    });
  });

  router.post("/vault/init", authLimiter, (req, res) => {
    const body = z
      .object({ passphrase: z.string().min(10).max(200) })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Passphrase must be between 10 and 200 characters." });
      return;
    }
    if (isVaultInitialized()) {
      res.status(409).json({ error: "Vault is already initialized." });
      return;
    }
    initializeVault(body.data.passphrase);
    setSessionCookie(res);
    res.json({ ok: true });
  });

  router.post("/vault/unlock", authLimiter, (req, res) => {
    const body = z.object({ passphrase: z.string().min(1).max(200) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Passphrase is required." });
      return;
    }
    if (!isVaultInitialized()) {
      res.status(400).json({ error: "Vault is not initialized yet." });
      return;
    }
    const ok = unlockVault(body.data.passphrase);
    if (!ok) {
      res.status(401).json({ error: "Invalid vault passphrase." });
      return;
    }
    setSessionCookie(res);

    // Trigger any founder room submissions that arrived while vault was locked
    const pending = listPendingUnlockCallIds();
    for (const callId of pending) {
      void processCallPipeline(callId);
    }

    res.json({ ok: true, resumedCalls: pending.length });
  });

  router.post("/vault/lock", (_req, res) => {
    lockVault();
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  // --- SSE live updates ---
  router.get("/events", requireInvestorAuth, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const unregister = registerSseClient(res);
    const keepalive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 20000);

    req.on("close", () => {
      clearInterval(keepalive);
      unregister();
    });
  });

  // --- Thesis profiles (zero hardcoded thesis) ---
  router.get("/thesis", requireInvestorAuth, (_req, res) => {
    res.json({ profiles: listThesisProfiles() });
  });

  router.post("/thesis", requireInvestorAuth, (req, res) => {
    try {
      const profile = saveThesisProfile(req.body);
      res.json({ profile });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Invalid thesis profile payload.",
      });
    }
  });

  router.delete("/thesis/:id", requireInvestorAuth, (req, res) => {
    const deleted = deleteThesisProfile(String(req.params.id));
    res.json({ deleted });
  });

  // --- Calls & Partner Reviews ---
  router.get("/calls", requireInvestorAuth, (_req, res) => {
    res.json({ calls: listCalls() });
  });

  router.get("/calls/:id", requireInvestorAuth, (req, res) => {
    const call = getCall(String(req.params.id));
    if (!call) {
      res.status(404).json({ error: "Call not found." });
      return;
    }
    res.json({ call });
  });

  router.get("/calls/:id/audio", requireInvestorAuth, (req, res) => {
    const audio = readDecryptedAudioForCall(String(req.params.id));
    if (!audio) {
      res.status(404).json({ error: "No audio stored for this call." });
      return;
    }
    res.setHeader("Content-Type", audio.mimeType);
    res.setHeader("Content-Length", String(audio.buffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.send(audio.buffer);
  });

  router.delete("/calls/:id", requireInvestorAuth, (req, res) => {
    const deleted = deleteCall(String(req.params.id));
    res.json({ deleted });
  });

  router.post("/calls/:id/reanalyze", requireInvestorAuth, (req, res) => {
    const id = String(req.params.id);
    const call = getCall(id);
    if (!call) {
      res.status(404).json({ error: "Call not found." });
      return;
    }
    void processCallPipeline(id);
    res.json({ ok: true });
  });

  router.post("/calls/:id/retranscribe", requireInvestorAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const transcript = await retranscribeExistingCall(id);
      res.json({ transcript });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Re-transcription failed.",
      });
    }
  });

  router.patch("/calls/:id/transcript", requireInvestorAuth, (req, res) => {
    const id = String(req.params.id);
    const call = getCall(id);
    if (!call) {
      res.status(404).json({ error: "Call not found." });
      return;
    }
    const parsed = z
      .object({
        segments: z
          .array(
            z.object({
              id: z.string().min(1).max(60),
              speaker: z.string().min(1).max(80),
              role: z.enum(["investor", "founder", "other"]),
              startSec: z.number().nonnegative(),
              endSec: z.number().nonnegative(),
              text: z.string().min(1).max(20000),
            })
          )
          .min(1)
          .max(2000),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid transcript segments payload." });
      return;
    }
    updateCallTranscript(id, parsed.data.segments);
    res.json({ ok: true });
  });

  router.post(
    "/calls/transcribe-preview",
    requireInvestorAuth,
    upload.single("audio"),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "Audio recording is required." });
          return;
        }
        const mime = cleanMime(req.file.mimetype);
        if (!ALLOWED_AUDIO_MIMES.has(mime)) {
          res.status(400).json({ error: `Unsupported media type: ${mime}` });
          return;
        }
        const hint =
          typeof req.body?.contextHint === "string"
            ? req.body.contextHint.slice(0, 300)
            : undefined;
        const transcriptText = await transcribeAudioBufferToText(
          req.file.buffer,
          mime,
          hint
        );
        res.json({ transcriptText });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Transcription failed.",
        });
      }
    }
  );

  router.post("/calls/:id/calibrate", requireInvestorAuth, (req, res) => {
    const id = String(req.params.id);
    const parsed = z
      .object({
        critiqueId: z.string().min(1).max(100),
        verdict: z.enum(["fair_hit", "knew_from_deck", "off_base"]),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid calibration payload." });
      return;
    }
    setCalibration(id, parsed.data.critiqueId, parsed.data.verdict);
    res.json({ ok: true });
  });

  router.get("/ledger", requireInvestorAuth, (_req, res) => {
    res.json(computeBlindspotLedger());
  });

  // --- Upload / Live Capture / Transcript Ingestion ---
  router.post(
    "/calls/ingest",
    requireInvestorAuth,
    upload.fields([
      { name: "audio", maxCount: 1 },
      { name: "deck", maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const metadataRaw = typeof req.body.metadata === "string" ? JSON.parse(req.body.metadata) : req.body;
        const parsedMeta = z
          .object({
            sourceType: z.enum(["upload", "live_capture", "transcript"]).default("upload"),
            companyName: z.string().min(1).max(160),
            founderNames: z.array(z.string().min(1).max(100)).default([]),
            stage: z.string().min(1).max(80),
            objective: CallObjectiveSchema,
            thesisProfileId: z.string().nullable().default(null),
            preCallHypotheses: z.string().max(5000).default(""),
            deckNotes: z.string().max(20000).default(""),
            investorSpeakerLabel: z.string().min(1).max(80).default("Investor"),
            transcriptText: z.string().max(250000).optional(),
          })
          .parse(metadataRaw);

        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const audioFile = files?.audio?.[0];
        const deckFile = files?.deck?.[0];

        if (!audioFile && !parsedMeta.transcriptText?.trim()) {
          res.status(400).json({ error: "Provide either an audio/video recording or a call transcript." });
          return;
        }

        if (audioFile) {
          const mime = cleanMime(audioFile.mimetype);
          if (!ALLOWED_AUDIO_MIMES.has(mime)) {
            res.status(400).json({ error: `Unsupported audio/video MIME type: ${mime}` });
            return;
          }
        }

        let deckSummary = parsedMeta.deckNotes.trim();
        let deckFileName: string | undefined;
        if (deckFile) {
          const deckMime = cleanMime(deckFile.mimetype);
          if (!ALLOWED_DECK_MIMES.has(deckMime)) {
            res.status(400).json({ error: `Unsupported deck file type: ${deckMime}` });
            return;
          }
          deckFileName = deckFile.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
          const extracted = await extractDeckSummary(deckFile.buffer, deckMime, deckFileName);
          deckSummary = [deckSummary, extracted].filter(Boolean).join("\n\n");
        }

        const profiles = listThesisProfiles();
        const chosenProfile = parsedMeta.thesisProfileId
          ? profiles.find((p) => p.id === parsedMeta.thesisProfileId) ?? null
          : null;

        const { id } = createCallRecord({
          sourceType: parsedMeta.sourceType,
          status: "queued",
          meta: {
            companyName: parsedMeta.companyName,
            founderNames: parsedMeta.founderNames,
            stage: parsedMeta.stage,
            objective: parsedMeta.objective,
            thesisProfileId: chosenProfile?.id ?? null,
            thesisSnapshot: chosenProfile
              ? {
                  id: chosenProfile.id,
                  name: chosenProfile.name,
                  stageFocus: chosenProfile.stageFocus,
                  sectorFocus: chosenProfile.sectorFocus,
                  targetInvestorTalkRatioMax: chosenProfile.targetInvestorTalkRatioMax,
                  coreRisksToProbe: chosenProfile.coreRisksToProbe,
                  customBiasesToWatch: chosenProfile.customBiasesToWatch,
                  strictness: chosenProfile.strictness,
                }
              : null,
            preCallHypotheses: parsedMeta.preCallHypotheses,
            deckSummary,
            deckFileName,
            investorSpeakerLabel: parsedMeta.investorSpeakerLabel,
          },
          transcript: parsedMeta.transcriptText?.trim()
            ? [
                {
                  id: "raw-input",
                  speaker: "Raw Transcript",
                  role: "other",
                  startSec: 0,
                  endSec: 0,
                  text: parsedMeta.transcriptText.trim(),
                },
              ]
            : null,
        });

        if (audioFile) {
          storeEncryptedAudioForCall(id, audioFile.buffer, cleanMime(audioFile.mimetype), false);
        }

        broadcastVaultEvent({ callId: id, type: "call.updated", stage: "queued" });
        void processCallPipeline(id);

        res.json({ id, status: "queued" });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to ingest call.",
        });
      }
    }
  );

  // --- Hosted Consent Pitch Room ---
  router.post(
    "/rooms",
    requireInvestorAuth,
    upload.single("deck"),
    async (req, res) => {
      try {
        const raw = typeof req.body.metadata === "string" ? JSON.parse(req.body.metadata) : req.body;
        const parsed = z
          .object({
            companyName: z.string().min(1).max(160),
            founderNames: z.array(z.string().min(1).max(100)).default([]),
            stage: z.string().min(1).max(80),
            objective: CallObjectiveSchema,
            thesisProfileId: z.string().nullable().default(null),
            preCallHypotheses: z.string().max(5000).default(""),
            deckNotes: z.string().max(20000).default(""),
            promptForFounder: z
              .string()
              .max(1000)
              .default("Walk us through what you are building, why now, and what surprised you most from customers."),
            investorSpeakerLabel: z.string().min(1).max(80).default("Investor"),
          })
          .parse(raw);

        let deckSummary = parsed.deckNotes.trim();
        let deckFileName: string | undefined;
        if (req.file) {
          const deckMime = cleanMime(req.file.mimetype);
          if (!ALLOWED_DECK_MIMES.has(deckMime)) {
            res.status(400).json({ error: `Unsupported deck type: ${deckMime}` });
            return;
          }
          deckFileName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
          const extracted = await extractDeckSummary(req.file.buffer, deckMime, deckFileName);
          deckSummary = [deckSummary, extracted].filter(Boolean).join("\n\n");
        }

        const profiles = listThesisProfiles();
        const chosenProfile = parsed.thesisProfileId
          ? profiles.find((p) => p.id === parsed.thesisProfileId) ?? null
          : null;

        const expiresAt = new Date(Date.now() + config.roomTokenTtlMs).toISOString();

        const { id } = createCallRecord({
          sourceType: "pitch_room",
          status: "awaiting_founder",
          roomStatus: "invited",
          meta: {
            companyName: parsed.companyName,
            founderNames: parsed.founderNames,
            stage: parsed.stage,
            objective: parsed.objective,
            thesisProfileId: chosenProfile?.id ?? null,
            thesisSnapshot: chosenProfile
              ? {
                  id: chosenProfile.id,
                  name: chosenProfile.name,
                  stageFocus: chosenProfile.stageFocus,
                  sectorFocus: chosenProfile.sectorFocus,
                  targetInvestorTalkRatioMax: chosenProfile.targetInvestorTalkRatioMax,
                  coreRisksToProbe: chosenProfile.coreRisksToProbe,
                  customBiasesToWatch: chosenProfile.customBiasesToWatch,
                  strictness: chosenProfile.strictness,
                }
              : null,
            preCallHypotheses: parsed.preCallHypotheses,
            deckSummary,
            deckFileName,
            investorSpeakerLabel: parsed.investorSpeakerLabel,
          },
          roomPublic: {
            companyName: parsed.companyName,
            objective: parsed.objective,
            promptForFounder: parsed.promptForFounder,
            consentText:
              "I consent to recording this pitch/conversation for private investment diligence and internal review. Audio is encrypted immediately on submission.",
            expiresAt,
          },
        });

        const roomToken = signToken(
          {
            roomId: id,
            scope: "founder_room",
            nonce: crypto.randomBytes(12).toString("hex"),
            exp: Date.now() + config.roomTokenTtlMs,
          },
          config.roomTokenSecret
        );

        const roomUrl = `${config.publicBaseUrl}/room/${id}?token=${encodeURIComponent(roomToken)}`;
        broadcastVaultEvent({ callId: id, type: "call.updated", stage: "awaiting_founder" });

        res.json({ id, roomUrl, expiresAt });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to create pitch room.",
        });
      }
    }
  );

  router.get("/rooms/:roomId/public", roomLimiter, (req, res) => {
    const roomId = String(req.params.roomId);
    if (!verifyRoomToken(roomId, req.query.token)) {
      res.status(403).json({ error: "Invalid or expired Pitch Room link." });
      return;
    }
    const info = getRoomPublicInfo(roomId);
    if (!info) {
      res.status(404).json({ error: "Pitch Room not found." });
      return;
    }
    res.json(info);
  });

  router.post("/rooms/:roomId/presence", roomLimiter, (req, res) => {
    const roomId = String(req.params.roomId);
    const parsed = z
      .object({
        token: z.string().min(1),
        state: z.enum(["joined", "recording", "paused"]),
      })
      .safeParse(req.body);
    if (!parsed.success || !verifyRoomToken(roomId, parsed.data.token)) {
      res.status(403).json({ error: "Invalid or expired Pitch Room token." });
      return;
    }
    updateCallStatus(roomId, { roomStatus: parsed.data.state });
    const eventType =
      parsed.data.state === "recording" ? "room.recording" : "room.founder_joined";
    broadcastVaultEvent({ callId: roomId, type: eventType, stage: parsed.data.state });
    res.json({ ok: true });
  });

  router.post(
    "/rooms/:roomId/transcribe",
    roomLimiter,
    upload.single("audio"),
    async (req, res) => {
      try {
        const roomId = String(req.params.roomId);
        const token = req.body?.token ?? req.query.token;
        if (!verifyRoomToken(roomId, token)) {
          res.status(403).json({ error: "Invalid or expired Pitch Room token." });
          return;
        }
        if (req.body?.consentAccepted !== "true") {
          res.status(400).json({ error: "Explicit recording consent is required." });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: "Audio recording is required." });
          return;
        }
        const mime = cleanMime(req.file.mimetype);
        if (!ALLOWED_AUDIO_MIMES.has(mime)) {
          res.status(400).json({ error: `Unsupported media type: ${mime}` });
          return;
        }
        const info = getRoomPublicInfo(roomId);
        if (!info) {
          res.status(404).json({ error: "Pitch Room not found." });
          return;
        }
        const transcriptText = await transcribeAudioBufferToText(
          req.file.buffer,
          mime,
          `Founder pitch for "${info.publicMeta.companyName}".`
        );
        res.json({ transcriptText });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Transcription failed.",
        });
      }
    }
  );

  router.post(
    "/rooms/:roomId/submit",
    roomLimiter,
    upload.single("audio"),
    (req, res) => {
      const roomId = String(req.params.roomId);
      const token = req.body?.token ?? req.query.token;
      if (!verifyRoomToken(roomId, token)) {
        res.status(403).json({ error: "Invalid or expired Pitch Room token." });
        return;
      }
      if (req.body?.consentAccepted !== "true") {
        res.status(400).json({ error: "Explicit recording consent is required." });
        return;
      }
      const editedText =
        typeof req.body?.transcriptText === "string"
          ? req.body.transcriptText.trim().slice(0, 250000)
          : "";

      if (!req.file && !editedText) {
        res.status(400).json({ error: "Provide an audio recording or confirmed transcript text." });
        return;
      }

      if (req.file) {
        const mime = cleanMime(req.file.mimetype);
        if (!ALLOWED_AUDIO_MIMES.has(mime)) {
          res.status(400).json({ error: `Unsupported media type: ${mime}` });
          return;
        }
        storeEncryptedAudioForCall(roomId, req.file.buffer, mime, true);
      }

      if (editedText) {
        storeRoomPendingTranscript(roomId, editedText);
      }

      if (isVaultUnlocked()) {
        updateCallStatus(roomId, { roomStatus: "submitted", status: "queued" });
        broadcastVaultEvent({ callId: roomId, type: "room.submitted", stage: "queued" });
        void processCallPipeline(roomId);
      } else {
        updateCallStatus(roomId, { roomStatus: "submitted", status: "pending_unlock" });
        broadcastVaultEvent({ callId: roomId, type: "room.submitted", stage: "pending_unlock" });
      }

      res.json({ ok: true, submitted: true });
    }
  );

  return router;
}

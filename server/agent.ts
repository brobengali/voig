import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config } from "./config.js";
import { broadcastVaultEvent } from "./events.js";
import {
  CallAnalysis,
  CallMeta,
  ExtractedClaim,
  TranscriptSegment,
} from "./types.js";
import {
  getCall,
  isVaultUnlocked,
  readDecryptedAudioForCall,
  saveCallResults,
  updateCallStatus,
} from "./vault.js";

function getClient(): GoogleGenAI {
  if (!config.geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured in .env. Add your key and restart the server."
    );
  }
  return new GoogleGenAI({ apiKey: config.geminiApiKey });
}

async function runStructuredInteraction<T>(params: {
  model: string;
  systemInstruction: string;
  input:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "document"; data: string; mime_type: string }
      >;
  schema: Record<string, unknown>;
  validator: z.ZodType<T>;
}): Promise<T> {
  const ai = getClient();
  const interaction = await ai.interactions.create({
    model: params.model,
    system_instruction: params.systemInstruction,
    input: params.input,
    store: false,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: params.schema,
    },
  });

  const text = interaction.output_text;
  if (!text) {
    throw new Error(`Model ${params.model} returned empty structured output.`);
  }
  const parsed = JSON.parse(text);
  return params.validator.parse(parsed);
}

export async function extractDeckSummary(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return buffer.toString("utf8").slice(0, 18000);
  }

  if (!config.geminiApiKey) {
    return `[Deck attached: ${fileName} — configure GEMINI_API_KEY to extract slide claims]`;
  }

  const ai = getClient();
  const interaction = await ai.interactions.create({
    model: config.models.critic,
    system_instruction:
      "You are an investment diligence analyst. Extract a dense, factual summary of the pitch deck: problem, product, traction/metrics, business model, GTM, team, fundraising ask, and explicit gaps or missing proof points. Do not invent numbers.",
    input: [
      {
        type: "document",
        data: buffer.toString("base64"),
        mime_type: mimeType,
      },
      {
        type: "text",
        text: `Summarize the key claims, hard metrics, and omissions in "${fileName}" in <= 500 words so an investor call critic knows what was already stated in the deck.`,
      },
    ],
    store: false,
  });

  return interaction.output_text?.trim() || `[Deck ${fileName} processed]`;
}

const TranscriptSegmentsSchema = z.object({
  estimatedDurationSec: z.number().nonnegative(),
  segments: z.array(
    z.object({
      id: z.string(),
      speaker: z.string(),
      role: z.enum(["investor", "founder", "other"]),
      startSec: z.number().nonnegative(),
      endSec: z.number().nonnegative(),
      text: z.string(),
    })
  ),
});

const TRANSCRIPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    estimatedDurationSec: { type: "number" },
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          speaker: { type: "string" },
          role: { type: "string", enum: ["investor", "founder", "other"] },
          startSec: { type: "number" },
          endSec: { type: "number" },
          text: { type: "string" },
        },
        required: ["id", "speaker", "role", "startSec", "endSec", "text"],
      },
    },
  },
  required: ["estimatedDurationSec", "segments"],
};

export async function transcribeAudioBufferToText(
  audioBuffer: Buffer,
  mimeType: string,
  contextHint?: string
): Promise<string> {
  const ai = getClient();
  const ext = mimeType.includes("mp4")
    ? "mp4"
    : mimeType.includes("wav")
      ? "wav"
      : mimeType.includes("mpeg") || mimeType.includes("mp3")
        ? "mp3"
        : mimeType.includes("ogg")
          ? "ogg"
          : "webm";

  const tempPath = path.join(
    config.vaultDataDir,
    `tmp_${crypto.randomUUID()}.${ext}`
  );
  fs.writeFileSync(tempPath, audioBuffer);

  let uploadedName: string | undefined;
  try {
    const uploaded = await ai.files.upload({
      file: tempPath,
      config: { mimeType },
    });
    uploadedName = uploaded.name;

    let activeFile = uploaded;
    for (let attempt = 0; attempt < 20 && activeFile.state === "PROCESSING"; attempt++) {
      await new Promise((r) => setTimeout(r, 1500));
      if (uploaded.name) {
        activeFile = await ai.files.get({ name: uploaded.name });
      }
    }

    const prompt = contextHint
      ? `Transcribe this audio faithfully with speaker labels and [MM:SS] timestamps. Context: ${contextHint}`
      : "Transcribe this audio faithfully with speaker labels and [MM:SS] timestamps.";

    let rawTranscript = "";
    try {
      const transcribeResp = await ai.models.generateContent({
        model: config.models.transcribe,
        contents: [activeFile, prompt],
      });
      rawTranscript = transcribeResp.text?.trim() || "";
    } catch {
      const fallbackResp = await ai.models.generateContent({
        model: config.models.critic,
        contents: [activeFile, prompt],
      });
      rawTranscript = fallbackResp.text?.trim() || "";
    }

    if (!rawTranscript) {
      throw new Error("Audio transcription returned empty text.");
    }
    return rawTranscript;
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore cleanup errors
    }
    if (uploadedName) {
      try {
        await ai.files.delete({ name: uploadedName });
      } catch {
        // ignore delete errors
      }
    }
  }
}

async function transcribeAndDiarizeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  meta: CallMeta
): Promise<{ segments: TranscriptSegment[]; durationSeconds: number }> {
  const hint = `Company "${meta.companyName}", Investor speaker "${meta.investorSpeakerLabel}", Founder(s) ${meta.founderNames.join(", ") || "unknown"}.`;
  const rawTranscript = await transcribeAudioBufferToText(audioBuffer, mimeType, hint);
  const structured = await structureTranscriptText(rawTranscript, meta);
  return {
    segments: structured.segments,
    durationSeconds: structured.estimatedDurationSec,
  };
}

export async function retranscribeExistingCall(callId: string): Promise<TranscriptSegment[]> {
  const call = getCall(callId);
  if (!call) throw new Error("Call not found.");
  const audio = readDecryptedAudioForCall(callId);
  if (!audio) throw new Error("No encrypted audio recording exists for this call.");
  const { segments, durationSeconds } = await transcribeAndDiarizeAudio(
    audio.buffer,
    audio.mimeType,
    call.meta
  );
  saveCallResults(callId, { transcript: segments, durationSeconds });
  return segments;
}

async function structureTranscriptText(
  rawText: string,
  meta: CallMeta
): Promise<z.infer<typeof TranscriptSegmentsSchema>> {
  const result = await runStructuredInteraction({
    model: config.models.critic,
    systemInstruction:
      "Convert the provided call transcript into clean, ordered speaker turns with accurate role attribution ('investor' vs 'founder' vs 'other') and monotonically increasing timestamps in seconds. Preserve exact spoken wording without paraphrasing.",
    input: `Investor label: ${meta.investorSpeakerLabel}
Company: ${meta.companyName}
Founder names: ${meta.founderNames.join(", ") || "Founder"}

RAW TRANSCRIPT:
${rawText}`,
    schema: TRANSCRIPT_JSON_SCHEMA,
    validator: TranscriptSegmentsSchema,
  });

  const normalized = result.segments.map((seg, idx) => ({
    ...seg,
    id: seg.id || `seg-${idx + 1}`,
  }));

  return {
    estimatedDurationSec:
      result.estimatedDurationSec ||
      (normalized.length > 0 ? normalized[normalized.length - 1].endSec : 0),
    segments: normalized,
  };
}

// --- Stage 2: Claims & Conversational Dynamics Extraction ---
const ExtractionSchema = z.object({
  dynamics: z.object({
    investorTalkPct: z.number().min(0).max(100),
    founderTalkPct: z.number().min(0).max(100),
    investorQuestionCount: z.number().int().nonnegative(),
    openEndedQuestionPct: z.number().min(0).max(100),
    followupDepthScore: z.number().min(0).max(10),
    interruptionCount: z.number().int().nonnegative(),
    coFounderBalanceNote: z.string(),
  }),
  extractedClaims: z.array(
    z.object({
      id: z.string(),
      claim: z.string(),
      speaker: z.string(),
      timestampSec: z.number().nonnegative(),
      evidenceLevel: z.enum([
        "hard_metric",
        "anecdotal",
        "assertion_only",
        "deflected",
      ]),
      followedUpByInvestor: z.boolean(),
    })
  ),
});

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    dynamics: {
      type: "object",
      properties: {
        investorTalkPct: { type: "number" },
        founderTalkPct: { type: "number" },
        investorQuestionCount: { type: "integer" },
        openEndedQuestionPct: { type: "number" },
        followupDepthScore: { type: "number" },
        interruptionCount: { type: "integer" },
        coFounderBalanceNote: { type: "string" },
      },
      required: [
        "investorTalkPct",
        "founderTalkPct",
        "investorQuestionCount",
        "openEndedQuestionPct",
        "followupDepthScore",
        "interruptionCount",
        "coFounderBalanceNote",
      ],
    },
    extractedClaims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          claim: { type: "string" },
          speaker: { type: "string" },
          timestampSec: { type: "number" },
          evidenceLevel: {
            type: "string",
            enum: ["hard_metric", "anecdotal", "assertion_only", "deflected"],
          },
          followedUpByInvestor: { type: "boolean" },
        },
        required: [
          "id",
          "claim",
          "speaker",
          "timestampSec",
          "evidenceLevel",
          "followedUpByInvestor",
        ],
      },
    },
  },
  required: ["dynamics", "extractedClaims"],
};

// --- Stage 3: Parallel Critic Pass Schema ---
const CriticPassSchema = z.object({
  findings: z.array(
    z.object({
      id: z.string(),
      category: z.enum([
        "confirmation_bias",
        "leading_question",
        "halo_effect",
        "premature_selling",
        "unchallenged_claim",
        "missed_followup",
        "hypothetical_trap",
        "talk_dominance",
        "strong_probe",
      ]),
      severity: z.enum(["critical", "notable", "strength"]),
      title: z.string(),
      timestampSec: z.number().nonnegative(),
      segmentId: z.string(),
      verbatimQuote: z.string(),
      diagnosis: z.string(),
      counterfactualQuestion: z.string(),
      principle: z.string(),
    })
  ),
  missedTopics: z.array(
    z.object({
      topic: z.string(),
      whyItMattersNow: z.string(),
      suggestedQuestion: z.string(),
    })
  ),
});

const CRITIC_PASS_JSON_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: [
              "confirmation_bias",
              "leading_question",
              "halo_effect",
              "premature_selling",
              "unchallenged_claim",
              "missed_followup",
              "hypothetical_trap",
              "talk_dominance",
              "strong_probe",
            ],
          },
          severity: { type: "string", enum: ["critical", "notable", "strength"] },
          title: { type: "string" },
          timestampSec: { type: "number" },
          segmentId: { type: "string" },
          verbatimQuote: { type: "string" },
          diagnosis: { type: "string" },
          counterfactualQuestion: { type: "string" },
          principle: { type: "string" },
        },
        required: [
          "id",
          "category",
          "severity",
          "title",
          "timestampSec",
          "segmentId",
          "verbatimQuote",
          "diagnosis",
          "counterfactualQuestion",
          "principle",
        ],
      },
    },
    missedTopics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          whyItMattersNow: { type: "string" },
          suggestedQuestion: { type: "string" },
        },
        required: ["topic", "whyItMattersNow", "suggestedQuestion"],
      },
    },
  },
  required: ["findings", "missedTopics"],
};

// --- Stage 4: Senior Partner Synthesis Schema ---
const SynthesisSchema = z.object({
  headlineVerdict: z.string(),
  partnerBrief: z.string(),
  overallDisciplineScore: z.number().min(0).max(100),
  biasRiskLevel: z.enum(["low", "moderate", "elevated", "high"]),
  critiques: CriticPassSchema.shape.findings,
  missedQuestions: CriticPassSchema.shape.missedTopics,
});

const SYNTHESIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    headlineVerdict: { type: "string" },
    partnerBrief: { type: "string" },
    overallDisciplineScore: { type: "number" },
    biasRiskLevel: { type: "string", enum: ["low", "moderate", "elevated", "high"] },
    critiques: CRITIC_PASS_JSON_SCHEMA.properties.findings,
    missedQuestions: CRITIC_PASS_JSON_SCHEMA.properties.missedTopics,
  },
  required: [
    "headlineVerdict",
    "partnerBrief",
    "overallDisciplineScore",
    "biasRiskLevel",
    "critiques",
    "missedQuestions",
  ],
};

function formatTranscriptForPrompt(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (s) =>
        `[${s.id} | ${Math.round(s.startSec)}s–${Math.round(s.endSec)}s | ${s.role.toUpperCase()} (${s.speaker})]: ${s.text}`
    )
    .join("\n");
}

function buildContextHeader(meta: CallMeta): string {
  const thesis = meta.thesisSnapshot;
  return `COMPANY: ${meta.companyName}
STAGE: ${meta.stage}
CALL OBJECTIVE: ${meta.objective}
FOUNDERS: ${meta.founderNames.join(", ") || "Unspecified"}
INVESTOR LABEL: ${meta.investorSpeakerLabel}
PRE-CALL HYPOTHESES / PRIORS:
${meta.preCallHypotheses || "None recorded"}

DECK / WRITTEN CONTEXT ALREADY KNOWN BEFORE CALL:
${meta.deckSummary || "No deck provided"}

CUSTOM THESIS RUBRIC:
${
  thesis
    ? `Profile: ${thesis.name} (${thesis.stageFocus} / ${thesis.sectorFocus})
Max Investor Talk Target: ${thesis.targetInvestorTalkRatioMax}%
Strictness: ${thesis.strictness}
Core Risks To Probe: ${thesis.coreRisksToProbe.join("; ")}
Custom Biases To Watch: ${thesis.customBiasesToWatch.join("; ")}`
    : "No custom thesis profile attached; evaluate using rigorous venture diligence standards calibrated to stage and objective."
}`;
}

export async function processCallPipeline(callId: string): Promise<void> {
  if (!isVaultUnlocked()) {
    updateCallStatus(callId, { status: "pending_unlock" });
    return;
  }

  const call = getCall(callId);
  if (!call) return;

  try {
    let segments: TranscriptSegment[] = call.transcript ?? [];
    let durationSeconds = call.meta.durationSeconds ?? 0;

    // Stage 1: Transcribe or structure transcript
    const needsTranscription =
      segments.length === 0 ||
      (segments.length === 1 && segments[0].id === "raw-input");

    if (needsTranscription) {
      updateCallStatus(callId, { status: "transcribing" });
      broadcastVaultEvent({
        callId,
        type: "call.progress",
        stage: "transcribing",
        message: "Diarizing speakers and grounding timestamps…",
      });

      if (call.hasAudio && segments.length === 0) {
        const audio = readDecryptedAudioForCall(callId);
        if (!audio) {
          throw new Error("Encrypted audio blob not found.");
        }
        const transcribed = await transcribeAndDiarizeAudio(
          audio.buffer,
          audio.mimeType,
          call.meta
        );
        segments = transcribed.segments;
        durationSeconds = transcribed.durationSeconds;
      } else if (segments.length === 1 && segments[0].id === "raw-input") {
        const structured = await structureTranscriptText(
          segments[0].text,
          call.meta
        );
        segments = structured.segments;
        durationSeconds = structured.estimatedDurationSec;
      }

      saveCallResults(callId, {
        transcript: segments,
        durationSeconds,
        status: "extracting",
      });
    }

    const formattedTranscript = formatTranscriptForPrompt(segments);
    const contextHeader = buildContextHeader(call.meta);

    // Stage 2: Extract claims and conversational dynamics
    updateCallStatus(callId, { status: "extracting" });
    broadcastVaultEvent({
      callId,
      type: "call.progress",
      stage: "extracting",
      message: "Mapping founder claims, evidence quality, and talk dynamics…",
    });

    const extraction = await runStructuredInteraction({
      model: config.models.critic,
      systemInstruction:
        "You are an analytical venture diligence extractor. Measure speaker talk percentages, question counts, open-ended vs closed questions, interruption patterns, and list every substantive founder claim with whether it had hard metrics, anecdotes, pure assertion, or deflection, and whether the investor followed up.",
      input: `${contextHeader}\n\nDIARIZED TRANSCRIPT:\n${formattedTranscript}`,
      schema: EXTRACTION_JSON_SCHEMA,
      validator: ExtractionSchema,
    });

    // Stage 3: Two parallel specialized partner critics
    updateCallStatus(callId, { status: "critiquing" });
    broadcastVaultEvent({
      callId,
      type: "call.progress",
      stage: "critiquing",
      message: "Running Cognitive Bias & Diligence Critics in parallel…",
    });

    const claimsText = extraction.extractedClaims
      .map(
        (c: ExtractedClaim) =>
          `- [${c.id} @ ${Math.round(c.timestampSec)}s] (${c.evidenceLevel}, followedUp=${c.followedUpByInvestor}): ${c.claim}`
      )
      .join("\n");

    const [biasPass, diligencePass] = await Promise.all([
      runStructuredInteraction({
        model: config.models.critic,
        systemInstruction: `You are an unsparing Managing Partner reviewing a co-investor's founder call strictly for COGNITIVE BIASES and QUESTION FRAMING.
Rules:
- Never flatter or pad with generic praise.
- Only include a 'strength' item if the investor asked a genuinely sharp, non-obvious disconfirming probe worth repeating.
- Every finding MUST reference an exact segmentId and verbatimQuote from the transcript, and provide a concrete counterfactualQuestion.
- Watch specifically for: confirmation bias, leading questions, halo/pedigree deference, premature selling mode before risk validation, hypothetical traps ("would customers pay?"), and talk dominance.`,
        input: `${contextHeader}\n\nDYNAMICS:\n${JSON.stringify(extraction.dynamics)}\n\nTRANSCRIPT:\n${formattedTranscript}`,
        schema: CRITIC_PASS_JSON_SCHEMA,
        validator: CriticPassSchema,
      }),
      runStructuredInteraction({
        model: config.models.critic,
        systemInstruction: `You are an unsparing Managing Partner reviewing a co-investor's founder call strictly for DILIGENCE RIGOR and MISSING SIGNAL.
Rules:
- Cross-check what was ALREADY in the Deck/Pre-call context so you NEVER penalize the investor for skipping facts already known from the deck.
- Calibrate expectations to the Call Objective (${call.meta.objective}) and Stage (${call.meta.stage}). Don't demand a full Series B data-room audit on a 25-minute first intro call; focus on the highest-leverage unchallenged assertions and missing stage-critical probes.
- Every finding MUST cite an exact segmentId and verbatimQuote, plus a sharp counterfactualQuestion.`,
        input: `${contextHeader}\n\nEXTRACTED CLAIMS:\n${claimsText}\n\nTRANSCRIPT:\n${formattedTranscript}`,
        schema: CRITIC_PASS_JSON_SCHEMA,
        validator: CriticPassSchema,
      }),
    ]);

    // Stage 4: Senior Partner Synthesis & Red-Pen Prioritization
    updateCallStatus(callId, { status: "synthesizing" });
    broadcastVaultEvent({
      callId,
      type: "call.progress",
      stage: "synthesizing",
      message: "Synthesizing Red-Pen Partner Memo and ranking top moments…",
    });

    const synthesis = await runStructuredInteraction({
      model: config.models.synthesis,
      systemInstruction: `You are the Senior Investment Partner writing the final "Red-Pen Partner Review" memo.
Your job is to eliminate noise and nitpicks:
- Deduplicate findings from the Bias Critic and Diligence Critic.
- Keep ONLY the 4 to 7 highest-leverage moments (including at most 1–2 genuine 'strength' moments if earned).
- Ensure every segmentId and timestampSec matches the transcript accurately, and every counterfactualQuestion sounds like a real, incisive top-decile VC speaking to a founder.
- Write a crisp 1-sentence headlineVerdict and a candid 2–3 sentence partnerBrief.
- List the 3–5 highest-value missedQuestions given the call objective and deck context.`,
      input: `${contextHeader}

DYNAMICS:
${JSON.stringify(extraction.dynamics)}

BIAS CRITIC FINDINGS:
${JSON.stringify(biasPass)}

DILIGENCE CRITIC FINDINGS:
${JSON.stringify(diligencePass)}

VALID SEGMENT IDS FOR REFERENCE:
${segments.map((s) => `${s.id} (${Math.round(s.startSec)}s, ${s.role})`).join(", ")}`,
      schema: SYNTHESIS_JSON_SCHEMA,
      validator: SynthesisSchema,
    });

    const segmentIds = new Set(segments.map((s) => s.id));
    const cleanedCritiques = synthesis.critiques.map((c, idx) => ({
      ...c,
      id: c.id || `crit-${idx + 1}`,
      segmentId: segmentIds.has(c.segmentId)
        ? c.segmentId
        : segments[0]?.id || "seg-1",
    }));

    const analysis: CallAnalysis = {
      headlineVerdict: synthesis.headlineVerdict,
      partnerBrief: synthesis.partnerBrief,
      overallDisciplineScore: Math.round(synthesis.overallDisciplineScore),
      biasRiskLevel: synthesis.biasRiskLevel,
      dynamics: extraction.dynamics,
      extractedClaims: extraction.extractedClaims,
      missedQuestions: synthesis.missedQuestions,
      critiques: cleanedCritiques,
      analyzedAt: new Date().toISOString(),
      modelsUsed: {
        transcribe: config.models.transcribe,
        critic: config.models.critic,
        synthesis: config.models.synthesis,
      },
    };

    saveCallResults(callId, {
      transcript: segments,
      analysis,
      durationSeconds,
      status: "completed",
    });

    broadcastVaultEvent({
      callId,
      type: "call.updated",
      stage: "completed",
      message: "Partner Review ready.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pipeline failed unexpectedly.";
    updateCallStatus(callId, { status: "error", errorMessage: message });
    broadcastVaultEvent({
      callId,
      type: "call.updated",
      stage: "error",
      message,
    });
  }
}

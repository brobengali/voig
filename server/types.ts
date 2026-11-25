import { z } from "zod";

export const CallObjectiveSchema = z.enum([
  "first_intro",
  "deep_diligence",
  "partner_pitch",
  "founder_update",
]);

export type CallObjective = z.infer<typeof CallObjectiveSchema>;

export const ThesisProfileInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  stageFocus: z.string().min(1).max(80),
  sectorFocus: z.string().min(1).max(200),
  targetInvestorTalkRatioMax: z.number().min(10).max(80),
  coreRisksToProbe: z.array(z.string().min(1).max(300)).min(1).max(20),
  customBiasesToWatch: z.array(z.string().min(1).max(300)).min(1).max(20),
  strictness: z.enum(["calibrated", "unsparing", "supportive"]).default("unsparing"),
});

export type ThesisProfile = z.infer<typeof ThesisProfileInputSchema> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export interface CallMeta {
  companyName: string;
  founderNames: string[];
  stage: string;
  objective: CallObjective;
  thesisProfileId: string | null;
  thesisSnapshot: Omit<ThesisProfile, "createdAt" | "updatedAt"> | null;
  preCallHypotheses: string;
  deckSummary: string;
  deckFileName?: string;
  investorSpeakerLabel: string;
  durationSeconds?: number;
}

export interface RoomPublicMeta {
  companyName: string;
  objective: CallObjective;
  promptForFounder: string;
  consentText: string;
  expiresAt: string;
}

export interface TranscriptSegment {
  id: string;
  speaker: string;
  role: "investor" | "founder" | "other";
  startSec: number;
  endSec: number;
  text: string;
}

export interface ExtractedClaim {
  id: string;
  claim: string;
  speaker: string;
  timestampSec: number;
  evidenceLevel: "hard_metric" | "anecdotal" | "assertion_only" | "deflected";
  followedUpByInvestor: boolean;
}

export interface CritiqueItem {
  id: string;
  category:
    | "confirmation_bias"
    | "leading_question"
    | "halo_effect"
    | "premature_selling"
    | "unchallenged_claim"
    | "missed_followup"
    | "hypothetical_trap"
    | "talk_dominance"
    | "strong_probe";
  severity: "critical" | "notable" | "strength";
  title: string;
  timestampSec: number;
  segmentId: string;
  verbatimQuote: string;
  diagnosis: string;
  counterfactualQuestion: string;
  principle: string;
}

export interface DynamicsMetrics {
  investorTalkPct: number;
  founderTalkPct: number;
  investorQuestionCount: number;
  openEndedQuestionPct: number;
  followupDepthScore: number;
  interruptionCount: number;
  coFounderBalanceNote: string;
}

export interface CallAnalysis {
  headlineVerdict: string;
  partnerBrief: string;
  overallDisciplineScore: number;
  biasRiskLevel: "low" | "moderate" | "elevated" | "high";
  dynamics: DynamicsMetrics;
  extractedClaims: ExtractedClaim[];
  missedQuestions: Array<{
    topic: string;
    whyItMattersNow: string;
    suggestedQuestion: string;
  }>;
  critiques: CritiqueItem[];
  analyzedAt: string;
  modelsUsed: {
    transcribe: string;
    critic: string;
    synthesis: string;
  };
}

export interface CalibrationRecord {
  critiqueId: string;
  verdict: "fair_hit" | "knew_from_deck" | "off_base";
  createdAt: string;
}

export interface DecryptedCallRecord {
  id: string;
  status: string;
  sourceType: string;
  roomStatus: string;
  createdAt: string;
  updatedAt: string;
  meta: CallMeta;
  roomPublic: RoomPublicMeta | null;
  transcript: TranscriptSegment[] | null;
  analysis: CallAnalysis | null;
  hasAudio: boolean;
  audioMime: string | null;
  errorMessage: string | null;
  calibrations: Record<string, CalibrationRecord>;
}

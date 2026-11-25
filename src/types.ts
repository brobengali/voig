export type CallObjective =
  | "first_intro"
  | "deep_diligence"
  | "partner_pitch"
  | "founder_update";

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  authenticated: boolean;
  geminiConfigured: boolean;
  models: {
    transcribe: string;
    critic: string;
    synthesis: string;
  };
  maxUploadMb: number;
}

export interface ThesisProfile {
  id: string;
  name: string;
  stageFocus: string;
  sectorFocus: string;
  targetInvestorTalkRatioMax: number;
  coreRisksToProbe: string[];
  customBiasesToWatch: string[];
  strictness: "calibrated" | "unsparing" | "supportive";
  createdAt: string;
  updatedAt: string;
}

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

export interface CallAnalysis {
  headlineVerdict: string;
  partnerBrief: string;
  overallDisciplineScore: number;
  biasRiskLevel: "low" | "moderate" | "elevated" | "high";
  dynamics: {
    investorTalkPct: number;
    founderTalkPct: number;
    investorQuestionCount: number;
    openEndedQuestionPct: number;
    followupDepthScore: number;
    interruptionCount: number;
    coFounderBalanceNote: string;
  };
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

export interface CallRecord {
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

export interface BlindspotLedger {
  totalCallsAnalyzed: number;
  avgInvestorTalkPct: number;
  avgDisciplineScore: number;
  avgFollowupDepth: number;
  topBiases: Array<{ category: string; count: number; fairHits: number }>;
  recentTrend: Array<{
    callId: string;
    companyName: string;
    disciplineScore: number;
    investorTalkPct: number;
    createdAt: string;
  }>;
  calibrationPrecision: { fairHit: number; knewFromDeck: number; offBase: number };
}

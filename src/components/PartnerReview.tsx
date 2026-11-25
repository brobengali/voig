import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Link2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import type { CallRecord, CritiqueItem } from "../types";
import { CallRibbon, formatTime } from "./CallRibbon";

interface PartnerReviewProps {
  call: CallRecord;
  liveProgressMessage?: string;
  onRefresh: () => void;
  onDelete: (id: string) => void;
}

const CATEGORY_LABELS: Record<CritiqueItem["category"], string> = {
  confirmation_bias: "Confirmation Bias",
  leading_question: "Leading Question",
  halo_effect: "Halo Effect",
  premature_selling: "Premature Selling",
  unchallenged_claim: "Unchallenged Claim",
  missed_followup: "Missed Follow-Up",
  hypothetical_trap: "Hypothetical Trap",
  talk_dominance: "Talk Dominance",
  strong_probe: "Sharp Probe",
};

const OBJECTIVE_LABELS: Record<string, string> = {
  first_intro: "First Intro",
  deep_diligence: "Deep Diligence",
  partner_pitch: "Partner Pitch",
  founder_update: "Founder Update",
};

export const PartnerReview: React.FC<PartnerReviewProps> = ({
  call,
  liveProgressMessage,
  onRefresh,
  onDelete,
}) => {
  const [activeTab, setActiveTab] = useState<
    "review" | "claims" | "missed" | "priors"
  >("review");
  const [activeCritiqueId, setActiveCritiqueId] = useState<string | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setActiveCritiqueId(call.analysis?.critiques[0]?.id ?? null);
    setActiveSegmentId(call.analysis?.critiques[0]?.segmentId ?? null);
    setCurrentTimeSec(0);
    setIsPlaying(false);
  }, [call.id]);

  function handleSeek(sec: number, critiqueId?: string, segmentId?: string) {
    setCurrentTimeSec(sec);
    if (audioRef.current) {
      audioRef.current.currentTime = sec;
    }
    if (critiqueId) setActiveCritiqueId(critiqueId);
    if (segmentId) {
      setActiveSegmentId(segmentId);
      segmentRefs.current[segmentId]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      void audioRef.current.play();
      setIsPlaying(true);
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }

  async function copyText(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  async function handleCalibrate(
    critiqueId: string,
    verdict: "fair_hit" | "knew_from_deck" | "off_base"
  ) {
    await api.calibrateCritique(call.id, critiqueId, verdict);
    onRefresh();
  }

  const analysis = call.analysis;
  const segments = call.transcript ?? [];
  const critiquesBySeg = new Map<string, CritiqueItem[]>();
  if (analysis) {
    for (const c of analysis.critiques) {
      const list = critiquesBySeg.get(c.segmentId) ?? [];
      list.push(c);
      critiquesBySeg.set(c.segmentId, list);
    }
  }

  const isInFlight = [
    "queued",
    "transcribing",
    "extracting",
    "critiquing",
    "synthesizing",
  ].includes(call.status);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {call.hasAudio && (
        <audio
          ref={audioRef}
          src={`/api/calls/${encodeURIComponent(call.id)}/audio`}
          onTimeUpdate={(e) => setCurrentTimeSec(e.currentTarget.currentTime)}
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
        />
      )}

      {/* Editorial Header */}
      <div className="hairline-b pb-6 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-[11px] uppercase tracking-widest text-[var(--ink-secondary)]">
            <span className="px-2 py-0.5 hairline-box bg-[var(--bg-elevated)]">
              {call.meta.stage}
            </span>
            <span className="px-2 py-0.5 hairline-box bg-[var(--bg-elevated)]">
              {OBJECTIVE_LABELS[call.meta.objective] || call.meta.objective}
            </span>
            {call.meta.thesisSnapshot && (
              <span className="px-2 py-0.5 hairline-box bg-[var(--bg-elevated)]">
                Thesis: {call.meta.thesisSnapshot.name}
              </span>
            )}
            <span className="text-[var(--ink-tertiary)]">
              {new Date(call.createdAt).toLocaleDateString()}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {analysis && (
              <button
                type="button"
                onClick={() => {
                  void api.reanalyzeCall(call.id).then(onRefresh);
                }}
                className="px-2.5 py-1.5 hairline-box text-[11px] font-mono-tabular uppercase tracking-wider text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                Re-Run Critics
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(call.id)}
              className="px-2.5 py-1.5 hairline-box text-[11px] font-mono-tabular uppercase tracking-wider text-[var(--vermilion)] hover:bg-[var(--vermilion-soft)] flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Purge
            </button>
          </div>
        </div>

        <h1 className="font-serif-editorial text-4xl sm:text-5xl tracking-tight leading-[1.08] mb-3">
          {call.meta.companyName}
        </h1>

        {analysis ? (
          <>
            <p className="font-serif-editorial italic text-xl sm:text-2xl text-[var(--ink-primary)] leading-snug mb-3">
              “{analysis.headlineVerdict}”
            </p>
            <p className="text-sm text-[var(--ink-secondary)] leading-relaxed max-w-3xl">
              {analysis.partnerBrief}
            </p>

            {/* Four Minimalist Editorial Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 hairline-t">
              <div>
                <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)]">
                  Discipline Score
                </div>
                <div className="font-serif-editorial text-3xl mt-0.5">
                  {analysis.overallDisciplineScore}
                  <span className="text-base text-[var(--ink-tertiary)]">/100</span>
                </div>
              </div>
              <div>
                <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)]">
                  Investor Airtime
                </div>
                <div
                  className={`font-serif-editorial text-3xl mt-0.5 ${
                    analysis.dynamics.investorTalkPct >
                    (call.meta.thesisSnapshot?.targetInvestorTalkRatioMax ?? 40)
                      ? "text-[var(--vermilion)]"
                      : ""
                  }`}
                >
                  {Math.round(analysis.dynamics.investorTalkPct)}%
                </div>
              </div>
              <div>
                <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)]">
                  Open Questions
                </div>
                <div className="font-serif-editorial text-3xl mt-0.5">
                  {Math.round(analysis.dynamics.openEndedQuestionPct)}%
                </div>
              </div>
              <div>
                <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)]">
                  Bias Risk
                </div>
                <div
                  className={`font-serif-editorial text-3xl capitalize mt-0.5 ${
                    analysis.biasRiskLevel === "high" ||
                    analysis.biasRiskLevel === "elevated"
                      ? "text-[var(--vermilion)]"
                      : "text-[var(--sage)]"
                  }`}
                >
                  {analysis.biasRiskLevel}
                </div>
              </div>
            </div>
          </>
        ) : call.status === "awaiting_founder" ? (
          <div className="mt-4 p-5 hairline-box bg-[var(--bg-elevated)]">
            <div className="flex items-center gap-2 font-mono-tabular text-xs uppercase tracking-wider text-[var(--ink-primary)] mb-2">
              <span className="w-2 h-2 rounded-full bg-[var(--sage)] animate-pulse-dot" />
              Pitch Room Live — Status: {call.roomStatus}
            </div>
            <p className="text-sm text-[var(--ink-secondary)] mb-3">
              Share the signed Pitch Room link with the founder (or open it in
              another browser). Once they consent and finish recording, audio
              encrypts automatically and the multi-pass critique starts here.
            </p>
            <div className="flex items-center gap-2 text-xs font-mono-tabular text-[var(--ink-tertiary)]">
              <Link2 className="w-3.5 h-3.5" />
              Room ID: {call.id} · Expires{" "}
              {call.roomPublic
                ? new Date(call.roomPublic.expiresAt).toLocaleString()
                : ""}
            </div>
          </div>
        ) : isInFlight ? (
          <div className="mt-4 p-5 hairline-box bg-[var(--bg-elevated)]">
            <div className="flex items-center gap-2.5 font-mono-tabular text-xs uppercase tracking-wider text-[var(--vermilion)] mb-2">
              <span className="w-2 h-2 rounded-full bg-[var(--vermilion)] animate-pulse-dot" />
              Agent Pipeline: {call.status}
            </div>
            <p className="text-sm text-[var(--ink-secondary)]">
              {liveProgressMessage ||
                "Running diarized transcription, claim mapping, and parallel partner critics…"}
            </p>
          </div>
        ) : call.status === "error" ? (
          <div className="mt-4 p-5 hairline-box bg-[var(--vermilion-soft)]">
            <div className="flex items-center gap-2 font-mono-tabular text-xs uppercase tracking-wider text-[var(--vermilion)] mb-2">
              <AlertCircle className="w-4 h-4" />
              Analysis Halted
            </div>
            <p className="text-sm text-[var(--ink-primary)] mb-3">
              {call.errorMessage || "Unknown error occurred."}
            </p>
            <button
              type="button"
              onClick={() => void api.reanalyzeCall(call.id).then(onRefresh)}
              className="px-3 py-1.5 bg-[var(--ink-primary)] text-[var(--bg-paper)] text-xs font-mono-tabular uppercase tracking-wider cursor-pointer"
            >
              Retry Pipeline
            </button>
          </div>
        ) : null}
      </div>

      {/* Ribbon & Section Tabs */}
      {analysis && (
        <>
          <div className="mb-6">
            <CallRibbon
              segments={segments}
              critiques={analysis.critiques}
              durationSec={call.meta.durationSeconds || 0}
              currentTimeSec={currentTimeSec}
              isPlaying={isPlaying}
              hasAudio={call.hasAudio}
              activeCritiqueId={activeCritiqueId}
              onTogglePlay={togglePlay}
              onSeek={handleSeek}
            />
          </div>

          <div className="flex items-center gap-6 hairline-b mb-6 font-mono-tabular text-[11px] uppercase tracking-widest">
            {[
              {
                key: "review",
                label: `Red-Pen Review (${analysis.critiques.length})`,
              },
              {
                key: "claims",
                label: `Claims Audit (${analysis.extractedClaims.length})`,
              },
              {
                key: "missed",
                label: `Missed Questions (${analysis.missedQuestions.length})`,
              },
              { key: "priors", label: "Priors & Deck" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`pb-3 -mb-px transition-colors cursor-pointer ${
                  activeTab === tab.key
                    ? "border-b-2 border-[var(--vermilion)] text-[var(--ink-primary)] font-semibold"
                    : "text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "review" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Typeset Transcript */}
              <div className="lg:col-span-7 space-y-1">
                <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)] mb-3">
                  Diarized Call Transcript
                </div>
                {segments.map((seg) => {
                  const linkedCritiques = critiquesBySeg.get(seg.id) ?? [];
                  const isFocused = seg.id === activeSegmentId;
                  const isPlayingNow =
                    isPlaying &&
                    currentTimeSec >= seg.startSec &&
                    currentTimeSec <= seg.endSec;

                  return (
                    <div
                      key={seg.id}
                      ref={(el) => {
                        segmentRefs.current[seg.id] = el;
                      }}
                      onClick={() => {
                        const firstCrit = linkedCritiques[0];
                        handleSeek(seg.startSec, firstCrit?.id, seg.id);
                      }}
                      className={`p-3.5 transition-colors cursor-pointer border-l-2 ${
                        isFocused || isPlayingNow
                          ? "border-l-[var(--vermilion)] bg-[var(--bg-elevated)]"
                          : linkedCritiques.length > 0
                            ? "border-l-[var(--rule-strong)] hover:bg-[var(--bg-elevated)]"
                            : "border-l-transparent hover:bg-[var(--bg-elevated)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono-tabular text-[11px] uppercase tracking-wider font-semibold ${
                              seg.role === "investor"
                                ? "text-[var(--ink-primary)]"
                                : "text-[var(--ink-secondary)]"
                            }`}
                          >
                            {seg.speaker}
                          </span>
                          <span className="font-mono-tabular text-[10px] text-[var(--ink-tertiary)]">
                            {seg.role}
                          </span>
                        </div>
                        <span className="font-mono-tabular text-[11px] text-[var(--ink-tertiary)]">
                          {formatTime(seg.startSec)}
                        </span>
                      </div>
                      <p
                        className={`text-[14px] leading-relaxed ${
                          linkedCritiques.some((c) => c.severity !== "strength")
                            ? "red-underline"
                            : ""
                        }`}
                      >
                        {seg.text}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Right Margin Red-Pen Notes */}
              <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6">
                <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)] mb-3">
                  Partner Red-Pen Margin Notes
                </div>

                {analysis.critiques.map((c) => {
                  const isActive = c.id === activeCritiqueId;
                  const isStrength = c.severity === "strength";
                  const cal = call.calibrations[c.id]?.verdict;

                  return (
                    <div
                      key={c.id}
                      onClick={() => handleSeek(c.timestampSec, c.id, c.segmentId)}
                      className={`p-4 hairline-box transition-all cursor-pointer ${
                        isActive
                          ? "bg-[var(--bg-elevated)] border-[var(--ink-primary)] shadow-sm"
                          : "bg-[var(--bg-paper)] hover:bg-[var(--bg-elevated)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span
                          className={`font-mono-tabular text-[10px] uppercase tracking-widest px-1.5 py-0.5 ${
                            isStrength
                              ? "bg-[var(--sage-soft)] text-[var(--sage)]"
                              : "bg-[var(--vermilion-soft)] text-[var(--vermilion)]"
                          }`}
                        >
                          {CATEGORY_LABELS[c.category] || c.category}
                        </span>
                        <span className="font-mono-tabular text-[11px] text-[var(--ink-tertiary)]">
                          @{formatTime(c.timestampSec)}
                        </span>
                      </div>

                      <h3 className="font-serif-editorial text-lg font-medium leading-snug mb-1.5">
                        {c.title}
                      </h3>

                      <blockquote className="text-xs italic text-[var(--ink-secondary)] border-l-2 border-[var(--rule-strong)] pl-2.5 my-2">
                        “{c.verbatimQuote}”
                      </blockquote>

                      <p className="text-xs text-[var(--ink-primary)] leading-relaxed mb-3">
                        {c.diagnosis}
                      </p>

                      <div className="p-2.5 bg-[var(--bg-muted)] hairline-box mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)]">
                            Ask This Instead
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void copyText(c.id, c.counterfactualQuestion);
                            }}
                            className="text-[10px] font-mono-tabular text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)] flex items-center gap-1 cursor-pointer"
                          >
                            {copiedId === c.id ? (
                              <>
                                <Check className="w-3 h-3 text-[var(--sage)]" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                Copy
                              </>
                            )}
                          </button>
                        </div>
                        <p className="font-serif-editorial text-[14px] leading-snug text-[var(--ink-primary)]">
                          “{c.counterfactualQuestion}”
                        </p>
                      </div>

                      {/* Signal Calibration */}
                      <div
                        className="flex items-center justify-between pt-2 hairline-t"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="font-mono-tabular text-[10px] text-[var(--ink-tertiary)]">
                          Calibrate:
                        </span>
                        <div className="flex items-center gap-1">
                          {(
                            [
                              ["fair_hit", "Fair Hit"],
                              ["knew_from_deck", "Knew From Deck"],
                              ["off_base", "Off-Base"],
                            ] as const
                          ).map(([val, label]) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => void handleCalibrate(c.id, val)}
                              className={`px-2 py-0.5 text-[10px] font-mono-tabular transition-colors cursor-pointer ${
                                cal === val
                                  ? "bg-[var(--ink-primary)] text-[var(--bg-paper)]"
                                  : "text-[var(--ink-secondary)] hover:bg-[var(--bg-muted)]"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "claims" && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--ink-secondary)] mb-4">
                Every substantive claim made on the call, whether it was backed
                by hard metrics or left unverified.
              </p>
              <div className="hairline-box divide-y divide-[var(--rule-hairline)] bg-[var(--bg-elevated)]">
                {analysis.extractedClaims.map((cl) => (
                  <div
                    key={cl.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1 font-mono-tabular text-[10px] uppercase tracking-wider">
                        <span className="text-[var(--ink-tertiary)]">
                          @{formatTime(cl.timestampSec)} · {cl.speaker}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 ${
                            cl.evidenceLevel === "hard_metric"
                              ? "bg-[var(--sage-soft)] text-[var(--sage)]"
                              : "bg-[var(--vermilion-soft)] text-[var(--vermilion)]"
                          }`}
                        >
                          {cl.evidenceLevel.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--ink-primary)]">{cl.claim}</p>
                    </div>
                    <span
                      className={`shrink-0 font-mono-tabular text-[11px] px-2 py-1 hairline-box ${
                        cl.followedUpByInvestor
                          ? "text-[var(--sage)]"
                          : "text-[var(--vermilion)]"
                      }`}
                    >
                      {cl.followedUpByInvestor ? "Probed" : "Unchallenged"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "missed" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {analysis.missedQuestions.map((mq, i) => (
                <div key={i} className="p-5 hairline-box bg-[var(--bg-elevated)]">
                  <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--vermilion)] mb-1">
                    Blindspot {String(i + 1).padStart(2, "0")}
                  </div>
                  <h3 className="font-serif-editorial text-xl mb-2">{mq.topic}</h3>
                  <p className="text-xs text-[var(--ink-secondary)] leading-relaxed mb-3">
                    {mq.whyItMattersNow}
                  </p>
                  <div className="p-3 bg-[var(--bg-muted)] hairline-box">
                    <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-tertiary)] mb-1">
                      Suggested Probe
                    </div>
                    <p className="font-serif-editorial text-sm">
                      “{mq.suggestedQuestion}”
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "priors" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 hairline-box bg-[var(--bg-elevated)]">
                <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)] mb-2">
                  Pre-Call Hypotheses &amp; Priors
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--ink-primary)]">
                  {call.meta.preCallHypotheses || "No pre-call hypotheses logged."}
                </p>
              </div>
              <div className="p-5 hairline-box bg-[var(--bg-elevated)]">
                <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)] mb-2">
                  Deck Context {call.meta.deckFileName ? `(${call.meta.deckFileName})` : ""}
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--ink-primary)]">
                  {call.meta.deckSummary || "No deck attached."}
                </p>
              </div>
              <div className="md:col-span-2 p-5 hairline-box bg-[var(--bg-elevated)]">
                <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)] mb-2">
                  Co-Founder &amp; Dynamics Notes
                </div>
                <p className="text-sm text-[var(--ink-primary)]">
                  {analysis.dynamics.coFounderBalanceNote}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

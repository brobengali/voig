import React, { useRef, useState } from "react";
import { Check, Copy, Mic, Radio, Upload, X } from "lucide-react";
import { api } from "../api";
import type { CallObjective, ThesisProfile } from "../types";
import { formatTime } from "./CallRibbon";

interface NewSessionModalProps {
  profiles: ThesisProfile[];
  initialMode: "room" | "ingest";
  onClose: () => void;
  onCreated: (callId: string) => void;
}

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  profiles,
  initialMode,
  onClose,
  onCreated,
}) => {
  const [mode, setMode] = useState<"room" | "ingest">(initialMode);
  const [ingestMethod, setIngestMethod] = useState<
    "upload" | "live_tab_mic" | "transcript"
  >("upload");

  const [companyName, setCompanyName] = useState("");
  const [founderNamesRaw, setFounderNamesRaw] = useState("");
  const [stage, setStage] = useState("Seed");
  const [objective, setObjective] = useState<CallObjective>("first_intro");
  const [thesisProfileId, setThesisProfileId] = useState<string>(
    profiles[0]?.id ?? ""
  );
  const [investorSpeakerLabel, setInvestorSpeakerLabel] = useState("Investor");
  const [preCallHypotheses, setPreCallHypotheses] = useState("");
  const [promptForFounder, setPromptForFounder] = useState(
    "Walk us through what you're building, what changed recently in the market, and the sharpest evidence you have from customers."
  );
  const [deckNotes, setDeckNotes] = useState("");
  const [deckFile, setDeckFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [transcriptText, setTranscriptText] = useState("");

  // Live Tab + Mic capture state
  const [capturing, setCapturing] = useState(false);
  const [captureSec, setCaptureSec] = useState(0);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const captureRecRef = useRef<MediaRecorder | null>(null);
  const captureStreamsRef = useRef<MediaStream[]>([]);
  const captureTimerRef = useRef<number | null>(null);
  const captureChunksRef = useRef<Blob[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdRoomUrl, setCreatedRoomUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  async function startTabAndMicCapture() {
    setError(null);
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      captureStreamsRef.current = [displayStream, micStream];

      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();

      if (displayStream.getAudioTracks().length > 0) {
        const tabSource = audioCtx.createMediaStreamSource(displayStream);
        tabSource.connect(dest);
      }
      const micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(dest);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(dest.stream, { mimeType });
      captureChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) captureChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const blob = new Blob(captureChunksRef.current, { type: mimeType });
        setCapturedBlob(blob);
        setCapturing(false);
        if (captureTimerRef.current) window.clearInterval(captureTimerRef.current);
        captureStreamsRef.current.forEach((s) =>
          s.getTracks().forEach((t) => t.stop())
        );
      };

      captureRecRef.current = rec;
      rec.start(1000);
      setCapturing(true);
      setCaptureSec(0);
      captureTimerRef.current = window.setInterval(() => {
        setCaptureSec((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not capture tab + microphone audio."
      );
    }
  }

  function stopTabAndMicCapture() {
    if (captureRecRef.current && captureRecRef.current.state !== "inactive") {
      captureRecRef.current.stop();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const founderNames = founderNamesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      if (mode === "room") {
        const fd = new FormData();
        fd.append(
          "metadata",
          JSON.stringify({
            companyName,
            founderNames,
            stage,
            objective,
            thesisProfileId: thesisProfileId || null,
            preCallHypotheses,
            deckNotes,
            promptForFounder,
            investorSpeakerLabel,
          })
        );
        if (deckFile) fd.append("deck", deckFile);

        const res = await api.createRoom(fd);
        setCreatedRoomUrl(res.roomUrl);
        onCreated(res.id);
      } else {
        const fd = new FormData();
        const sourceType =
          ingestMethod === "transcript"
            ? "transcript"
            : ingestMethod === "live_tab_mic"
              ? "live_capture"
              : "upload";

        fd.append(
          "metadata",
          JSON.stringify({
            sourceType,
            companyName,
            founderNames,
            stage,
            objective,
            thesisProfileId: thesisProfileId || null,
            preCallHypotheses,
            deckNotes,
            investorSpeakerLabel,
            transcriptText:
              ingestMethod === "transcript" ? transcriptText : undefined,
          })
        );

        if (deckFile) fd.append("deck", deckFile);
        if (ingestMethod === "upload" && audioFile) {
          fd.append("audio", audioFile);
        } else if (ingestMethod === "live_tab_mic" && capturedBlob) {
          fd.append("audio", capturedBlob, `live_${Date.now()}.webm`);
        }

        const res = await api.ingestCall(fd);
        onCreated(res.id);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--bg-paper)] hairline-box p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center justify-between hairline-b pb-4 mb-5">
          <div>
            <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--vermilion)]">
              Session Intake
            </div>
            <h2 className="font-serif-editorial text-2xl sm:text-3xl">
              {createdRoomUrl
                ? "Pitch Room Ready"
                : mode === "room"
                  ? "Open a Hosted Consent Pitch Room"
                  : "Ingest Call or Capture Live Tab"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {createdRoomUrl ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--ink-secondary)] leading-relaxed">
              Send this signed, single-room link to the founder (or open it in
              another browser window). Your private hypotheses and vault remain
              completely inaccessible from the founder link.
            </p>
            <div className="p-3.5 bg-[var(--bg-elevated)] hairline-box font-mono-tabular text-xs break-all">
              {createdRoomUrl}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(createdRoomUrl);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 1800);
                }}
                className="px-4 py-2.5 bg-[var(--ink-primary)] text-[var(--bg-paper)] text-xs font-mono-tabular uppercase tracking-wider flex items-center gap-2 cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Copied Link
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copy Founder Link
                  </>
                )}
              </button>
              <a
                href={createdRoomUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2.5 hairline-box text-xs font-mono-tabular uppercase tracking-wider hover:bg-[var(--bg-elevated)]"
              >
                Open Room in New Tab →
              </a>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto text-xs font-mono-tabular text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Mode switch */}
            <div className="grid grid-cols-2 hairline-box bg-[var(--bg-elevated)] p-1">
              <button
                type="button"
                onClick={() => setMode("room")}
                className={`py-2 text-xs font-mono-tabular uppercase tracking-wider transition-colors cursor-pointer ${
                  mode === "room"
                    ? "bg-[var(--ink-primary)] text-[var(--bg-paper)]"
                    : "text-[var(--ink-secondary)]"
                }`}
              >
                Founder Pitch Room
              </button>
              <button
                type="button"
                onClick={() => setMode("ingest")}
                className={`py-2 text-xs font-mono-tabular uppercase tracking-wider transition-colors cursor-pointer ${
                  mode === "ingest"
                    ? "bg-[var(--ink-primary)] text-[var(--bg-paper)]"
                    : "text-[var(--ink-secondary)]"
                }`}
              >
                Upload / Tab Capture
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                  Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Lattice Robotics"
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] hairline-box text-sm focus:outline-none focus:border-[var(--ink-primary)]"
                />
              </div>
              <div>
                <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                  Founder Name(s)
                </label>
                <input
                  type="text"
                  value={founderNamesRaw}
                  onChange={(e) => setFounderNamesRaw(e.target.value)}
                  placeholder="Comma-separated"
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] hairline-box text-sm focus:outline-none focus:border-[var(--ink-primary)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                  Stage
                </label>
                <input
                  type="text"
                  required
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] hairline-box text-sm focus:outline-none focus:border-[var(--ink-primary)]"
                />
              </div>
              <div>
                <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                  Call Objective
                </label>
                <select
                  value={objective}
                  onChange={(e) => setObjective(e.target.value as CallObjective)}
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] hairline-box text-sm focus:outline-none"
                >
                  <option value="first_intro">First Intro</option>
                  <option value="deep_diligence">Deep Diligence</option>
                  <option value="partner_pitch">Partner Pitch</option>
                  <option value="founder_update">Founder Update</option>
                </select>
              </div>
              <div>
                <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                  Thesis Rubric
                </label>
                <select
                  value={thesisProfileId}
                  onChange={(e) => setThesisProfileId(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] hairline-box text-sm focus:outline-none"
                >
                  <option value="">General Venture Rigor</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                  Your Name / Speaker Label
                </label>
                <input
                  type="text"
                  value={investorSpeakerLabel}
                  onChange={(e) => setInvestorSpeakerLabel(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] hairline-box text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                  Pitch Deck (PDF / MD / TXT)
                </label>
                <input
                  type="file"
                  accept=".pdf,.md,.txt,application/pdf,text/plain,text/markdown"
                  onChange={(e) => setDeckFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs font-mono-tabular py-1.5"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                Pre-Call Hypotheses &amp; Red Flags (Private — detects confirmation bias)
              </label>
              <textarea
                rows={2}
                value={preCallHypotheses}
                onChange={(e) => setPreCallHypotheses(e.target.value)}
                placeholder="What do you already believe going in? What are you worried might make you fall for a strong narrative?"
                className="w-full px-3 py-2 bg-[var(--bg-elevated)] hairline-box text-sm focus:outline-none"
              />
            </div>

            {mode === "room" ? (
              <div>
                <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                  Prompt Shown to Founder in Room
                </label>
                <textarea
                  rows={2}
                  value={promptForFounder}
                  onChange={(e) => setPromptForFounder(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] hairline-box text-sm focus:outline-none"
                />
              </div>
            ) : (
              <div className="p-4 hairline-box bg-[var(--bg-elevated)] space-y-3">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["upload", "Upload Recording", Upload],
                      ["live_tab_mic", "Live Tab + Mic Capture", Radio],
                      ["transcript", "Paste Transcript", Mic],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setIngestMethod(key)}
                      className={`px-3 py-1.5 text-[11px] font-mono-tabular uppercase tracking-wider flex items-center gap-1.5 hairline-box cursor-pointer ${
                        ingestMethod === key
                          ? "bg-[var(--ink-primary)] text-[var(--bg-paper)]"
                          : "text-[var(--ink-secondary)]"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                {ingestMethod === "upload" && (
                  <div>
                    <input
                      type="file"
                      accept="audio/*,video/mp4,video/webm"
                      onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                      className="text-xs font-mono-tabular"
                    />
                    <p className="text-[11px] text-[var(--ink-tertiary)] mt-1">
                      Supports MP3, WAV, M4A, WebM, MP4. Encrypted on arrival.
                    </p>
                  </div>
                )}

                {ingestMethod === "live_tab_mic" && (
                  <div className="space-y-2">
                    <p className="text-xs text-[var(--ink-secondary)]">
                      Select the browser tab running your Meet/Zoom call (check{" "}
                      <strong>“Share tab audio”</strong>) to record both the
                      founder tab and your mic together.
                    </p>
                    <div className="flex items-center gap-3">
                      {!capturing ? (
                        <button
                          type="button"
                          onClick={() => void startTabAndMicCapture()}
                          className="px-3.5 py-2 bg-[var(--vermilion)] text-white text-xs font-mono-tabular uppercase tracking-wider cursor-pointer"
                        >
                          {capturedBlob ? "Re-Capture Call" : "Start Tab + Mic Capture"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={stopTabAndMicCapture}
                          className="px-3.5 py-2 bg-[var(--ink-primary)] text-[var(--bg-paper)] text-xs font-mono-tabular uppercase tracking-wider cursor-pointer"
                        >
                          Stop Capture ({formatTime(captureSec)})
                        </button>
                      )}
                      {capturedBlob && !capturing && (
                        <span className="font-mono-tabular text-xs text-[var(--sage)]">
                          Captured {formatTime(captureSec)} ready to analyze
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {ingestMethod === "transcript" && (
                  <textarea
                    rows={5}
                    value={transcriptText}
                    onChange={(e) => setTranscriptText(e.target.value)}
                    placeholder="Paste raw call transcript with speaker names or timestamps…"
                    className="w-full px-3 py-2 bg-[var(--bg-paper)] hairline-box text-xs font-mono-tabular focus:outline-none"
                  />
                )}
              </div>
            )}

            <div>
              <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                Optional Written Deck Notes
              </label>
              <textarea
                rows={2}
                value={deckNotes}
                onChange={(e) => setDeckNotes(e.target.value)}
                placeholder="Paste extra context already known before the call (prevents false-positive missed-question flags)."
                className="w-full px-3 py-2 bg-[var(--bg-elevated)] hairline-box text-sm focus:outline-none"
              />
            </div>

            {error && (
              <p className="text-xs font-mono-tabular text-[var(--vermilion)]">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 hairline-box text-xs font-mono-tabular uppercase tracking-wider cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 bg-[var(--ink-primary)] text-[var(--bg-paper)] text-xs font-mono-tabular uppercase tracking-widest disabled:opacity-50 cursor-pointer"
              >
                {submitting
                  ? "Processing…"
                  : mode === "room"
                    ? "Generate Signed Room Link"
                    : "Encrypt & Run Partner Critics"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

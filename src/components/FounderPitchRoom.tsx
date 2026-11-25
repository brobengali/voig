import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Mic,
  Pause,
  Play,
  Shield,
  Square,
} from "lucide-react";
import { api } from "../api";
import type { RoomPublicMeta } from "../types";
import { formatTime } from "./CallRibbon";

interface FounderPitchRoomProps {
  roomId: string;
  token: string;
}

export const FounderPitchRoom: React.FC<FounderPitchRoomProps> = ({
  roomId,
  token,
}) => {
  const [meta, setMeta] = useState<RoomPublicMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [consentChecked, setConsentChecked] = useState(false);
  const [recordingState, setRecordingState] = useState<
    "idle" | "recording" | "paused" | "review" | "uploading" | "submitted"
  >("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [hasTranscriptDraft, setHasTranscriptDraft] = useState(false);
  const [includeAudioOnSubmit, setIncludeAudioOnSubmit] = useState(true);

  const previewUrl = useMemo(
    () => (recordedBlob ? URL.createObjectURL(recordedBlob) : null),
    [recordedBlob]
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const animRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const info = await api.getRoomPublic(roomId, token);
        if (!mounted) return;
        setMeta(info.publicMeta);
        if (info.roomStatus === "submitted") {
          setRecordingState("submitted");
        } else {
          void api.postRoomPresence(roomId, token, "joined").catch(() => {});
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Invalid Pitch Room link.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
      cleanupMedia();
    };
  }, [roomId, token]);

  function cleanupMedia() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (animRef.current) cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  function drawOscilloscope() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      analyser.getByteTimeDomainData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 1.75;
      ctx.strokeStyle = "#C9331C";
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
      animRef.current = requestAnimationFrame(render);
    };
    render();
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setRecordedBlob(blob);
        setRecordingState("review");
        cleanupMedia();
      };

      recorderRef.current = recorder;
      recorder.start(1000);
      setRecordingState("recording");
      setElapsedSec(0);
      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
      drawOscilloscope();
      void api.postRoomPresence(roomId, token, "recording").catch(() => {});
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Microphone access was denied."
      );
    }
  }

  function pauseOrResume() {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.pause();
      if (timerRef.current) window.clearInterval(timerRef.current);
      setRecordingState("paused");
      void api.postRoomPresence(roomId, token, "paused").catch(() => {});
    } else if (rec.state === "paused") {
      rec.resume();
      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
      setRecordingState("recording");
      void api.postRoomPresence(roomId, token, "recording").catch(() => {});
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  async function transcribeRecording() {
    if (!recordedBlob) return;
    setTranscribing(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("token", token);
      fd.append("consentAccepted", String(consentChecked));
      fd.append("audio", recordedBlob, `pitch_${roomId}.webm`);
      const res = await api.transcribeRoomAudio(roomId, fd);
      setTranscriptDraft(res.transcriptText);
      setHasTranscriptDraft(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to transcribe recording."
      );
    } finally {
      setTranscribing(false);
    }
  }

  async function submitRecording() {
    if (!recordedBlob && !transcriptDraft.trim()) return;
    if (!includeAudioOnSubmit && !transcriptDraft.trim()) {
      setError("Enter or transcribe text before submitting without audio.");
      return;
    }
    setRecordingState("uploading");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("token", token);
      fd.append("consentAccepted", String(consentChecked));
      if (includeAudioOnSubmit && recordedBlob) {
        fd.append("audio", recordedBlob, `pitch_${roomId}.webm`);
      }
      if (transcriptDraft.trim()) {
        fd.append("transcriptText", transcriptDraft.trim());
      }
      await api.submitRoomAudio(roomId, fd);
      setRecordingState("submitted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setRecordingState("review");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono-tabular text-xs uppercase tracking-widest text-[var(--ink-tertiary)]">
        Verifying Encrypted Pitch Room…
      </div>
    );
  }

  if (error && !meta) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full p-8 hairline-box bg-[var(--bg-elevated)]">
          <div className="font-mono-tabular text-[11px] uppercase tracking-widest text-[var(--vermilion)] mb-2">
            Room Unavailable
          </div>
          <h1 className="font-serif-editorial text-3xl mb-3">
            This Pitch Room link is invalid or expired.
          </h1>
          <p className="text-sm text-[var(--ink-secondary)]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-between px-6 py-8">
      <header className="max-w-2xl w-full mx-auto flex items-center justify-between hairline-b pb-4">
        <div className="flex items-baseline gap-3">
          <span className="font-serif-editorial text-2xl font-medium">
            REDLINE
          </span>
          <span className="font-mono-tabular text-[11px] uppercase tracking-widest text-[var(--ink-tertiary)]">
            Founder Pitch Studio
          </span>
        </div>
        <span className="font-mono-tabular text-[11px] flex items-center gap-1.5 text-[var(--sage)]">
          <Shield className="w-3.5 h-3.5" />
          Encrypted Channel
        </span>
      </header>

      <main className="max-w-2xl w-full mx-auto my-auto py-10">
        {recordingState === "submitted" ? (
          <div className="p-8 hairline-box bg-[var(--bg-elevated)] text-center">
            <CheckCircle2 className="w-10 h-10 text-[var(--sage)] mx-auto mb-4" />
            <div className="font-mono-tabular text-[11px] uppercase tracking-widest text-[var(--sage)] mb-2">
              Sealed &amp; Delivered
            </div>
            <h1 className="font-serif-editorial text-4xl mb-3">
              Thank you, {meta?.companyName}.
            </h1>
            <p className="text-sm text-[var(--ink-secondary)] max-w-md mx-auto">
              Your recording has been encrypted immediately on receipt and
              delivered to the investor’s private desk. You can safely close
              this tab.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <div className="font-mono-tabular text-[11px] uppercase tracking-widest text-[var(--vermilion)] mb-2">
                Session Invitation
              </div>
              <h1 className="font-serif-editorial text-4xl sm:text-5xl tracking-tight mb-3">
                {meta?.companyName}
              </h1>
              <p className="text-sm text-[var(--ink-secondary)] leading-relaxed p-4 hairline-box bg-[var(--bg-elevated)]">
                {meta?.promptForFounder}
              </p>
            </div>

            {/* Consent gate */}
            <label className="flex items-start gap-3 p-4 hairline-box bg-[var(--bg-paper)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={consentChecked}
                disabled={recordingState !== "idle"}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-1 accent-[var(--vermilion)]"
              />
              <span className="text-xs text-[var(--ink-secondary)] leading-relaxed">
                {meta?.consentText}
              </span>
            </label>

            {/* Oscilloscope & Timer */}
            <div className="p-6 hairline-box bg-[var(--bg-elevated)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 font-mono-tabular text-[11px] uppercase tracking-wider">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      recordingState === "recording"
                        ? "bg-[var(--vermilion)] animate-pulse-dot"
                        : "bg-[var(--ink-tertiary)]"
                    }`}
                  />
                  {recordingState === "idle"
                    ? "Ready"
                    : recordingState === "recording"
                      ? "Recording Live"
                      : recordingState === "paused"
                        ? "Paused"
                        : recordingState === "uploading"
                          ? "Encrypting & Uploading…"
                          : "Ready to Submit"}
                </div>
                <span className="font-mono-tabular text-2xl font-medium">
                  {formatTime(elapsedSec)}
                </span>
              </div>

              <canvas
                ref={canvasRef}
                width={600}
                height={88}
                className="w-full h-22 bg-[var(--bg-paper)] hairline-box mb-5"
              />

              {error && (
                <p className="text-xs font-mono-tabular text-[var(--vermilion)] mb-3">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {recordingState === "idle" && (
                  <button
                    type="button"
                    disabled={!consentChecked}
                    onClick={() => void startRecording()}
                    className="px-5 py-3 bg-[var(--vermilion)] text-white text-xs font-mono-tabular uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 cursor-pointer"
                  >
                    <Mic className="w-4 h-4" />
                    Start Pitch Recording
                  </button>
                )}

                {(recordingState === "recording" || recordingState === "paused") && (
                  <>
                    <button
                      type="button"
                      onClick={pauseOrResume}
                      className="px-4 py-2.5 hairline-box text-xs font-mono-tabular uppercase tracking-wider flex items-center gap-2 cursor-pointer"
                    >
                      {recordingState === "recording" ? (
                        <>
                          <Pause className="w-3.5 h-3.5" /> Pause
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" /> Resume
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="px-5 py-2.5 bg-[var(--ink-primary)] text-[var(--bg-paper)] text-xs font-mono-tabular uppercase tracking-wider flex items-center gap-2 cursor-pointer"
                    >
                      <Square className="w-3.5 h-3.5" /> Finish Recording
                    </button>
                  </>
                )}

                {recordingState === "review" && (
                  <div className="w-full space-y-4">
                    {previewUrl && (
                      <audio controls src={previewUrl} className="w-full h-9" />
                    )}

                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={transcribing}
                        onClick={() => void transcribeRecording()}
                        className="px-4 py-2.5 hairline-box bg-[var(--bg-paper)] text-xs font-mono-tabular uppercase tracking-wider flex items-center gap-2 hover:bg-[var(--bg-muted)] disabled:opacity-50 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5 text-[var(--vermilion)]" />
                        {transcribing
                          ? "Transcribing…"
                          : hasTranscriptDraft
                            ? "Re-Transcribe Audio"
                            : "Convert Recording to Text"}
                      </button>

                      {!hasTranscriptDraft && (
                        <button
                          type="button"
                          onClick={() => setHasTranscriptDraft(true)}
                          className="px-3.5 py-2.5 hairline-box text-xs font-mono-tabular uppercase tracking-wider text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] cursor-pointer"
                        >
                          Write / Edit Text Manually
                        </button>
                      )}
                    </div>

                    {hasTranscriptDraft && (
                      <div className="p-3.5 hairline-box bg-[var(--bg-paper)] space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-secondary)]">
                            Editable Pitch Transcript
                          </span>
                          <label className="flex items-center gap-1.5 text-[11px] font-mono-tabular text-[var(--ink-secondary)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={includeAudioOnSubmit}
                              onChange={(e) =>
                                setIncludeAudioOnSubmit(e.target.checked)
                              }
                              className="accent-[var(--vermilion)]"
                            />
                            Also send audio recording
                          </label>
                        </div>
                        <textarea
                          rows={6}
                          value={transcriptDraft}
                          onChange={(e) => setTranscriptDraft(e.target.value)}
                          placeholder="Review, correct acronyms/numbers, or edit your spoken pitch here…"
                          className="w-full px-3 py-2 bg-[var(--bg-elevated)] hairline-box text-xs font-mono-tabular leading-relaxed focus:outline-none focus:border-[var(--ink-primary)]"
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => void submitRecording()}
                        className="px-5 py-3 bg-[var(--sage)] text-white text-xs font-mono-tabular uppercase tracking-widest cursor-pointer"
                      >
                        {includeAudioOnSubmit
                          ? "Encrypt & Submit Pitch"
                          : "Encrypt & Submit Text Only"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRecordedBlob(null);
                          setTranscriptDraft("");
                          setHasTranscriptDraft(false);
                          setIncludeAudioOnSubmit(true);
                          setRecordingState("idle");
                          setElapsedSec(0);
                        }}
                        className="px-4 py-3 hairline-box text-xs font-mono-tabular uppercase tracking-wider cursor-pointer"
                      >
                        Re-Record
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-2xl w-full mx-auto hairline-t pt-4 flex items-center justify-between text-[11px] font-mono-tabular text-[var(--ink-tertiary)]">
        <span>Scoped Single-Room Access</span>
        <span>Zero Investor Data Exposed</span>
      </footer>
    </div>
  );
};

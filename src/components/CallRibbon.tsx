import React from "react";
import { Pause, Play } from "lucide-react";
import type { CritiqueItem, TranscriptSegment } from "../types";

interface CallRibbonProps {
  segments: TranscriptSegment[];
  critiques: CritiqueItem[];
  durationSec: number;
  currentTimeSec: number;
  isPlaying: boolean;
  hasAudio: boolean;
  activeCritiqueId: string | null;
  onTogglePlay: () => void;
  onSeek: (sec: number, critiqueId?: string, segmentId?: string) => void;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export const CallRibbon: React.FC<CallRibbonProps> = ({
  segments,
  critiques,
  durationSec,
  currentTimeSec,
  isPlaying,
  hasAudio,
  activeCritiqueId,
  onTogglePlay,
  onSeek,
}) => {
  const total = Math.max(
    durationSec || 1,
    segments.length > 0 ? segments[segments.length - 1].endSec : 1,
    1
  );
  const playheadPct = Math.min(100, Math.max(0, (currentTimeSec / total) * 100));

  return (
    <div className="hairline-box bg-[var(--bg-elevated)] px-4 py-3">
      <div className="flex items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-3">
          {hasAudio && (
            <button
              type="button"
              onClick={onTogglePlay}
              className="w-7 h-7 flex items-center justify-center bg-[var(--ink-primary)] text-[var(--bg-paper)] hover:opacity-90 transition-opacity cursor-pointer"
              title={isPlaying ? "Pause call audio" : "Play call audio"}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5 ml-0.5" />
              )}
            </button>
          )}
          <span className="font-mono-tabular text-[11px] uppercase tracking-wider text-[var(--ink-secondary)]">
            Call Rhythm &amp; Red-Pen Pins
          </span>
        </div>

        <div className="flex items-center gap-4 font-mono-tabular text-[11px] text-[var(--ink-tertiary)]">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 inline-block bg-[var(--ink-primary)]" />
            Investor
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 inline-block bg-[var(--ink-tertiary)]" />
            Founder
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block bg-[var(--vermilion)]" />
            Redline
          </span>
          <span className="text-[var(--ink-primary)]">
            {formatTime(currentTimeSec)} / {formatTime(total)}
          </span>
        </div>
      </div>

      {/* Interactive SVG Timeline */}
      <div className="relative h-14 select-none">
        <svg
          viewBox="0 0 1000 56"
          preserveAspectRatio="none"
          className="w-full h-full overflow-visible cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            onSeek(ratio * total);
          }}
        >
          {/* Center axis */}
          <line
            x1={0}
            y1={28}
            x2={1000}
            y2={28}
            stroke="var(--rule-strong)"
            strokeWidth={1}
          />

          {/* Speaker turn bars */}
          {segments.map((seg) => {
            const x = (seg.startSec / total) * 1000;
            const w = Math.max(2, ((seg.endSec - seg.startSec) / total) * 1000);
            const isInvestor = seg.role === "investor";
            return (
              <rect
                key={seg.id}
                x={x}
                y={isInvestor ? 10 : 30}
                width={w}
                height={16}
                fill={isInvestor ? "var(--ink-primary)" : "var(--ink-tertiary)"}
                opacity={isInvestor ? 0.85 : 0.45}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSeek(seg.startSec, undefined, seg.id);
                }}
              />
            );
          })}

          {/* Critique pins */}
          {critiques.map((c) => {
            const cx = Math.min(994, Math.max(6, (c.timestampSec / total) * 1000));
            const isStrength = c.severity === "strength";
            const isActive = c.id === activeCritiqueId;
            return (
              <g
                key={c.id}
                className="cursor-pointer"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSeek(c.timestampSec, c.id, c.segmentId);
                }}
              >
                <line
                  x1={cx}
                  y1={4}
                  x2={cx}
                  y2={52}
                  stroke={isStrength ? "var(--sage)" : "var(--vermilion)"}
                  strokeWidth={isActive ? 2.5 : 1.5}
                />
                <circle
                  cx={cx}
                  cy={6}
                  r={isActive ? 5.5 : 4}
                  fill={isStrength ? "var(--sage)" : "var(--vermilion)"}
                />
              </g>
            );
          })}

          {/* Playhead */}
          {hasAudio && (
            <line
              x1={playheadPct * 10}
              y1={0}
              x2={playheadPct * 10}
              y2={56}
              stroke="var(--ink-primary)"
              strokeWidth={1.5}
              strokeDasharray="2 2"
            />
          )}
        </svg>
      </div>
    </div>
  );
};

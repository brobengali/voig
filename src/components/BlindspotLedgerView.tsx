import React from "react";
import type { BlindspotLedger } from "../types";

interface BlindspotLedgerViewProps {
  ledger: BlindspotLedger | null;
  onSelectCall: (id: string) => void;
}

export const BlindspotLedgerView: React.FC<BlindspotLedgerViewProps> = ({
  ledger,
  onSelectCall,
}) => {
  if (!ledger || ledger.totalCallsAnalyzed === 0) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-center">
        <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--vermilion)] mb-2">
          Longitudinal Memory
        </div>
        <h1 className="font-serif-editorial text-4xl mb-3">
          Your Blindspot Ledger is empty.
        </h1>
        <p className="text-sm text-[var(--ink-secondary)] max-w-md mx-auto">
          Once you analyze founder calls and calibrate the agent’s red-pen
          notes, recurring patterns across your meetings will surface here.
        </p>
      </div>
    );
  }

  const totalCal =
    ledger.calibrationPrecision.fairHit +
    ledger.calibrationPrecision.knewFromDeck +
    ledger.calibrationPrecision.offBase;
  const precisionPct =
    totalCal > 0
      ? Math.round((ledger.calibrationPrecision.fairHit / totalCal) * 100)
      : null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <div className="hairline-b pb-5">
        <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--vermilion)] mb-1">
          Cross-Call Pattern Ledger
        </div>
        <h1 className="font-serif-editorial text-4xl tracking-tight">
          Where Your Diligence Slips Over Time
        </h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 p-6 hairline-box bg-[var(--bg-elevated)]">
        <div>
          <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)]">
            Calls Audited
          </div>
          <div className="font-serif-editorial text-4xl mt-1">
            {ledger.totalCallsAnalyzed}
          </div>
        </div>
        <div>
          <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)]">
            Avg Discipline
          </div>
          <div className="font-serif-editorial text-4xl mt-1">
            {ledger.avgDisciplineScore}
            <span className="text-base text-[var(--ink-tertiary)]">/100</span>
          </div>
        </div>
        <div>
          <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)]">
            Avg Investor Talk
          </div>
          <div className="font-serif-editorial text-4xl mt-1">
            {ledger.avgInvestorTalkPct}%
          </div>
        </div>
        <div>
          <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)]">
            Critic Precision
          </div>
          <div className="font-serif-editorial text-4xl mt-1">
            {precisionPct !== null ? `${precisionPct}%` : "—"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="p-6 hairline-box bg-[var(--bg-elevated)]">
          <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)] mb-4">
            Recurring Blindspots &amp; Biases
          </div>
          <div className="space-y-3">
            {ledger.topBiases.map((b) => (
              <div key={b.category}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-mono-tabular uppercase tracking-wider">
                    {b.category.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono-tabular text-[var(--ink-secondary)]">
                    {b.count} flags ({b.fairHits} confirmed)
                  </span>
                </div>
                <div className="h-1.5 bg-[var(--bg-muted)]">
                  <div
                    className="h-full bg-[var(--vermilion)]"
                    style={{
                      width: `${Math.min(
                        100,
                        (b.count / Math.max(1, ledger.topBiases[0]?.count || 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 hairline-box bg-[var(--bg-elevated)]">
          <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)] mb-4">
            Recent Call Trajectory
          </div>
          <div className="divide-y divide-[var(--rule-hairline)]">
            {ledger.recentTrend.map((t) => (
              <button
                key={t.callId}
                type="button"
                onClick={() => onSelectCall(t.callId)}
                className="w-full py-2.5 flex items-center justify-between text-left hover:opacity-80 cursor-pointer"
              >
                <div>
                  <div className="font-serif-editorial text-lg">
                    {t.companyName}
                  </div>
                  <div className="font-mono-tabular text-[10px] text-[var(--ink-tertiary)]">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="font-mono-tabular text-xs text-right">
                  <div>{t.disciplineScore}/100</div>
                  <div className="text-[10px] text-[var(--ink-tertiary)]">
                    Talk {Math.round(t.investorTalkPct)}%
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

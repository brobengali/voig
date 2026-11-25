import React, { useState } from "react";
import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import { api } from "../api";
import type { VaultStatus } from "../types";

interface VaultGateProps {
  status: VaultStatus;
  onUnlocked: () => void;
}

export const VaultGate: React.FC<VaultGateProps> = ({ status, onUnlocked }) => {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInit = status.initialized;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isInit && passphrase !== confirm) {
      setError("Passphrases do not match.");
      return;
    }
    setLoading(true);
    try {
      if (isInit) {
        await api.vaultUnlock(passphrase);
      } else {
        await api.vaultInit(passphrase);
      }
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-between px-6 py-10">
      <header className="max-w-xl w-full mx-auto flex items-center justify-between hairline-b pb-4">
        <div className="flex items-baseline gap-3">
          <span className="font-serif-editorial text-2xl tracking-tight font-medium">
            REDLINE
          </span>
          <span className="font-mono-tabular text-[11px] uppercase tracking-widest text-[var(--ink-tertiary)]">
            Private Partner Desk
          </span>
        </div>
        <span className="font-mono-tabular text-[11px] uppercase tracking-wider flex items-center gap-1.5 text-[var(--ink-secondary)]">
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--sage)]" />
          AES-256-GCM
        </span>
      </header>

      <main className="max-w-xl w-full mx-auto my-auto py-12">
        <p className="font-mono-tabular text-[11px] uppercase tracking-[0.2em] text-[var(--vermilion)] mb-3">
          {isInit ? "Encrypted Vault Sealed" : "First-Run Vault Initialization"}
        </p>
        <h1 className="font-serif-editorial text-4xl sm:text-5xl leading-[1.08] tracking-tight mb-4">
          {isInit
            ? "Unseal your partner desk."
            : "Create your master vault passphrase."}
        </h1>
        <p className="text-sm text-[var(--ink-secondary)] leading-relaxed mb-8 max-w-md">
          {isInit
            ? "All founder recordings, pitch decks, pre-call priors, and red-pen critiques are encrypted at rest locally."
            : "Your passphrase derives a local AES-256-GCM encryption key via scrypt. It is never stored in plain text or sent off-device."}
        </p>

        {!status.geminiConfigured && (
          <div className="mb-6 p-3.5 hairline-box bg-[var(--amber-soft)] flex items-start gap-2.5 text-xs text-[var(--ink-primary)]">
            <AlertTriangle className="w-4 h-4 text-[var(--amber)] shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">GEMINI_API_KEY not detected in .env.</span>{" "}
              You can unlock the vault now, but audio transcription and partner
              critiques require a valid key in <code className="font-mono-tabular">.env</code>.
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block font-mono-tabular text-[11px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1.5">
              {isInit ? "Vault Passphrase" : "New Passphrase (min 10 chars)"}
            </label>
            <div className="relative">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                required
                minLength={isInit ? 1 : 10}
                autoFocus
                placeholder="••••••••••••••••"
                className="w-full px-3.5 py-2.5 bg-[var(--bg-elevated)] hairline-box text-sm font-mono-tabular focus:outline-none focus:border-[var(--ink-primary)]"
              />
              <Lock className="w-4 h-4 text-[var(--ink-tertiary)] absolute right-3.5 top-3" />
            </div>
          </div>

          {!isInit && (
            <div>
              <label className="block font-mono-tabular text-[11px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1.5">
                Confirm Passphrase
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={10}
                placeholder="••••••••••••••••"
                className="w-full px-3.5 py-2.5 bg-[var(--bg-elevated)] hairline-box text-sm font-mono-tabular focus:outline-none focus:border-[var(--ink-primary)]"
              />
            </div>
          )}

          {error && (
            <p className="text-xs font-mono-tabular text-[var(--vermilion)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-[var(--ink-primary)] text-[var(--bg-paper)] text-xs font-mono-tabular uppercase tracking-[0.16em] hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            {loading
              ? "Deriving Key…"
              : isInit
                ? "Unseal Desk"
                : "Initialize Encrypted Vault"}
          </button>
        </form>
      </main>

      <footer className="max-w-xl w-full mx-auto hairline-t pt-4 flex items-center justify-between text-[11px] font-mono-tabular text-[var(--ink-tertiary)]">
        <span>Zero Third-Party Telemetry</span>
        <span>Models via .env</span>
      </footer>
    </div>
  );
};

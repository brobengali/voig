import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import type { ThesisProfile } from "../types";

interface ThesisAtelierProps {
  profiles: ThesisProfile[];
  onRefresh: () => void;
}

export const ThesisAtelier: React.FC<ThesisAtelierProps> = ({
  profiles,
  onRefresh,
}) => {
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [stageFocus, setStageFocus] = useState("Seed");
  const [sectorFocus, setSectorFocus] = useState("");
  const [talkMax, setTalkMax] = useState(38);
  const [strictness, setStrictness] = useState<
    "calibrated" | "unsparing" | "supportive"
  >("unsparing");
  const [risksText, setRisksText] = useState("");
  const [biasesText, setBiasesText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadForEdit(p: ThesisProfile) {
    setEditingId(p.id);
    setName(p.name);
    setStageFocus(p.stageFocus);
    setSectorFocus(p.sectorFocus);
    setTalkMax(p.targetInvestorTalkRatioMax);
    setStrictness(p.strictness);
    setRisksText(p.coreRisksToProbe.join("\n"));
    setBiasesText(p.customBiasesToWatch.join("\n"));
  }

  function resetForm() {
    setEditingId(undefined);
    setName("");
    setStageFocus("Seed");
    setSectorFocus("");
    setTalkMax(38);
    setStrictness("unsparing");
    setRisksText("");
    setBiasesText("");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const coreRisksToProbe = risksText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const customBiasesToWatch = biasesText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      await api.saveThesis({
        id: editingId,
        name,
        stageFocus,
        sectorFocus,
        targetInvestorTalkRatioMax: Number(talkMax),
        strictness,
        coreRisksToProbe,
        customBiasesToWatch,
      });
      resetForm();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save thesis profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="hairline-b pb-5 mb-8">
        <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--vermilion)] mb-1">
          Zero-Hardcoding Rubric Engine
        </div>
        <h1 className="font-serif-editorial text-4xl tracking-tight mb-2">
          Thesis &amp; Bias Profiles
        </h1>
        <p className="text-sm text-[var(--ink-secondary)] max-w-2xl">
          Define your own stage risk stacks, airtime targets, and recurring
          personal biases. Nothing is hardcoded—every critique pass adapts to
          the profile you attach to a call.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Saved profiles */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)]">
              Encrypted Profiles ({profiles.length})
            </span>
            <button
              type="button"
              onClick={resetForm}
              className="text-[11px] font-mono-tabular uppercase tracking-wider flex items-center gap-1 text-[var(--vermilion)] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>

          {profiles.length === 0 ? (
            <div className="p-5 hairline-box bg-[var(--bg-elevated)] text-xs text-[var(--ink-secondary)] leading-relaxed">
              No thesis profiles saved yet. Create your first rubric on the
              right (e.g., “Seed B2B SaaS” or “Pre-Seed Deep Tech”).
            </div>
          ) : (
            profiles.map((p) => (
              <div
                key={p.id}
                onClick={() => loadForEdit(p)}
                className={`p-4 hairline-box cursor-pointer transition-colors ${
                  editingId === p.id
                    ? "bg-[var(--bg-elevated)] border-[var(--ink-primary)]"
                    : "hover:bg-[var(--bg-elevated)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-serif-editorial text-xl">{p.name}</div>
                    <div className="font-mono-tabular text-[11px] text-[var(--ink-tertiary)] mt-0.5">
                      {p.stageFocus} · {p.sectorFocus} · Max Talk {p.targetInvestorTalkRatioMax}%
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void api.deleteThesis(p.id).then(onRefresh);
                    }}
                    className="p-1 text-[var(--ink-tertiary)] hover:text-[var(--vermilion)] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Editor */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-7 p-6 hairline-box bg-[var(--bg-elevated)] space-y-4"
        >
          <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-secondary)]">
            {editingId ? "Edit Profile" : "Create Profile"}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                Profile Name *
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Seed Applied AI"
                className="w-full px-3 py-2 bg-[var(--bg-paper)] hairline-box text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                Stage Focus *
              </label>
              <input
                required
                value={stageFocus}
                onChange={(e) => setStageFocus(e.target.value)}
                placeholder="Pre-Seed / Seed / Series A"
                className="w-full px-3 py-2 bg-[var(--bg-paper)] hairline-box text-sm focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                Max Talk %
              </label>
              <input
                type="number"
                min={10}
                max={80}
                value={talkMax}
                onChange={(e) => setTalkMax(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[var(--bg-paper)] hairline-box text-sm font-mono-tabular focus:outline-none"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                Critic Strictness
              </label>
              <select
                value={strictness}
                onChange={(e) =>
                  setStrictness(e.target.value as typeof strictness)
                }
                className="w-full px-3 py-2 bg-[var(--bg-paper)] hairline-box text-sm focus:outline-none"
              >
                <option value="unsparing">Unsparing</option>
                <option value="calibrated">Calibrated</option>
                <option value="supportive">Supportive</option>
              </select>
            </div>
            <div className="sm:col-span-1">
              <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
                Sector Focus *
              </label>
              <input
                required
                value={sectorFocus}
                onChange={(e) => setSectorFocus(e.target.value)}
                placeholder="e.g. Vertical SaaS"
                className="w-full px-3 py-2 bg-[var(--bg-paper)] hairline-box text-sm focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
              Core Risks To Probe (one per line) *
            </label>
            <textarea
              required
              rows={3}
              value={risksText}
              onChange={(e) => setRisksText(e.target.value)}
              placeholder={"Distribution wedge vs incumbents\nGross margin after inference costs\nCustomer willingness to switch"}
              className="w-full px-3 py-2 bg-[var(--bg-paper)] hairline-box text-sm focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-secondary)] mb-1">
              Personal Biases To Watch For (one per line) *
            </label>
            <textarea
              required
              rows={3}
              value={biasesText}
              onChange={(e) => setBiasesText(e.target.value)}
              placeholder={"Over-indexing on technical pedigree\nPitching value-add too early in first calls"}
              className="w-full px-3 py-2 bg-[var(--bg-paper)] hairline-box text-sm focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-xs font-mono-tabular text-[var(--vermilion)]">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 hairline-box text-xs font-mono-tabular uppercase tracking-wider cursor-pointer"
              >
                Reset
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-[var(--ink-primary)] text-[var(--bg-paper)] text-xs font-mono-tabular uppercase tracking-widest cursor-pointer"
            >
              {saving ? "Encrypting…" : "Save Rubric"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

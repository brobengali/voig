import { useEffect, useState } from "react";
import { Lock, Moon, Plus, Sun, Upload } from "lucide-react";
import { api } from "./api";
import { BlindspotLedgerView } from "./components/BlindspotLedgerView";
import { FounderPitchRoom } from "./components/FounderPitchRoom";
import { NewSessionModal } from "./components/NewSessionModal";
import { PartnerReview } from "./components/PartnerReview";
import { ThesisAtelier } from "./components/ThesisAtelier";
import { VaultGate } from "./components/VaultGate";
import type {
  BlindspotLedger,
  CallRecord,
  ThesisProfile,
  VaultStatus,
} from "./types";

function parseRoomRoute(): { roomId: string; token: string } | null {
  const match = window.location.pathname.match(/^\/room\/([^/]+)$/);
  if (!match) return null;
  const params = new URLSearchParams(window.location.search);
  return {
    roomId: decodeURIComponent(match[1]),
    token: params.get("token") || "",
  };
}

export function App() {
  const roomRoute = parseRoomRoute();

  const [theme, setTheme] = useState<"paper" | "obsidian">(
    () => (localStorage.getItem("redline_theme") as "paper" | "obsidian") || "paper"
  );
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [view, setView] = useState<"desk" | "ledger" | "thesis">("desk");
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ThesisProfile[]>([]);
  const [ledger, setLedger] = useState<BlindspotLedger | null>(null);
  const [progressByCall, setProgressByCall] = useState<Record<string, string>>({});
  const [modalMode, setModalMode] = useState<"room" | "ingest" | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("redline_theme", theme);
  }, [theme]);

  async function refreshStatusAndData() {
    const st = await api.vaultStatus();
    setVaultStatus(st);
    if (st.authenticated) {
      const [callsRes, thesisRes, ledgerRes] = await Promise.all([
        api.listCalls(),
        api.listThesis(),
        api.getLedger(),
      ]);
      setCalls(callsRes.calls);
      setProfiles(thesisRes.profiles);
      setLedger(ledgerRes);
      if (!selectedCallId && callsRes.calls.length > 0) {
        setSelectedCallId(callsRes.calls[0].id);
      }
    }
  }

  useEffect(() => {
    if (!roomRoute) {
      void refreshStatusAndData();
    }
  }, []);

  useEffect(() => {
    if (!vaultStatus?.authenticated || roomRoute) return;

    const es = new EventSource("/api/events", { withCredentials: true });
    const handleEvent = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as {
          callId: string;
          message?: string;
        };
        if (data.message) {
          setProgressByCall((prev) => ({
            ...prev,
            [data.callId]: data.message!,
          }));
        }
        void refreshStatusAndData();
      } catch {
        // ignore malformed SSE
      }
    };

    es.addEventListener("call.updated", handleEvent);
    es.addEventListener("call.progress", handleEvent);
    es.addEventListener("room.founder_joined", handleEvent);
    es.addEventListener("room.recording", handleEvent);
    es.addEventListener("room.submitted", handleEvent);

    return () => {
      es.close();
    };
  }, [vaultStatus?.authenticated]);

  if (roomRoute) {
    return <FounderPitchRoom roomId={roomRoute.roomId} token={roomRoute.token} />;
  }

  if (!vaultStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono-tabular text-xs uppercase tracking-widest text-[var(--ink-tertiary)]">
        Checking Vault Seal…
      </div>
    );
  }

  if (!vaultStatus.authenticated) {
    return (
      <VaultGate
        status={vaultStatus}
        onUnlocked={() => void refreshStatusAndData()}
      />
    );
  }

  const activeCall = calls.find((c) => c.id === selectedCallId) ?? calls[0] ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Editorial Broadsheet Masthead */}
      <header className="h-14 px-5 hairline-b bg-[var(--bg-paper)] flex items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-baseline gap-3">
          <span className="font-serif-editorial text-2xl font-medium tracking-tight">
            REDLINE
          </span>
          <span className="hidden md:inline font-mono-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--ink-tertiary)]">
            Partner Critique Desk
          </span>
        </div>

        <nav className="flex items-center gap-5 font-mono-tabular text-[11px] uppercase tracking-widest">
          {(
            [
              ["desk", "Desk"],
              ["ledger", "Blindspot Ledger"],
              ["thesis", "Thesis Rubrics"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`py-1 transition-colors cursor-pointer ${
                view === key
                  ? "text-[var(--ink-primary)] border-b border-[var(--vermilion)] font-semibold"
                  : "text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setModalMode("room")}
            className="px-3 py-1.5 bg-[var(--ink-primary)] text-[var(--bg-paper)] text-[11px] font-mono-tabular uppercase tracking-wider flex items-center gap-1.5 cursor-pointer hover:opacity-90"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pitch Room</span>
          </button>
          <button
            type="button"
            onClick={() => setModalMode("ingest")}
            className="px-3 py-1.5 hairline-box text-[11px] font-mono-tabular uppercase tracking-wider flex items-center gap-1.5 cursor-pointer hover:bg-[var(--bg-elevated)]"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ingest</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme(theme === "paper" ? "obsidian" : "paper")}
            className="p-2 hairline-box text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] cursor-pointer"
            title="Switch Archival Paper / Obsidian theme"
          >
            {theme === "paper" ? (
              <Moon className="w-3.5 h-3.5" />
            ) : (
              <Sun className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={async () => {
              await api.vaultLock();
              await refreshStatusAndData();
            }}
            className="p-2 hairline-box text-[var(--ink-secondary)] hover:text-[var(--vermilion)] cursor-pointer"
            title="Seal & lock encrypted vault"
          >
            <Lock className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      {view === "desk" && (
        <div className="flex-1 flex flex-col md:flex-row">
          {/* Minimalist Call Dossier Rail */}
          <aside className="w-full md:w-72 shrink-0 hairline-r bg-[var(--bg-elevated)] p-4">
            <div className="font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--ink-tertiary)] mb-3 px-1">
              Call Dossiers ({calls.length})
            </div>

            {calls.length === 0 ? (
              <div className="p-4 hairline-box bg-[var(--bg-paper)] text-xs text-[var(--ink-secondary)] leading-relaxed">
                No calls yet. Open a <strong>Pitch Room</strong> link for a
                founder or <strong>Ingest</strong> a recording/transcript.
              </div>
            ) : (
              <div className="space-y-1.5">
                {calls.map((c) => {
                  const active = activeCall?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCallId(c.id)}
                      className={`w-full text-left p-3 transition-colors cursor-pointer border-l-2 ${
                        active
                          ? "bg-[var(--bg-paper)] border-l-[var(--vermilion)]"
                          : "border-l-transparent hover:bg-[var(--bg-paper)]/60"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-serif-editorial text-lg leading-tight truncate">
                          {c.meta.companyName}
                        </span>
                        {c.analysis ? (
                          <span className="font-mono-tabular text-xs font-medium shrink-0">
                            {c.analysis.overallDisciplineScore}
                          </span>
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--vermilion)] animate-pulse-dot shrink-0" />
                        )}
                      </div>
                      <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--ink-tertiary)] mt-1 flex items-center justify-between">
                        <span>{c.meta.stage}</span>
                        <span>
                          {c.status === "awaiting_founder"
                            ? `Room: ${c.roomStatus}`
                            : c.status}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* Broadsheet Canvas */}
          <main className="flex-1 min-w-0">
            {activeCall ? (
              <PartnerReview
                call={activeCall}
                liveProgressMessage={progressByCall[activeCall.id]}
                onRefresh={() => void refreshStatusAndData()}
                onDelete={(id) => {
                  void api.deleteCall(id).then(() => {
                    if (selectedCallId === id) setSelectedCallId(null);
                    void refreshStatusAndData();
                  });
                }}
              />
            ) : (
              <div className="max-w-2xl mx-auto px-6 py-24 text-center">
                <p className="font-mono-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--vermilion)] mb-3">
                  Your Co-Investor Critic
                </p>
                <h2 className="font-serif-editorial text-4xl sm:text-5xl mb-4 leading-tight">
                  Catch the bias before the term sheet.
                </h2>
                <p className="text-sm text-[var(--ink-secondary)] leading-relaxed mb-8">
                  Open a scoped Pitch Room link for a founder to record directly
                  in their browser, capture a live Meet/Zoom tab + mic, or drop
                  in an existing recording or transcript.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setModalMode("room")}
                    className="px-5 py-3 bg-[var(--ink-primary)] text-[var(--bg-paper)] text-xs font-mono-tabular uppercase tracking-widest cursor-pointer"
                  >
                    + Open Founder Pitch Room
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalMode("ingest")}
                    className="px-5 py-3 hairline-box text-xs font-mono-tabular uppercase tracking-widest cursor-pointer hover:bg-[var(--bg-elevated)]"
                  >
                    Ingest Recording / Capture Tab
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {view === "ledger" && (
        <BlindspotLedgerView
          ledger={ledger}
          onSelectCall={(id) => {
            setSelectedCallId(id);
            setView("desk");
          }}
        />
      )}

      {view === "thesis" && (
        <ThesisAtelier
          profiles={profiles}
          onRefresh={() => void refreshStatusAndData()}
        />
      )}

      {modalMode && (
        <NewSessionModal
          profiles={profiles}
          initialMode={modalMode}
          onClose={() => setModalMode(null)}
          onCreated={(id) => {
            setSelectedCallId(id);
            setView("desk");
            void refreshStatusAndData();
          }}
        />
      )}
    </div>
  );
}

export default App;

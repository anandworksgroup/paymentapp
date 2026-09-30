"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import { Button, Chip, ErrorNote, Skeleton, Spinner, StatusChip, Textarea, cx } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { useMerchant, useToast } from "./context";
import { Icon } from "./icons";

type ToolCall = { name: string; input: unknown; result_preview: string };
type Proposal = { id: string; kind: string; summary: string; risk_level: string; status: string; payload: unknown };
type Answer = { answer: string; model: string; stop_reason?: string; tool_calls: ToolCall[]; proposals: Proposal[] };
type Turn = { role: "user" | "assistant"; text: string; answer?: Answer };

const SUGGESTIONS = [
  "How did revenue do in the last 30 days compared with the 30 before?",
  "Why did payments fail this week?",
  "Explain my most recent payout.",
  "Which products sold best this month?",
];

/** Slide-over copilot (§46, §47): read tools run automatically; write tools only produce drafts to confirm. */
export function CopilotPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label="Copilot">
      <div className="absolute inset-0 bg-[rgba(29,31,30,0.22)] backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col p-2 sm:p-3">
        <div className="card flex min-h-0 flex-1 flex-col overflow-hidden shadow-float">
          <CopilotBody onClose={onClose} />
        </div>
      </div>
    </div>
  );
}

function CopilotBody({ onClose }: { onClose: () => void }) {
  const status = useApi<{ configured: boolean; model: string }>("/v1/copilot/status");
  const { live } = useMerchant();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: "user", text: question }]);
    setQ("");
    setBusy(true);
    setError(null);
    try {
      const a = await api<Answer>("/v1/copilot/ask", { body: { question, history } });
      setTurns((t) => [...t, { role: "assistant", text: a.answer, answer: a }]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full lemon-gradient text-lemon-ink"><Icon name="sparkle" size={17} /></span>
          <div>
            <h2 className="text-[16px] font-medium">Copilot</h2>
            <p className="text-[11.5px] text-muted">Answers from your {live ? "live" : "test"} data · drafts need your confirmation</p>
          </div>
        </div>
        <button aria-label="Close copilot" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-muted hover:text-text"><Icon name="close" size={15} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {status.loading && !status.data && <Skeleton className="h-24" />}
        {status.error ? <ErrorNote error={status.error} /> : null}
        {status.data && !status.data.configured && (
          <div className="rounded-inner bg-surface-2 p-5 text-[13.5px] leading-relaxed text-text-2">
            <div className="mb-1 font-medium text-text">Copilot isn&apos;t switched on yet</div>
            The server needs an Anthropic API key (<code className="font-mono text-[12px]">ANTHROPIC_API_KEY</code>) before the copilot can answer. Everything else in the dashboard works as usual.
          </div>
        )}
        {status.data?.configured && turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-[13px] text-muted">Ask about revenue, failed payments, payouts, tax or products. Try:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)} className="block w-full rounded-inner bg-surface-2 px-4 py-3 text-left text-[13.5px] text-text-2 transition hover:bg-surface-3">
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (t.role === "user" ? <UserBubble key={i} text={t.text} /> : <AssistantBubble key={i} answer={t.answer!} />))}
        {busy && (
          <div className="flex items-center gap-2 text-[13px] text-muted" role="status"><Spinner /> Looking at your data…</div>
        )}
        {error ? <ErrorNote error={error} /> : null}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <label htmlFor="copilot-q" className="sr-only">Ask the copilot</label>
        <div className="flex items-end gap-2">
          <Textarea
            id="copilot-q"
            rows={1}
            value={q}
            disabled={!status.data?.configured}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(q);
              }
            }}
            placeholder={status.data?.configured ? "Ask about your business…" : "Copilot unavailable"}
            className="min-h-11 resize-none rounded-[22px]"
          />
          <Button type="submit" disabled={!q.trim() || !status.data?.configured} loading={busy} aria-label="Send" className="h-11 w-11 shrink-0 px-0">
            {!busy && <Icon name="send" size={16} />}
          </Button>
        </div>
      </form>
    </>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-[13.5px] text-white">{text}</div>
    </div>
  );
}

function AssistantBubble({ answer }: { answer: Answer }) {
  return (
    <div className="space-y-2">
      <div className="whitespace-pre-wrap rounded-[20px] rounded-bl-md bg-surface-2 px-4 py-3 text-[13.5px] leading-relaxed text-text">{answer.answer || "No answer returned."}</div>
      {answer.proposals.map((p) => <ProposalCard key={p.id} p={p} />)}
      {answer.tool_calls.length > 0 && (
        <details className="group rounded-inner border border-line px-4 py-2 text-[12.5px]">
          <summary className="cursor-pointer list-none text-muted marker:hidden">
            <span className="inline-flex items-center gap-1"><Icon name="chevron" size={14} className="transition group-open:rotate-180" /> Data used ({answer.tool_calls.length})</span>
          </summary>
          <ul className="mt-2 space-y-2">
            {answer.tool_calls.map((t, i) => (
              <li key={i}>
                <div className="font-medium text-text-2">{titleCase(t.name)}</div>
                <code className="block break-all font-mono text-[11px] text-muted">{JSON.stringify(t.input)}</code>
                <div className="mt-0.5 break-all font-mono text-[11px] text-faint">{t.result_preview}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  const [status, setStatus] = useState(p.status);
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const decide = async (approve: boolean) => {
    setBusy(approve ? "yes" : "no");
    setError(null);
    try {
      const r = await api<{ action?: { status: string }; status?: string; created?: { id: string } }>(`/v1/copilot/actions/${p.id}/confirm`, { body: { approve } });
      setStatus(r.action?.status ?? r.status ?? (approve ? "applied" : "discarded"));
      toast(approve ? `Applied${r.created ? ` · ${r.created.id}` : ""}` : "Draft discarded");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={cx("rounded-inner border p-4", status === "draft" ? "border-lemon bg-lemon-soft/40" : "border-line")}>
      <div className="mb-1 flex items-center gap-2">
        <Chip tone="lemon">Draft</Chip>
        <span className="text-[12px] text-muted">{titleCase(p.kind)}</span>
        <StatusChip status={status} className="ml-auto" />
      </div>
      <p className="text-[13.5px] text-text">{p.summary}</p>
      {status === "draft" && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" loading={busy === "yes"} disabled={!!busy} onClick={() => decide(true)}>Confirm</Button>
          <Button size="sm" variant="ghost" loading={busy === "no"} disabled={!!busy} onClick={() => decide(false)}>Discard</Button>
        </div>
      )}
      {error ? <div className="mt-2"><ErrorNote error={error} /></div> : null}
    </div>
  );
}

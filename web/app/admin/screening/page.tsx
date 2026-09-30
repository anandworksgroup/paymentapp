"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Card, Chip, cx, Empty, ErrorNote, Field, Input, Modal, PageHeader, Segmented, Table, type Tone } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, qs, useAdminQuery, usePagedList } from "@/components/admin/data";
import {
  ConfirmDialog,
  Country,
  EntityLink,
  FilterBar,
  FilterSelect,
  humanize,
  IdTag,
  KV,
  Loadable,
  Mono,
  Notice,
  Num,
  Pager,
  Person,
  ReadOnlyNote,
  SkeletonRows,
  When,
} from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { ListResponse, ScreeningCheck, ScreeningEntry, ScreeningList } from "@/components/admin/types";

export default function ScreeningPage() {
  return (
    <Guard perm="admin.aml.read">
      <Screening />
    </Guard>
  );
}

const RESULTS = [
  { value: "", label: "All results" },
  { value: "clear", label: "Clear" },
  { value: "potential_match", label: "Potential match" },
  { value: "false_positive", label: "False positive" },
  { value: "confirmed_match", label: "Confirmed match" },
];

const RESULT_TONE: Record<string, Tone> = { clear: "sage", potential_match: "peach", false_positive: "neutral", confirmed_match: "rose" };

function ResultChip({ result }: { result: string }) {
  return <Chip tone={RESULT_TONE[result] ?? "neutral"}>{RESULTS.find((r) => r.value === result)?.label ?? humanize(result)}</Chip>;
}

function isSynthetic(source: string) {
  return /synthetic|test|sandbox|sample/i.test(source);
}

/** "Sandbox consolidated test list@2026.09.30,Other@1" → version chips with the list name on hover. */
function ListVersions({ value }: { value: string }) {
  if (!value) return <span className="text-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {value.split(",").map((part) => {
        const at = part.lastIndexOf("@");
        const name = at > 0 ? part.slice(0, at) : part;
        const version = at > 0 ? part.slice(at + 1) : part;
        return (
          <span key={part} title={name}>
            <Chip tone="neutral">{version}</Chip>
          </span>
        );
      })}
    </span>
  );
}

function Subject({ type, id }: { type: string; id: string }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-[11.5px] text-muted">{humanize(type)}</span>
      {type === "beneficial_owner" || id.startsWith("bo_") ? <IdTag id={id} /> : <EntityLink type={type} id={id} />}
    </div>
  );
}

function Screening() {
  const { can, guard } = useAdmin();
  const params = useSearchParams();
  const canAdd = can("admin.config.manage");
  const canRescreen = can("admin.aml.write");

  const lists = useAdminQuery<ListResponse<ScreeningList>>("/screening/lists");
  const [picked, setPicked] = useState<string | null>(null);
  const selected = lists.data?.data.find((l) => l.id === picked) ?? lists.data?.data[0] ?? null;
  const entries = useAdminQuery<ListResponse<ScreeningEntry>>(selected ? `/screening/lists/${encodeURIComponent(selected.id)}/entries` : null);
  const [adding, setAdding] = useState(false);
  const [listNotice, setListNotice] = useState<string | null>(null);

  const [result, setResult] = useState(RESULTS.some((r) => r.value === params.get("result")) ? params.get("result")! : "");
  const checks = usePagedList<ScreeningCheck>(`/screening/checks${qs({ result })}`, 25);
  const [detail, setDetail] = useState<ScreeningCheck | null>(null);
  const [rescreening, setRescreening] = useState(false);
  const [rescreenResult, setRescreenResult] = useState<{ screened: number; potential_matches: number } | null>(null);

  const anySynthetic = (lists.data?.data ?? []).some((l) => isSynthetic(l.source));

  return (
    <>
      <PageHeader
        eyebrow="Financial crime · screening"
        title="Sanctions & PEP screening"
        subtitle="Watchlists, the checks run against them, and periodic rescreening. A potential match is a reason for review, never a determination."
        actions={
          canRescreen ? (
            <Button onClick={() => setRescreening(true)}>Run periodic rescreen</Button>
          ) : (
            <ReadOnlyNote>Rescreening needs the admin.aml.write permission</ReadOnlyNote>
          )
        }
      />

      <div className="space-y-5">
        {anySynthetic && (
          <Notice tone="lemon">
            Sandbox: the lists below contain synthetic test data only. They are not real sanctions or PEP lists and must not be used for real-world screening decisions.
          </Notice>
        )}
        {rescreenResult && (
          <Notice>
            Screened {rescreenResult.screened.toLocaleString("en-US")} · {rescreenResult.potential_matches.toLocaleString("en-US")} potential match
            {rescreenResult.potential_matches === 1 ? "" : "es"}
            {rescreenResult.potential_matches > 0 ? " — each one has an alert waiting for review." : "."}
          </Notice>
        )}

        <Card>
          <CardHeader
            title="Watchlists"
            subtitle="Every list change bumps its version, and each check records the exact list versions it was screened against."
            action={
              canAdd ? (
                selected && (
                  <Button size="sm" onClick={() => setAdding(true)}>
                    Add entry
                  </Button>
                )
              ) : (
                <ReadOnlyNote>Adding entries needs the admin.config.manage permission</ReadOnlyNote>
              )
            }
          />
          {listNotice && (
            <div className="mb-4">
              <Notice>{listNotice}</Notice>
            </div>
          )}
          <Loadable q={lists} skeleton={<SkeletonRows rows={2} />}>
            {(d) =>
              d.data.length === 0 ? (
                <Empty title="No screening lists">No watchlists are loaded, so screening can only return clear results.</Empty>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {d.data.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setPicked(l.id)}
                      aria-pressed={selected?.id === l.id}
                      className={cx(
                        "rounded-inner p-5 text-left transition",
                        selected?.id === l.id ? "bg-surface-2 ring-2 ring-inset ring-ink" : "bg-surface-2 hover:bg-surface-3",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[14px] font-medium text-text">{l.name}</span>
                        {l.active ? <Chip tone="sage">Active</Chip> : <Chip tone="neutral">Inactive</Chip>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {isSynthetic(l.source) ? <Chip tone="lemon">Synthetic sandbox data</Chip> : <Chip tone="neutral">{l.source}</Chip>}
                        <Chip tone="neutral">v{l.version}</Chip>
                      </div>
                      <div className="mt-4">
                        <Num value={l.entries} suffix={l.entries === 1 ? "entry" : "entries"} className="text-[26px]" />
                      </div>
                    </button>
                  ))}
                </div>
              )
            }
          </Loadable>

          {selected && (
            <div className="mt-6">
              <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
                <h3 className="text-[14px] font-medium text-text">Entries · {selected.name}</h3>
                <span className="text-[12px] text-muted">source: {selected.source}</span>
              </div>
              <Loadable q={entries} skeleton={<SkeletonRows rows={3} />}>
                {(e) => (
                  <Table
                    rows={e.data}
                    rowKey={(r) => r.id}
                    empty={<Empty title="This list has no entries" />}
                    columns={[
                      { key: "name", header: "Name", render: (r) => <span className="font-medium text-text">{r.name}</span> },
                      {
                        key: "aliases",
                        header: "Aliases",
                        render: (r) =>
                          r.aliases_csv ? (
                            <span className="flex flex-wrap gap-1">
                              {r.aliases_csv
                                .split("|")
                                .filter(Boolean)
                                .map((a) => (
                                  <Chip key={a} tone="neutral">
                                    {a}
                                  </Chip>
                                ))}
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          ),
                      },
                      { key: "type", header: "Type", render: (r) => <span className="text-text-2">{r.entry_type === "person" ? "Individual" : humanize(r.entry_type)}</span> },
                      { key: "dob", header: "Date of birth", render: (r) => (r.date_of_birth ? <Mono>{r.date_of_birth}</Mono> : <span className="text-faint">—</span>) },
                      { key: "country", header: "Country", render: (r) => (r.country === "ZZ" ? <span className="text-text-2">ZZ · test</span> : <Country code={r.country} />) },
                      { key: "program", header: "Program", render: (r) => (r.program ? <Chip tone="sky">{r.program}</Chip> : <span className="text-faint">—</span>) },
                      { key: "added", header: "Added", render: (r) => <When at={r.created_at} /> },
                    ]}
                  />
                )}
              </Loadable>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Screening checks" subtitle="Every name screened at onboarding, on payouts and withdrawals, and in periodic rescreens. Click a row for the matching logic." />
          <FilterBar>
            <FilterSelect label="Result" value={result} onChange={setResult} options={RESULTS} />
          </FilterBar>
          <Loadable q={checks} skeleton={<SkeletonRows rows={6} />}>
            {() => (
              <>
                <Table
                  rows={checks.rows}
                  rowKey={(r) => r.id}
                  onRowClick={setDetail}
                  empty={<Empty title="No checks match">{result ? "No checks have this result." : "No names have been screened yet."}</Empty>}
                  columns={[
                    { key: "name", header: "Screened name", render: (r) => <span className="font-medium text-text">{r.screened_name}</span> },
                    { key: "subject", header: "Subject", render: (r) => <Subject type={r.subject_type} id={r.subject_id} /> },
                    { key: "context", header: "Context", render: (r) => <span className="text-text-2">{humanize(r.context)}</span> },
                    { key: "list", header: "List version", render: (r) => <ListVersions value={r.list_version} /> },
                    { key: "result", header: "Result", render: (r) => <ResultChip result={r.result} /> },
                    {
                      key: "score",
                      header: "Score",
                      align: "right",
                      render: (r) => (
                        <span className="numeral text-[15px] text-text" title={r.match_logic ?? undefined}>
                          {r.score}
                        </span>
                      ),
                    },
                    { key: "matched", header: "Matched name", render: (r) => (r.matched_name ? <span className="text-text">{r.matched_name}</span> : <span className="text-faint">—</span>) },
                    { key: "alert", header: "Alert", render: (r) => <EntityLink type="alert" id={r.alert_id} /> },
                    { key: "reviewed", header: "Reviewed by", render: (r) => (r.reviewed_by ? <Person id={r.reviewed_by} /> : <span className="text-faint">—</span>) },
                    { key: "created", header: "Screened", render: (r) => <When at={r.created_at} /> },
                  ]}
                />
                <Pager page={checks.page} hasMore={checks.hasMore} onPrev={checks.prev} onNext={checks.next} loading={checks.loading} />
              </>
            )}
          </Loadable>
        </Card>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Screening check" wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[17px] text-text">{detail.screened_name}</span>
              <ResultChip result={detail.result} />
            </div>
            <KV
              cols={3}
              items={[
                ["Check id", <Mono key="id">{detail.id}</Mono>],
                ["Subject", <Subject key="s" type={detail.subject_type} id={detail.subject_id} />],
                ["Context", humanize(detail.context)],
                ["Screened", <When key="w" at={detail.created_at} />],
                ["Score", <span key="sc" className="numeral text-[18px]">{detail.score} <span className="text-[12px] text-muted">/ 100 · review threshold 88</span></span>],
                ["Matched name", detail.matched_name],
                ["Matched entry", detail.matched_entry_id ? <Mono key="me">{detail.matched_entry_id}</Mono> : null],
                ["Alert", detail.alert_id ? <EntityLink key="a" type="alert" id={detail.alert_id} /> : null],
                ["Reviewed by", detail.reviewed_by ? <Person key="rb" id={detail.reviewed_by} /> : null],
              ]}
            />
            <div className="rounded-inner bg-surface-2 p-4">
              <div className="mb-1 text-[12px] text-muted">List versions screened against</div>
              <div className="font-mono text-[12px] text-text-2">{detail.list_version}</div>
            </div>
            <div className="rounded-inner bg-surface-2 p-4">
              <div className="mb-1 text-[12px] text-muted">Matching logic</div>
              <div className="text-[13px] text-text-2">{detail.match_logic ?? "Not recorded."}</div>
            </div>
            {detail.result === "potential_match" && (
              <p className="text-[12.5px] text-muted">A potential match means the name is similar enough to a list entry to need a person&apos;s review. It is not a finding about the subject.</p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={rescreening}
        onClose={() => setRescreening(false)}
        title="Run periodic rescreen?"
        confirmLabel="Run rescreen"
        onConfirm={async () => {
          const r = await guard(() => adminApi<{ screened: number; potential_matches: number }>("/screening/rescreen", { method: "POST" }));
          setRescreenResult(r);
          checks.reload();
        }}
      >
        <p>Rescreens verified users and beneficial owners against the current list versions. New potential matches create alerts for review.</p>
        <p className="text-[12.5px] text-muted">Each person screened gets a new check recording the list versions used. Existing checks and alerts are not changed.</p>
      </ConfirmDialog>

      {adding && selected && (
        <AddEntryModal
          list={selected}
          onClose={() => setAdding(false)}
          onDone={(e) => {
            setAdding(false);
            setListNotice(`${e.name} added to ${selected.name}. The list version has been bumped; checks from now on record the new version.`);
            lists.reload();
            entries.reload();
          }}
        />
      )}
    </>
  );
}

type EntryDraft = { name: string; aliases: string; entry_type: "person" | "entity"; date_of_birth: string; country: string; program: string };

function AddEntryModal({ list, onClose, onDone }: { list: ScreeningList; onClose: () => void; onDone: (e: ScreeningEntry) => void }) {
  const { guard } = useAdmin();
  const [d, setD] = useState<EntryDraft>({ name: "", aliases: "", entry_type: "person", date_of_birth: "", country: "", program: "" });
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof EntryDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setD((x) => ({ ...x, [k]: e.target.value }));

  // The screening engine splits aliases on "|".
  const aliases = d.aliases
    .split(/[\n,|]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  const country = d.country.trim().toUpperCase();
  const errors = {
    name: d.name.trim().length < 2 ? "Enter the listed name." : null,
    country: country && !/^[A-Z]{2}$/.test(country) ? "Two-letter country code, e.g. DE (ZZ for test data)." : null,
  };
  const valid = !errors.name && !errors.country;
  const body = {
    name: d.name.trim(),
    aliases: aliases.length ? aliases.join("|") : null,
    entry_type: d.entry_type,
    date_of_birth: d.entry_type === "person" && d.date_of_birth ? d.date_of_birth : null,
    country: country || null,
    program: d.program.trim() || null,
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const e = await guard(() => adminApi<ScreeningEntry>(`/screening/lists/${encodeURIComponent(list.id)}/entries`, { method: "POST", body }));
      onDone(e);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={step === "edit" ? `Add entry · ${list.name}` : "Review new entry"}
      footer={
        step === "edit" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowErrors(true);
                if (valid) setStep("review");
              }}
            >
              Review entry
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep("edit")} disabled={busy}>
              Back
            </Button>
            <Button onClick={submit} loading={busy}>
              Add to list
            </Button>
          </>
        )
      }
    >
      {step === "edit" ? (
        <div className="space-y-4">
          {isSynthetic(list.source) && <p className="text-[12.5px] text-muted">This is a sandbox list of synthetic test data. Use made-up names only.</p>}
          <div>
            <span className="mb-1.5 block text-[12.5px] font-medium text-text-2">Entry type</span>
            <Segmented
              value={d.entry_type}
              onChange={(v) => setD((x) => ({ ...x, entry_type: v }))}
              options={[
                { value: "person", label: "Individual" },
                { value: "entity", label: "Entity" },
              ]}
            />
          </div>
          <Field label="Listed name" error={showErrors ? errors.name : null}>
            <Input value={d.name} onChange={set("name")} placeholder={d.entry_type === "person" ? "Full name as listed" : "Registered name"} />
          </Field>
          <Field label="Aliases" hint="Optional. Separate with commas.">
            <Input value={d.aliases} onChange={set("aliases")} placeholder="Other spellings or names" />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {d.entry_type === "person" && (
              <Field label="Date of birth" hint="Optional. A mismatch lowers the match score.">
                <Input type="date" value={d.date_of_birth} onChange={set("date_of_birth")} />
              </Field>
            )}
            <Field label="Country" error={showErrors ? errors.country : null} hint="Optional, e.g. DE">
              <Input value={d.country} onChange={set("country")} maxLength={2} className="uppercase" />
            </Field>
          </div>
          <Field label="Program" hint="Optional. Programs containing “PEP” raise PEP alerts; others raise sanctions alerts.">
            <Input value={d.program} onChange={set("program")} placeholder="e.g. TEST-SANCTIONS" />
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <KV
            cols={2}
            items={[
              ["Name", body.name],
              ["Type", body.entry_type === "person" ? "Individual" : "Entity"],
              ["Aliases", aliases.length ? aliases.join(", ") : null],
              ["Date of birth", body.date_of_birth],
              ["Country", body.country],
              ["Program", body.program],
            ]}
          />
          <p className="text-[13.5px] leading-relaxed text-text-2">
            Adding this entry bumps the version of <span className="text-text">{list.name}</span> (currently v{list.version}), so later screening decisions record exactly what they were screened against.
            Existing checks keep the version they used. Names already screened are only compared with this entry at their next screening or a periodic rescreen.
          </p>
          <div className="rounded-[14px] bg-sky-soft px-4 py-3 text-[12.5px] leading-relaxed text-sky-ink">The change is recorded in the audit log with your name and the time. Existing entries are not changed.</div>
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader, Segmented } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { NoAccess } from "@/components/merchant/common";
import { ChurnReport } from "@/components/merchant/ops/ChurnReport";
import { CohortReport } from "@/components/merchant/ops/CohortReport";
import { JournalReport } from "@/components/merchant/ops/JournalReport";
import { RevenueRecognitionReport } from "@/components/merchant/ops/RevenueRecognitionReport";

type Tab = "revenue" | "journal" | "cohorts" | "churn";

const TABS: { value: Tab; label: string; perm: string; subtitle: string }[] = [
  { value: "revenue", label: "Revenue recognition", perm: "reports.read", subtitle: "What you billed, what you earned and what is still deferred, month by month." },
  { value: "journal", label: "Journal", perm: "ledger.read", subtitle: "Balanced debit and credit lines for your accounting system." },
  { value: "cohorts", label: "Cohorts", perm: "analytics.read", subtitle: "How each month's new customers keep paying over time." },
  { value: "churn", label: "Churn", perm: "analytics.read", subtitle: "Cancelled subscriptions and the recurring revenue they took with them." },
];

export default function ReportsPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabs = TABS.filter((t) => can(t.perm));
  if (!tabs.length) return <NoAccess what="finance reports" />;
  const requested = params.get("tab");
  const tab = tabs.find((t) => t.value === requested) ?? tabs[0];
  const select = (v: Tab) => router.replace(`${pathname}?tab=${v}`, { scroll: false });

  return (
    <>
      <PageHeader title="Reports" subtitle={tab.subtitle} />
      <div className="mb-5 overflow-x-auto">
        <Segmented<Tab> value={tab.value} onChange={select} options={tabs.map((t) => ({ value: t.value, label: t.label }))} />
      </div>
      {tab.value === "revenue" && <RevenueRecognitionReport />}
      {tab.value === "journal" && <JournalReport />}
      {tab.value === "cohorts" && <CohortReport />}
      {tab.value === "churn" && <ChurnReport />}
    </>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/ui";
import { Mono, ReadOnlyNote, Tabs } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import { CountriesTab } from "./_countries";
import { FeesTab } from "./_fees";
import { FxTab, LimitsTab } from "./_reference";
import { RulesTab } from "./_rules";
import { TaxTab } from "./_tax";

type Tab = "fees" | "tax" | "rules" | "countries" | "limits" | "fx";
const TABS: Tab[] = ["fees", "tax", "rules", "countries", "limits", "fx"];
const EDITABLE: Tab[] = ["fees", "tax", "rules", "countries"];

export default function ConfigurationPage() {
  return (
    <Guard perm="admin.overview">
      <Configuration />
    </Guard>
  );
}

function Configuration() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAdmin();
  const canManage = can("admin.config.manage");
  const canRules = can("admin.aml.read");
  const fromUrl = params.get("tab") as Tab | null;
  const [picked, setPicked] = useState<Tab>(fromUrl && TABS.includes(fromUrl) ? fromUrl : "fees");
  const tab: Tab = picked === "rules" && !canRules ? "fees" : picked;

  const select = (t: Tab) => {
    setPicked(t);
    router.replace(`/admin/configuration?tab=${t}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        eyebrow="Platform configuration"
        title="Configuration"
        subtitle="Fees, tax, monitoring rules and country capabilities. Every change is confirmed, versioned and recorded in the audit log."
      />
      <Tabs
        value={tab}
        onChange={select}
        tabs={[
          { value: "fees", label: "Fee schedules" },
          { value: "tax", label: "Tax rules" },
          { value: "rules", label: "Monitoring rules", hidden: !canRules },
          { value: "countries", label: "Countries" },
          { value: "limits", label: "Wallet limits" },
          { value: "fx", label: "FX rates" },
        ]}
      />
      {!canManage && EDITABLE.includes(tab) && (
        <div className="mb-4 flex">
          <ReadOnlyNote>
            Read-only · configuration changes need the <Mono>admin.config.manage</Mono> permission.
          </ReadOnlyNote>
        </div>
      )}
      {tab === "fees" && <FeesTab canManage={canManage} />}
      {tab === "tax" && <TaxTab canManage={canManage} />}
      {tab === "rules" && <RulesTab canManage={canManage} />}
      {tab === "countries" && <CountriesTab canManage={canManage} />}
      {tab === "limits" && <LimitsTab />}
      {tab === "fx" && <FxTab />}
    </>
  );
}

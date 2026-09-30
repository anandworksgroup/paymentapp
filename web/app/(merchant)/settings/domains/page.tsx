"use client";

import { useState } from "react";
import type { List } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import { useFeatures } from "@/lib/merchant/platform";
import { Button, Card, Empty, PageHeader, Skeleton } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { Loaded, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { SettingsNav } from "@/components/merchant/settings/shared";
import { AddDomainModal, DomainCard } from "@/components/merchant/ops/DomainCard";
import type { DomainEntry } from "@/components/merchant/ops/types";

export default function DomainsPage() {
  const { can, org } = useMerchant();
  const allowed = can("org.manage");
  const { on, loaded } = useFeatures(org.id);
  const list = useApi<List<DomainEntry>>(allowed ? "/v1/domains" : null);
  const [adding, setAdding] = useState(false);
  const [refused, setRefused] = useState(false);

  if (!allowed) return <NoAccess what="custom domains" />;
  const available = loaded && on("custom_domains") && !refused;

  const replace = (e: DomainEntry) => list.setData((l) => l && { ...l, data: l.data.map((x) => (x.domain.id === e.domain.id ? e : x)) });

  return (
    <>
      <PageHeader
        title="Custom domains"
        subtitle="Serve checkout, the customer portal and payment links on your own domain so buyers stay on your brand."
        actions={available && <Button icon={<Icon name="plus" size={16} />} onClick={() => setAdding(true)}>Add domain</Button>}
      />
      <SettingsNav current="/settings/domains" />
      {loaded && !available && (
        <Card className="mb-5">
          <Empty title="Custom domains aren't available on your account yet" icon={<Icon name="globe" />}>
            We&apos;re rolling custom domains out gradually. Your checkout and portal keep working on the platform domain in the meantime. Contact support if you&apos;d like early access.
          </Empty>
        </Card>
      )}
      <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<Skeleton className="h-64 rounded-card" />}>
        {(l) =>
          l.data.length ? (
            <div className="space-y-5">
              {l.data.map((e) => (
                <DomainCard key={e.domain.id} entry={e} canManage onChange={replace} onRemoved={list.reload} />
              ))}
            </div>
          ) : available ? (
            <Card>
              <Empty title="No custom domains yet" icon={<Icon name="globe" />} action={<Button onClick={() => setAdding(true)}>Add domain</Button>}>
                Add a hostname like pay.yourbrand.com, create two DNS records, and we&apos;ll verify it.
              </Empty>
            </Card>
          ) : null
        }
      </Loaded>
      <Card className="mt-5" pad={false}>
        <p className="px-6 py-4 text-[12.5px] leading-relaxed text-muted">
          Verification looks for the TXT record under <code className="font-mono">_paymentapp-challenge.&lt;your hostname&gt;</code>. Removing a domain stops routing immediately; the record can then be deleted from your DNS.
        </p>
      </Card>
      {adding && <AddDomainModal onClose={() => setAdding(false)} onAdded={() => list.reload()} onUnavailable={() => setRefused(true)} />}
    </>
  );
}

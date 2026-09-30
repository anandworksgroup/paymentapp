"use client";

import { useParams } from "next/navigation";
import { Portal } from "@/components/portal/Portal";

/** Customer self-service portal reached through a signed, expiring link (§24). */
export default function PortalPage() {
  const { token } = useParams<{ token: string }>();
  return <Portal key={token} token={token} />;
}

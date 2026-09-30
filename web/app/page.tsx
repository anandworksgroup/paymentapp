"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { session } from "@/lib/api";
import { Spinner } from "@/components/ui";

/** Entry point: signed-in merchants go to their dashboard, everyone else to sign in. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(session.token ? "/dashboard" : "/login");
  }, [router]);
  return (
    <div className="grid min-h-screen place-items-center text-muted" role="status">
      <Spinner />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

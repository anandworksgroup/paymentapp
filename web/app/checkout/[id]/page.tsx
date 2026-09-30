"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { Checkout } from "@/components/checkout/Checkout";
import { EmbedBridge } from "./EmbedBridge";

/**
 * Hosted checkout page (buyer-facing, no merchant shell). With `?embed=1` it runs inside the
 * /embed.js modal; the bridge reads the query string, so it sits in its own Suspense boundary and the
 * checkout itself still renders on the server as before.
 */
export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <Checkout key={id} id={id} />
      <Suspense fallback={null}>
        <EmbedBridge id={id} />
      </Suspense>
    </>
  );
}

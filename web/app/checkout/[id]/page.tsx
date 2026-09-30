"use client";

import { useParams } from "next/navigation";
import { Checkout } from "@/components/checkout/Checkout";

/** Hosted checkout page (buyer-facing, no merchant shell). */
export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  return <Checkout key={id} id={id} />;
}

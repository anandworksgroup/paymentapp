import { Suspense, type ReactNode } from "react";
import { MerchantGate } from "@/components/merchant/MerchantGate";

/** Authenticated merchant area: session gate, org + mode context and the shell (URS §331). */
export default function MerchantLayout({ children }: { children: ReactNode }) {
  return (
    <MerchantGate>
      <Suspense fallback={null}>{children}</Suspense>
    </MerchantGate>
  );
}

import type { ReactNode } from "react";
import { Barcode } from "@/components/ui";

/**
 * Split layout for sign-in / sign-up in the reference style: a sage gradient story panel with the
 * stacked payment-card visual on the left, a white 28px card with the form on the right.
 */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden p-10 lg:flex lg:flex-col" aria-hidden>
        <div className="sage-gradient absolute inset-4 rounded-[36px]" />
        <div className="relative flex h-full flex-col px-8 py-6">
          <div className="flex items-center gap-2.5 text-[15px] font-medium text-text">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-ink text-[13px] text-white">M</span>
            Monetization Platform
          </div>
          <div className="mt-auto max-w-md">
            <h2 className="text-[44px] font-light leading-[1.05] tracking-[-0.035em] text-text">Sell globally.<br />We handle tax, risk and payouts.</h2>
            <p className="mt-4 text-[15px] text-text-2">Payments, subscriptions, invoices and Merchant-of-Record tax compliance in one calm workspace.</p>
          </div>
          <div className="relative mt-10 h-[230px]">
            {/* Stacked payment cards */}
            <div className="absolute left-10 top-0 h-40 w-72 rotate-[-6deg] rounded-[24px] bg-white/50 shadow-card backdrop-blur" />
            <div className="absolute left-4 top-6 h-44 w-80 rounded-[26px] bg-white/80 p-5 shadow-float backdrop-blur">
              <div className="flex items-start justify-between">
                <span className="text-[12px] text-muted">Your current balance</span>
                <span className="rounded-full bg-lemon px-2.5 py-1 text-[11px] font-medium text-lemon-ink">+1.6%</span>
              </div>
              <div className="numeral mt-3 flex items-baseline gap-1.5 text-[40px] font-light text-text">€8,499 <span className="text-[12px] text-muted">EUR</span></div>
              <div className="mt-4 flex items-end justify-between">
                <span className="text-[12px] text-text-2">•••• 4242</span>
                <Barcode values={[3, 5, 4, 7, 6, 8, 5, 9, 7, 10, 8, 12]} />
              </div>
            </div>
          </div>
        </div>
      </aside>
      <main className="flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-[440px]">
          <div className="mb-6 flex items-center gap-2.5 text-[15px] font-medium lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-ink text-[13px] text-white">M</span>
            Monetization Platform
          </div>
          <div className="card p-7 sm:p-9">
            <h1 className="text-[32px] font-normal leading-tight tracking-[-0.03em]">{title}</h1>
            <p className="mb-7 mt-1.5 text-[14px] text-muted">{subtitle}</p>
            {children}
          </div>
          {footer && <div className="mt-5 text-center text-[13.5px] text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

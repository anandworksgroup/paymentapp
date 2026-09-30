/** Minimal 1.6px-stroke line icons for the admin navigation. */
import type { ReactNode } from "react";

function I({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const Icons = {
  overview: (
    <I>
      <rect x="3" y="3" width="7.5" height="9" rx="2.2" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="2.2" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2.2" />
      <rect x="3" y="15" width="7.5" height="6" rx="2.2" />
    </I>
  ),
  merchants: (
    <I>
      <path d="M4 10h16l-1.2-4.6A2 2 0 0 0 16.9 4H7.1a2 2 0 0 0-1.9 1.4L4 10Z" />
      <path d="M5 10v8.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V10" />
      <path d="M10 20v-5h4v5" />
    </I>
  ),
  users: (
    <I>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 20a6.5 6.5 0 0 0-3-5.5" />
    </I>
  ),
  transactions: (
    <I>
      <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
    </I>
  ),
  movement: (
    <I>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5Z" />
    </I>
  ),
  alerts: (
    <I>
      <path d="M12 4 2.8 19.5h18.4L12 4Z" />
      <path d="M12 10v4.2M12 17.2v.1" />
    </I>
  ),
  cases: (
    <I>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-10Z" />
    </I>
  ),
  approvals: (
    <I>
      <circle cx="8" cy="12" r="4.5" />
      <circle cx="16" cy="12" r="4.5" />
    </I>
  ),
  screening: (
    <I>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2M8.5 11h5" />
    </I>
  ),
  ledger: (
    <I>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" />
      <path d="M9 9h6M9 13h6" />
    </I>
  ),
  recon: (
    <I>
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" />
    </I>
  ),
  payouts: (
    <I>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <circle cx="12" cy="12" r="2.5" />
    </I>
  ),
  providers: (
    <I>
      <rect x="4" y="4" width="16" height="6" rx="2" />
      <rect x="4" y="14" width="16" height="6" rx="2" />
      <path d="M8 7h.01M8 17h.01" />
    </I>
  ),
  config: (
    <I>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </I>
  ),
  audit: (
    <I>
      <path d="M12 3 4.5 6v5.5c0 4.3 3.1 8 7.5 9.5 4.4-1.5 7.5-5.2 7.5-9.5V6L12 3Z" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" />
    </I>
  ),
  health: (
    <I>
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </I>
  ),
  support: (
    <I>
      <path d="M4.5 12a7.5 7.5 0 0 1 15 0" />
      <rect x="3" y="12" width="4" height="6" rx="1.8" />
      <rect x="17" y="12" width="4" height="6" rx="1.8" />
      <path d="M19 18c0 1.7-1.6 2.5-4.5 2.5H12" />
    </I>
  ),
  incidents: (
    <I>
      <path d="M12 3.5 4.5 7v5c0 4.2 3 7.6 7.5 8.9 4.5-1.3 7.5-4.7 7.5-8.9V7L12 3.5Z" />
      <path d="M12 8.5v4.2M12 15.8v.1" />
    </I>
  ),
  files: (
    <I>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5l-5-5Z" />
      <path d="M13.5 3.5v5h5M9 13h6M9 16.5h4" />
    </I>
  ),
  flags: (
    <I>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.5h10.2l-1.9 3.7 1.9 3.8H5.5" />
    </I>
  ),
  search: (
    <I>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </I>
  ),
  menu: (
    <I>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </I>
  ),
  logout: (
    <I>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" />
    </I>
  ),
};

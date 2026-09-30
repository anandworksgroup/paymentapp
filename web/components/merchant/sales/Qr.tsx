"use client";

import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { Button, Modal, Skeleton, cx } from "@/components/ui";
import { CopyButton } from "../common";
import { Icon } from "../icons";

/** Client-rendered QR code for a URL, drawn in the ink colour of the design system. */
export function QrImage({ url, size = 220, label }: { url: string; size?: number; label: string }) {
  const [state, setState] = useState<{ url: string; data: string | null; failed: boolean }>({ url: "", data: null, failed: false });
  useEffect(() => {
    let alive = true;
    const css = getComputedStyle(document.documentElement);
    const dark = css.getPropertyValue("--ink").trim();
    const light = css.getPropertyValue("--surface").trim();
    toDataURL(url, { margin: 1, width: size * 2, errorCorrectionLevel: "M", color: dark && light ? { dark, light } : undefined }).then(
      (data) => alive && setState({ url, data, failed: false }),
      () => alive && setState({ url, data: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [url, size]);
  const current = state.url === url ? state : null;
  if (current?.failed) return <p className="text-[13px] text-muted">The QR code couldn&apos;t be drawn. Share the link instead.</p>;
  if (!current?.data) return <div style={{ width: size, height: size }} aria-busy="true" aria-label="Drawing QR code"><Skeleton className="h-full w-full" /></div>;
  // eslint-disable-next-line @next/next/no-img-element -- a data: URL generated in the browser
  return <img src={current.data} width={size} height={size} alt={label} className="rounded-inner border border-line bg-surface p-2" />;
}

export function QrModal({ url, title, onClose }: { url: string | null; title: string; onClose: () => void }) {
  return (
    <Modal open={!!url} onClose={onClose} title={title}>
      {url && <QrPanel url={url} />}
    </Modal>
  );
}

/** QR + the URL with copy / open / download — used after creating a link and in the QR modal. */
export function QrPanel({ url, compact }: { url: string; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center gap-4", !compact && "py-1")}>
      <div className="grid min-h-[220px] min-w-[220px] place-items-center">
        <QrImage url={url} label={`QR code that opens ${url}`} />
      </div>
      <ShareUrl url={url} />
      <DownloadQr url={url} />
    </div>
  );
}

export function ShareUrl({ url }: { url: string }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 rounded-full bg-surface-2 py-1 pl-4 pr-1">
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text-2" title={url}>{url}</span>
      <CopyButton value={url} label="Copy link" className="bg-surface" />
      <a href={url} target="_blank" rel="noreferrer" aria-label="Open link in a new tab" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface text-text-2 hover:text-text">
        <Icon name="external" size={14} />
      </a>
    </div>
  );
}

function DownloadQr({ url }: { url: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="soft"
      loading={busy}
      icon={<Icon name="download" size={14} />}
      onClick={async () => {
        setBusy(true);
        try {
          const data = await toDataURL(url, { margin: 2, width: 1024 });
          const a = document.createElement("a");
          a.href = data;
          a.download = `qr-${url.split("/").pop() ?? "link"}.png`;
          a.click();
        } finally {
          setBusy(false);
        }
      }}
    >
      Download PNG
    </Button>
  );
}

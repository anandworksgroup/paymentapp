"use client";

import { useState } from "react";
import { Card, CardHeader, Segmented } from "@/components/ui";
import { Help } from "../common";
import { Snippet } from "../developers/shared";
import { APP_ORIGIN } from "../sales/links";
import { API_URL } from "@/lib/api";

type Tab = "button" | "js" | "server";

/** Copy-paste snippets for the embeddable checkout (public/embed.js). */
export function EmbedCheckoutCard() {
  const [tab, setTab] = useState<Tab>("button");
  const script = `<script src="${APP_ORIGIN}/embed.js" async></script>`;
  const snippets: Record<Tab, { title: string; code: string }> = {
    button: {
      title: "HTML",
      code: `${script}

<!-- The session id comes from your server (see "Create the session"). -->
<button data-paymentapp-session="cs_..." data-paymentapp-success-url="/thanks">
  Buy now
</button>`,
    },
    js: {
      title: "JavaScript",
      code: `${script}

<script>
  document.querySelector("#buy").addEventListener("click", async () => {
    const { id } = await fetch("/create-checkout", { method: "POST" }).then((r) => r.json());
    PaymentApp.open({
      session: id,
      onSuccess: ({ payment }) => {
        // Show a thank-you state. Fulfil orders from the checkout.session.completed
        // webhook, not from this callback.
        console.log("paid", payment);
      },
      onClose: ({ completed, reason }) => console.log("closed", completed, reason),
    });
  });
</script>`,
    },
    server: {
      title: "cURL (on your server)",
      code: `curl ${API_URL}/v1/checkout/sessions \\
  -H "Authorization: Bearer sk_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "mode": "payment",
    "line_items": [{ "price_id": "price_...", "quantity": 1 }]
  }'
# → { "id": "cs_...", ... }  pass this id to PaymentApp.open`,
    },
  };

  return (
    <Card>
      <CardHeader title="Embedded checkout" subtitle="Open the hosted checkout in a modal on your own site — card details still never touch your page" />
      <div className="mb-3 overflow-x-auto">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[{ value: "button", label: "HTML button" }, { value: "js", label: "JavaScript" }, { value: "server", label: "Server: create session" }]}
        />
      </div>
      <Snippet title={snippets[tab].title} code={snippets[tab].code} />
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Help>
          <span className="block font-medium text-text-2">Accessible modal</span>
          Focus moves into the dialog and back to your button on close; Escape and the close button dismiss it; it goes full-screen on phones.
        </Help>
        <Help>
          <span className="block font-medium text-text-2">Strict messaging</span>
          The checkout only reports back to the page origin that opened it, and the script only listens to its own iframe from {new URL(APP_ORIGIN).host}.
        </Help>
        <Help>
          <span className="block font-medium text-text-2">Events</span>
          Bound buttons get bubbling <span className="font-mono">paymentapp:success</span> and <span className="font-mono">paymentapp:close</span> events. Always confirm payment with a webhook.
        </Help>
      </div>
    </Card>
  );
}

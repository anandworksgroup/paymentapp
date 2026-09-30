import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWebhook } from "../dist/index.js";

const secret = "whsec_test";
const payload = JSON.stringify({ id: "evt_1", type: "payment.succeeded" });
const sign = (t, s = secret) => createHmac("sha256", s).update(`${t}.${payload}`).digest("hex");

test("accepts a valid signature", () => {
  const t = Math.floor(Date.now() / 1000);
  assert.equal(verifyWebhook(payload, `t=${t},v1=${sign(t)}`, null, secret).id, "evt_1");
});

test("accepts either signature during secret rotation", () => {
  const t = Math.floor(Date.now() / 1000);
  assert.ok(verifyWebhook(payload, `t=${t},v1=${sign(t, "whsec_new")},v1=${sign(t)}`, null, secret));
});

test("rejects tampered payloads and stale timestamps", () => {
  const t = Math.floor(Date.now() / 1000);
  assert.throws(() => verifyWebhook(payload + " ", `t=${t},v1=${sign(t)}`, null, secret), /verification failed/);
  const old = t - 3600;
  assert.throws(() => verifyWebhook(payload, `t=${old},v1=${sign(old)}`, null, secret), /tolerance/);
});

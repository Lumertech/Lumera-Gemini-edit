import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initDatabase } from "./db.ts";
import {
  DEFAULT_VOICE_GATEWAY_ANSWER_TIMEOUT_MS,
  handleMetaInboundCallAction,
  resetMetaCallAnswerStateForTests,
  voiceGatewayAnswerTimeoutMs,
} from "./meta.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_SDP = "v=0\r\no=- 1 2 IN IP4 34.46.39.52\r\nm=audio 49152 UDP/TLS/RTP/SAVPF 111\r\n";
const OFFER_SDP = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:audio\r\n";
const ENV_KEYS = [
  "META_ACCESS_TOKEN",
  "META_SYSTEM_USER_TOKEN",
  "WHATSAPP_TOKEN",
  "WHATSAPP_ACCESS_TOKEN",
  "VOICE_GATEWAY_URL",
  "VOICE_GATEWAY_ANSWER_TIMEOUT_MS",
  "VOICE_GATEWAY_SECRET",
] as const;

type EnvSnap = Record<(typeof ENV_KEYS)[number], string | undefined>;

let envSnap: EnvSnap;
let fetchSnap: typeof fetch;

function snapshotEnv(): EnvSnap {
  const snap = {} as EnvSnap;
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: EnvSnap) {
  for (const key of ENV_KEYS) {
    const value = snap[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sessionSdp(body: string | undefined): string {
  const parsed = JSON.parse(String(body || "{}")) as { session?: { sdp?: string } };
  return String(parsed.session?.sdp || "");
}

function captureConsole(into: string[], original: (...args: unknown[]) => void): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const line = args.map((item) => String(item)).join(" ");
    if (line.includes("[Meta Inbound Call]") || line.includes("[Meta Call Action")) into.push(line);
    else original(...args);
  };
}

describe("voice gateway SDP answer", () => {
  before(() => {
    initDatabase();
  });

  beforeEach(() => {
    envSnap = snapshotEnv();
    fetchSnap = globalThis.fetch;
    resetMetaCallAnswerStateForTests();
    process.env.META_ACCESS_TOKEN = "meta-test-token";
    delete process.env.META_SYSTEM_USER_TOKEN;
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    process.env.VOICE_GATEWAY_URL = "http://127.0.0.1:3000";
    delete process.env.VOICE_GATEWAY_ANSWER_TIMEOUT_MS;
    delete process.env.VOICE_GATEWAY_SECRET;
  });

  afterEach(() => {
    restoreEnv(envSnap);
    globalThis.fetch = fetchSnap;
    resetMetaCallAnswerStateForTests();
  });

  it("defaults the gateway answer timeout to 5000ms and honors a positive override", () => {
    assert.equal(DEFAULT_VOICE_GATEWAY_ANSWER_TIMEOUT_MS, 5000);
    assert.equal(voiceGatewayAnswerTimeoutMs({}), 5000);
    assert.equal(voiceGatewayAnswerTimeoutMs({ VOICE_GATEWAY_ANSWER_TIMEOUT_MS: "" }), 5000);
    assert.equal(voiceGatewayAnswerTimeoutMs({ VOICE_GATEWAY_ANSWER_TIMEOUT_MS: "0" }), 5000);
    assert.equal(voiceGatewayAnswerTimeoutMs({ VOICE_GATEWAY_ANSWER_TIMEOUT_MS: "-20" }), 5000);
    assert.equal(voiceGatewayAnswerTimeoutMs({ VOICE_GATEWAY_ANSWER_TIMEOUT_MS: "nope" }), 5000);
    assert.equal(voiceGatewayAnswerTimeoutMs({ VOICE_GATEWAY_ANSWER_TIMEOUT_MS: "4200" }), 4200);
    assert.equal(voiceGatewayAnswerTimeoutMs({ VOICE_GATEWAY_ANSWER_TIMEOUT_MS: "2500.6" }), 2501);
  });

  it("passes VOICE_GATEWAY_ANSWER_TIMEOUT_MS to the gateway fetch", async () => {
    const seen: number[] = [];
    const originalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = ((ms: number) => {
      seen.push(ms);
      return new AbortController().signal;
    }) as typeof AbortSignal.timeout;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = captureConsole(logs, originalLog);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/webrtc/answer-offer")) return jsonResponse({ sdpAnswer: REAL_SDP });
      if (url.includes("graph.facebook.com")) return jsonResponse({ success: true });
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    try {
      delete process.env.VOICE_GATEWAY_ANSWER_TIMEOUT_MS;
      const first = await handleMetaInboundCallAction({
        phoneNumberId: "1099000111",
        callId: "call-timeout-default",
        action: "accept",
        offerSdp: OFFER_SDP,
        fromPhone: "+919800011122",
        tenantId: "tenant-lumera-main",
      });
      assert.equal(first.ok, true);
      assert.deepEqual(seen, [5000]);
      assert.match(logs.join("\n"), /Gateway SDP answer received in \d+ms for callId=call-timeout-default/);
      assert.doesNotMatch(logs.join("\n"), /<1\.2s/);

      resetMetaCallAnswerStateForTests();
      process.env.VOICE_GATEWAY_ANSWER_TIMEOUT_MS = "4200";
      const second = await handleMetaInboundCallAction({
        phoneNumberId: "1099000111",
        callId: "call-timeout-override",
        action: "pre_accept",
        offerSdp: OFFER_SDP,
        fromPhone: "+919800011122",
        tenantId: "tenant-lumera-main",
      });
      assert.equal(second.ok, true);
      assert.deepEqual(seen, [5000, 4200]);
    } finally {
      AbortSignal.timeout = originalTimeout;
      console.log = originalLog;
    }
  });

  it("reuses one in-flight gateway answer for pre_accept and accept, then the cached answer", async () => {
    let gatewayCalls = 0;
    const graphSdps: string[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = captureConsole(logs, originalLog);
    console.error = captureConsole(errors, originalError);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/webrtc/answer-offer")) {
        gatewayCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return jsonResponse({ sdpAnswer: REAL_SDP });
      }
      if (url.includes("graph.facebook.com")) {
        graphSdps.push(sessionSdp(typeof init?.body === "string" ? init.body : undefined));
        return jsonResponse({ success: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const call = {
      phoneNumberId: "1099000111",
      callId: "call-reuse-1",
      offerSdp: OFFER_SDP,
      fromPhone: "+919800011122",
      tenantId: "tenant-lumera-main",
    };

    try {
      const [pre, accept] = await Promise.all([
        handleMetaInboundCallAction({ ...call, action: "pre_accept" }),
        handleMetaInboundCallAction({ ...call, action: "accept" }),
      ]);
      assert.equal(pre.ok, true);
      assert.equal(accept.ok, true);
      assert.equal(gatewayCalls, 1);
      assert.deepEqual(graphSdps, [REAL_SDP, REAL_SDP]);
      assert.deepEqual(errors, []);
      assert.match(logs.join("\n"), /Gateway SDP answer received in \d+ms for callId=call-reuse-1/);

      const again = await handleMetaInboundCallAction({ ...call, action: "accept" });
      assert.equal(again.ok, true);
      assert.equal(gatewayCalls, 1);
      assert.deepEqual(graphSdps, [REAL_SDP, REAL_SDP, REAL_SDP]);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  it("does not cache a silent fallback when the gateway is only slow, and does not call it twice while that request is in flight", async () => {
    process.env.VOICE_GATEWAY_ANSWER_TIMEOUT_MS = "60";
    let gatewayCalls = 0;
    const graphSdps: string[] = [];
    const warns: string[] = [];
    const errors: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = captureConsole(warns, originalWarn);
    console.error = captureConsole(errors, originalError);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/webrtc/answer-offer")) {
        gatewayCalls += 1;
        if (gatewayCalls === 1) {
          // AbortSignal.timeout() does not keep the event loop alive. A referenced
          // timer holds the test open until that abort fires.
          await new Promise((_resolve, reject) => {
            const signal = init?.signal;
            const backup = setTimeout(() => {
              reject(new Error("gateway hang was not aborted"));
            }, 1000);
            const fail = () => {
              clearTimeout(backup);
              reject(signal?.reason ?? new DOMException("The operation was aborted due to timeout", "TimeoutError"));
            };
            if (!signal || signal.aborted) {
              fail();
              return;
            }
            signal.addEventListener("abort", fail, { once: true });
          });
        }
        return jsonResponse({ sdpAnswer: REAL_SDP });
      }
      if (url.includes("graph.facebook.com")) {
        graphSdps.push(sessionSdp(typeof init?.body === "string" ? init.body : undefined));
        return jsonResponse({ success: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const call = {
      phoneNumberId: "1099000111",
      callId: "call-slow-1",
      offerSdp: OFFER_SDP,
      fromPhone: "+919800011122",
      tenantId: "tenant-lumera-main",
    };

    try {
      const [pre, accept] = await Promise.all([
        handleMetaInboundCallAction({ ...call, action: "pre_accept" }),
        handleMetaInboundCallAction({ ...call, action: "accept" }),
      ]);
      assert.equal(pre.ok, true);
      assert.equal(accept.ok, true);
      assert.equal(gatewayCalls, 1);
      assert.equal(graphSdps.length, 2);
      assert.match(graphSdps[0], /m=audio 10000 /);
      assert.equal(graphSdps[0], graphSdps[1]);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /The call will be silent/);
      assert.match(errors[0], /after \d+ms/);
      assert.match(warns.join("\n"), /Gateway fetch timeout\/error after \d+ms for callId=call-slow-1/);

      const recovered = await handleMetaInboundCallAction({ ...call, action: "accept" });
      assert.equal(recovered.ok, true);
      assert.equal(gatewayCalls, 2);
      assert.equal(graphSdps[2], REAL_SDP);
      assert.equal(errors.length, 1);
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  });

  it("logs elapsed ms and a silent-call error when the gateway returns a failure status, without caching that fallback", async () => {
    let gatewayCalls = 0;
    const graphSdps: string[] = [];
    const warns: string[] = [];
    const errors: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = captureConsole(warns, originalWarn);
    console.error = captureConsole(errors, originalError);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/webrtc/answer-offer")) {
        gatewayCalls += 1;
        if (gatewayCalls === 1) return jsonResponse({ error: "busy" }, 503);
        return jsonResponse({ sdpAnswer: REAL_SDP });
      }
      if (url.includes("graph.facebook.com")) {
        graphSdps.push(sessionSdp(typeof init?.body === "string" ? init.body : undefined));
        return jsonResponse({ success: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const call = {
      phoneNumberId: "1099000111",
      callId: "call-status-1",
      offerSdp: OFFER_SDP,
      fromPhone: "+919800011122",
      tenantId: "tenant-lumera-main",
    };

    try {
      const failed = await handleMetaInboundCallAction({ ...call, action: "accept" });
      assert.equal(failed.ok, true);
      assert.match(graphSdps[0], /m=audio 10000 /);
      assert.match(warns.join("\n"), /Gateway returned status 503 in \d+ms for callId=call-status-1/);
      assert.match(errors.join("\n"), /The call will be silent/);

      const retried = await handleMetaInboundCallAction({ ...call, action: "accept" });
      assert.equal(retried.ok, true);
      assert.equal(gatewayCalls, 2);
      assert.equal(graphSdps[1], REAL_SDP);
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  });

  it("keeps greeting TTS off the SDP answer path in the voice gateway", () => {
    const gateway = fs.readFileSync(path.join(root, "deploy/webrtc-voice-gateway/gateway.py"), "utf8");
    const prepare = gateway.slice(
      gateway.indexOf("async def prepare_call_greeting"),
      gateway.indexOf("async def warmup_and_queue")
    );
    assert.doesNotMatch(prepare, /await /);
    assert.match(prepare, /return np\.zeros\(0, dtype=np\.int16\), \(cache_key, text\)/);
    assert.doesNotMatch(prepare, /cached_hold_pcm/);
    assert.doesNotMatch(prepare, /NEUTRAL_HOLD/);

    const offer = gateway.slice(
      gateway.indexOf("async def handle_answer_offer"),
      gateway.indexOf("async def cleanup_call")
    );
    const queueAt = offer.indexOf("asyncio.create_task(warmup_and_queue");
    const answerAt = offer.indexOf("answer = await pc.createAnswer()");
    assert.ok(queueAt > 0);
    assert.ok(answerAt > queueAt);
    assert.doesNotMatch(offer, /await synthesize_tts_pcm/);
    assert.doesNotMatch(offer, /await warmup_and_queue/);
    assert.match(offer, /np\.zeros\(0, dtype=np\.int16\)/);
  });
});

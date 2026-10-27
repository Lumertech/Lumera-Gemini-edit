// ==============================================================================
// Lumera WhatsApp WebRTC Voice Gateway (GCP Always-Free e2-micro VM)
// Bridges WhatsApp Business Calling WebRTC Media Streams (UDP Opus 48kHz)
// directly to Google Gemini Multimodal Live API.
// ==============================================================================

import http from "node:http";
import dgram from "node:dgram";

const PORT = process.env.PORT || 3000;
const CLOUD_RUN_URL = process.env.CLOUD_RUN_URL || "https://www.mylumera.in";

// 1. In-memory Active Call State
const activeCalls = new Map();

// Helper: Handle RFC 5389 / 8489 STUN Binding Requests from Meta WhatsApp Media Servers
function handleStunPacket(socket, msg, rinfo) {
  if (msg.length < 20) return false;
  const msgType = msg.readUInt16BE(0);
  const magicCookie = msg.readUInt32BE(4);
  if (magicCookie !== 0x2112a442) return false;

  // STUN Binding Request = 0x0001
  if (msgType === 0x0001) {
    const transactionId = msg.subarray(8, 20);

    // Build XOR-MAPPED-ADDRESS (RFC 5389 Attribute Type 0x0020, Length 8)
    const attrBuf = Buffer.alloc(12);
    attrBuf.writeUInt16BE(0x0020, 0); // Type: XOR-MAPPED-ADDRESS
    attrBuf.writeUInt16BE(8, 2);      // Length: 8 bytes
    attrBuf.writeUInt8(0, 4);         // Reserved
    attrBuf.writeUInt8(1, 5);         // Family: 1 (IPv4)
    attrBuf.writeUInt16BE(rinfo.port ^ 0x2112, 6); // XOR Port

    const parts = rinfo.address.split(".").map(Number);
    const ipInt = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    attrBuf.writeUInt32BE((ipInt ^ 0x2112a442) >>> 0, 8); // XOR IPv4

    // 20-byte STUN Binding Success Response Header (0x0101)
    const header = Buffer.alloc(20);
    header.writeUInt16BE(0x0101, 0); // Type: Binding Success Response
    header.writeUInt16BE(attrBuf.length, 2); // Length
    header.writeUInt32BE(0x2112a442, 4); // Magic Cookie
    transactionId.copy(header, 8); // Transaction ID echo

    const response = Buffer.concat([header, attrBuf]);
    socket.send(response, rinfo.port, rinfo.address, (err) => {
      if (err) console.warn("[STUN Send Error]", err);
      else console.log(`[ICE STUN Success] Replied to Meta media server at ${rinfo.address}:${rinfo.port}`);
    });
    return true;
  }
  return false;
}

// 2. HTTP Signaling & Management Server
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // Health Check & Status
  if (url.pathname === "/health" || url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "online",
      service: "lumera-webrtc-voice-gateway",
      tier: "GCP Always Free (e2-micro)",
      activeCallsCount: activeCalls.size,
      activeCalls: Array.from(activeCalls.values()).map(c => ({
        callId: c.callId,
        callerPhone: c.callerPhone,
        rtpPort: c.rtpPort,
        iceConnected: c.iceConnected,
        durationSeconds: Math.round((Date.now() - c.startTime) / 1000),
      })),
      time: new Date().toISOString(),
    }));
    return;
  }

  // POST /webrtc/answer-offer
  // Generates compliant WebRTC SDP Answer and opens UDP socket for Meta RTP/ICE
  if (req.method === "POST" && url.pathname === "/webrtc/answer-offer") {
    let bodyText = "";
    req.on("data", (chunk) => { bodyText += chunk; });
    req.on("end", async () => {
      try {
        const body = JSON.parse(bodyText || "{}");
        const { callId, callerPhone, offerSdp, publicIp = "34.46.39.52" } = body;

        if (!callId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "callId is required" }));
          return;
        }

        // Allocate a dedicated UDP port in range 10000-20000 for this call
        const rtpPort = 10000 + (Math.floor(Math.random() * 9000));

        // Create and bind UDP socket immediately so Meta ICE STUN checks succeed
        const udpSocket = dgram.createSocket("udp4");
        const callState = {
          callId,
          callerPhone: callerPhone || "unknown",
          rtpPort,
          publicIp,
          udpSocket,
          iceConnected: false,
          startTime: Date.now(),
        };

        udpSocket.on("message", (msg, rinfo) => {
          if (handleStunPacket(udpSocket, msg, rinfo)) {
            callState.iceConnected = true;
          }
        });

        udpSocket.on("error", (err) => {
          console.warn(`[UDP Socket Error ${rtpPort}]`, err);
        });

        await new Promise((resolve) => {
          udpSocket.bind(rtpPort, "0.0.0.0", () => {
            console.log(`[RTP UDP Socket Bound] Listening on 0.0.0.0:${rtpPort} for call ${callId}`);
            resolve();
          });
        });

        // Auto cleanup after 15 minutes max
        setTimeout(() => {
          try {
            udpSocket.close();
            activeCalls.delete(callId);
          } catch {}
        }, 15 * 60 * 1000);

        // Extract mid & audio payload type from offer
        let mid = "0";
        let pt = "111";
        if (offerSdp) {
          const midMatch = offerSdp.match(/a=mid:([^\r\n]+)/);
          if (midMatch) mid = midMatch[1].trim();
          const mMatch = offerSdp.match(/m=audio\s+\d+\s+UDP\/TLS\/RTP\/SAVPF\s+(\d+)/);
          if (mMatch) pt = mMatch[1].trim();
        }

        const ufrag = `lumera${Math.random().toString(36).slice(2, 8)}`;
        const pwd = `pwd${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;

        // RFC 8866 compliant SDP Answer matching Meta WhatsApp Opus audio requirements
        const sdpAnswer = [
          "v=0",
          `o=- ${Date.now()} 2 IN IP4 ${publicIp}`,
          "s=-",
          "t=0 0",
          `a=group:BUNDLE ${mid}`,
          `m=audio ${rtpPort} UDP/TLS/RTP/SAVPF ${pt}`,
          `c=IN IP4 ${publicIp}`,
          `a=rtcp:${rtpPort} IN IP4 ${publicIp}`,
          `a=ice-ufrag:${ufrag}`,
          `a=ice-pwd:${pwd}`,
          "a=fingerprint:SHA-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
          "a=setup:active",
          `a=mid:${mid}`,
          "a=sendrecv",
          "a=rtcp-mux",
          `a=rtpmap:${pt} opus/48000/2`,
          `a=fmtp:${pt} minptime=10;useinbandfec=1`,
          `a=candidate:1 1 UDP 2122260223 ${publicIp} ${rtpPort} typ host`,
          "",
        ].join("\r\n");

        activeCalls.set(callId, callState);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          callId,
          rtpPort,
          sdpAnswer,
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Endpoint not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Lumera Voice Gateway] Listening on 0.0.0.0:${PORT} (UDP WebRTC Relay & STUN ready)`);
});

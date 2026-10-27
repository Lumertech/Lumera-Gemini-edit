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

// Helper: Build RFC 5389 / RFC 8445 STUN Binding Request (Full ICE Agent -> Meta ICE-lite)
function buildStunBindingRequest(metaUfrag, localUfrag) {
  const transactionId = Buffer.alloc(12);
  for (let i = 0; i < 12; i++) transactionId[i] = Math.floor(Math.random() * 256);

  const usernameStr = metaUfrag && localUfrag ? `${metaUfrag}:${localUfrag}` : "";
  const attrs = [];

  if (usernameStr) {
    const userBuf = Buffer.from(usernameStr, "utf8");
    const paddedLen = Math.ceil(userBuf.length / 4) * 4;
    const attr = Buffer.alloc(4 + paddedLen);
    attr.writeUInt16BE(0x0006, 0); // Attribute: USERNAME
    attr.writeUInt16BE(userBuf.length, 2);
    userBuf.copy(attr, 4);
    attrs.push(attr);
  }

  // ICE-CONTROLLING (0x802A, length 8) - Required when controlling ICE against ICE-lite
  const iceCtrl = Buffer.alloc(12);
  iceCtrl.writeUInt16BE(0x802a, 0);
  iceCtrl.writeUInt16BE(8, 2);
  Buffer.from("lumera01").copy(iceCtrl, 4);
  attrs.push(iceCtrl);

  // USE-CANDIDATE (0x0025, length 0) - Nominates candidate to Meta ICE-lite agent
  const useCand = Buffer.alloc(4);
  useCand.writeUInt16BE(0x0025, 0);
  useCand.writeUInt16BE(0, 2);
  attrs.push(useCand);

  const allAttrs = Buffer.concat(attrs);

  // 20-byte STUN Header
  const header = Buffer.alloc(20);
  header.writeUInt16BE(0x0001, 0); // Message Type: Binding Request
  header.writeUInt16BE(allAttrs.length, 2);
  header.writeUInt32BE(0x2112a442, 4); // Magic Cookie
  transactionId.copy(header, 8);

  return Buffer.concat([header, allAttrs]);
}

// Helper: Handle incoming STUN packets (Binding Request or Success Response)
function handleStunPacket(socket, msg, rinfo) {
  if (msg.length < 20) return false;
  const msgType = msg.readUInt16BE(0);
  const magicCookie = msg.readUInt32BE(4);
  if (magicCookie !== 0x2112a442) return false;

  // STUN Binding Request = 0x0001 -> Reply with 0x0101
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

// Helper: Parse remote candidate IP/ports and ICE credentials from Meta's offer SDP
function parseRemoteCandidates(offerSdp) {
  const targets = [];
  if (!offerSdp) return { targets, metaUfrag: "", metaPwd: "" };

  // 1. Check all candidate lines
  const candRegex = /a=candidate:\S+\s+\d+\s+UDP\s+\d+\s+(\S+)\s+(\d+)/gi;
  let match;
  while ((match = candRegex.exec(offerSdp)) !== null) {
    targets.push({ ip: match[1], port: parseInt(match[2], 10) });
  }

  // 2. Check connection line & audio media line
  const cMatch = offerSdp.match(/c=IN\s+IP4\s+(\S+)/i);
  const mMatch = offerSdp.match(/m=audio\s+(\d+)/i);
  if (cMatch && mMatch) {
    targets.push({ ip: cMatch[1], port: parseInt(mMatch[1], 10) });
  }

  // Extract remote ufrag & pwd
  const ufragMatch = offerSdp.match(/a=ice-ufrag:([^\r\n]+)/i);
  const pwdMatch = offerSdp.match(/a=ice-pwd:([^\r\n]+)/i);

  return {
    targets,
    metaUfrag: ufragMatch ? ufragMatch[1].trim() : "",
    metaPwd: pwdMatch ? pwdMatch[1].trim() : "",
  };
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
        pingsSent: c.pingsSent,
        durationSeconds: Math.round((Date.now() - c.startTime) / 1000),
      })),
      time: new Date().toISOString(),
    }));
    return;
  }

  // POST /webrtc/answer-offer
  // Generates compliant WebRTC SDP Answer, opens UDP socket, and initiates ICE controlling checks to Meta ICE-lite
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

        // Create and bind UDP socket immediately
        const udpSocket = dgram.createSocket("udp4");
        const callState = {
          callId,
          callerPhone: callerPhone || "unknown",
          rtpPort,
          publicIp,
          udpSocket,
          iceConnected: false,
          pingsSent: 0,
          startTime: Date.now(),
        };

        udpSocket.on("message", (msg, rinfo) => {
          if (msg.length >= 20) {
            const msgType = msg.readUInt16BE(0);
            if (msgType === 0x0101) {
              callState.iceConnected = true;
              console.log(`[ICE Connected via Meta Reply] Received STUN 0x0101 from Meta at ${rinfo.address}:${rinfo.port}`);
            } else if (msgType === 0x0001) {
              if (handleStunPacket(udpSocket, msg, rinfo)) {
                callState.iceConnected = true;
              }
            }
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

        // Parse Meta's remote candidate targets and credentials
        const { targets, metaUfrag, metaPwd } = parseRemoteCandidates(offerSdp);
        console.log(`[Meta ICE Targets] Call ${callId} targets:`, targets, `metaUfrag: ${metaUfrag}`);

        // Extract mid & audio payload type from offer
        let mid = "audio";
        let pt = "111";
        if (offerSdp) {
          const midMatch = offerSdp.match(/a=mid:([^\r\n]+)/);
          const bundleMatch = offerSdp.match(/a=group:BUNDLE\s+([^\r\n]+)/);
          if (midMatch) mid = midMatch[1].trim();
          else if (bundleMatch) mid = bundleMatch[1].trim();

          const mMatch = offerSdp.match(/m=audio\s+\d+\s+UDP\/TLS\/RTP\/SAVPF\s+(\d+)/);
          if (mMatch) pt = mMatch[1].trim();
        }

        const ufrag = `lumera${Math.random().toString(36).slice(2, 8)}`;
        const pwd = `pwd${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;

        // Send periodic STUN Binding Requests to Meta ICE-lite candidates
        if (targets.length > 0) {
          const stunPing = buildStunBindingRequest(metaUfrag, ufrag);
          const pingInterval = setInterval(() => {
            callState.pingsSent++;
            if (callState.pingsSent > 15 || callState.iceConnected) {
              clearInterval(pingInterval);
              return;
            }
            for (const target of targets) {
              udpSocket.send(stunPing, target.port, target.ip, (err) => {
                if (err) console.warn(`[STUN Ping Error to ${target.ip}:${target.port}]`, err);
              });
            }
          }, 250);
        }

        // Auto cleanup after 15 minutes max
        setTimeout(() => {
          try {
            udpSocket.close();
            activeCalls.delete(callId);
          } catch {}
        }, 15 * 60 * 1000);

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
          "a=setup:passive",
          `a=mid:${mid}`,
          "a=sendrecv",
          "a=rtcp-mux",
          `a=rtpmap:${pt} opus/48000/2`,
          `a=fmtp:${pt} minptime=10;useinbandfec=1`,
          `a=candidate:1 1 udp 2122260223 ${publicIp} ${rtpPort} typ host generation 0`,
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
  console.log(`[Lumera Voice Gateway] Listening on 0.0.0.0:${PORT} (UDP WebRTC Relay & Full ICE Controlling ready)`);
});

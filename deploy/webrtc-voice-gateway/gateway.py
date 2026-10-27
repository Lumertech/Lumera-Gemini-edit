#!/usr/bin/env python3
"""
Lumera WhatsApp WebRTC Voice Gateway
Runs on Always-Free GCP Compute Engine e2-micro VM (34.46.39.52:3000)
Handles WebRTC signaling, RFC-compliant ICE, DTLS-SRTP negotiation,
and streams Maya AI Receptionist voice directly into the WhatsApp voice call.
"""

import asyncio
import json
import logging
import os
import re
import time
from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaPlayer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("lumera-voice-gateway")

PORT = int(os.environ.get("PORT", 3000))
PUBLIC_IP = os.environ.get("PUBLIC_IP", "34.46.39.52")
GREETING_FILE = "/opt/lumera-voice/maya_greeting.mp3"

# Active call sessions: callId -> { pc, player, callerPhone, startTime, sdpAnswer }
active_calls = {}

async def ensure_greeting_audio():
    """Generates Maya's natural AI Receptionist voice greeting using Edge TTS if not present."""
    if os.path.exists(GREETING_FILE) and os.path.getsize(GREETING_FILE) > 1000:
        logger.info(f"Greeting audio file exists: {GREETING_FILE} ({os.path.getsize(GREETING_FILE)} bytes)")
        return

    logger.info("Generating Maya AI Receptionist greeting audio...")
    text = (
        "Namaste! Welcome to Lumera Apex Polyclinic. I am Maya, your AI Receptionist. "
        "How can I help you today? Aap Doctor appointment book karna chahte hain, ya clinic timings janna chahte hain?"
    )
    try:
        import edge_tts
        communicate = edge_tts.Communicate(text, "en-IN-NeerjaNeural")
        await communicate.save(GREETING_FILE)
        logger.info(f"Successfully generated {GREETING_FILE} ({os.path.getsize(GREETING_FILE)} bytes)")
    except Exception as e:
        logger.error(f"Failed to generate greeting audio with edge-tts: {e}")

def fix_sdp_candidates(sdp: str, public_ip: str) -> str:
    """Ensures SDP answer advertises the VM's public IP for host candidates and c= line."""
    lines = []
    for line in sdp.split("\r\n"):
        if line.startswith("c=IN IP4"):
            lines.append(f"c=IN IP4 {public_ip}")
        elif line.startswith("a=candidate:"):
            # Replace local IP in candidate line with public IP
            # format: a=candidate:foundation component protocol priority ip port typ type ...
            parts = line.split(" ")
            if len(parts) >= 8 and parts[7] == "host":
                parts[4] = public_ip
                lines.append(" ".join(parts))
            else:
                lines.append(line)
        else:
            lines.append(line)
    return "\r\n".join(lines)

async def handle_health(request):
    calls_summary = [
        {
            "callId": cid,
            "callerPhone": data.get("callerPhone"),
            "duration": int(time.time() - data.get("startTime", time.time())),
            "connectionState": data["pc"].connectionState,
            "iceConnectionState": data["pc"].iceConnectionState,
        }
        for cid, data in active_calls.items()
    ]
    return web.json_response({
        "status": "online",
        "service": "lumera-webrtc-voice-gateway",
        "engine": "aiortc (DTLS-SRTP + Opus audio)",
        "tier": "GCP Always Free (e2-micro)",
        "activeCallsCount": len(active_calls),
        "activeCalls": calls_summary,
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })

async def handle_answer_offer(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    call_id = body.get("callId")
    caller_phone = body.get("callerPhone", "unknown")
    offer_sdp = body.get("offerSdp", "")
    public_ip = body.get("publicIp", PUBLIC_IP)

    if not call_id:
        return web.json_response({"error": "callId is required"}, status=400)

    # Reuse session if callId already exists (e.g. pre_accept followed by accept)
    if call_id in active_calls:
        existing = active_calls[call_id]
        logger.info(f"[{call_id}] Reusing active call session. State: {existing['pc'].connectionState}")
        return web.json_response({
            "ok": True,
            "callId": call_id,
            "sdpAnswer": existing["sdpAnswer"],
        })

    logger.info(f"[{call_id}] Initializing new WebRTC call from {caller_phone}")

    # Create RTCPeerConnection
    pc = RTCPeerConnection()

    # Attach greeting audio track
    player = None
    if os.path.exists(GREETING_FILE):
        try:
            player = MediaPlayer(GREETING_FILE)
            if player.audio:
                pc.addTrack(player.audio)
                logger.info(f"[{call_id}] Attached Maya greeting audio track to WebRTC peer")
        except Exception as e:
            logger.error(f"[{call_id}] Error opening audio player: {e}")

    @pc.on("connectionstatechange")
    def on_connection_state_change():
        logger.info(f"[{call_id}] Connection state changed to: {pc.connectionState}")
        if pc.connectionState in ["failed", "closed"]:
            asyncio.create_task(cleanup_call(call_id))

    @pc.on("iceconnectionstatechange")
    def on_ice_connection_state_change():
        logger.info(f"[{call_id}] ICE connection state changed to: {pc.iceConnectionState}")

    @pc.on("track")
    def on_track(track):
        if track.kind == "audio":
            logger.info(f"[{call_id}] Inbound audio stream received from WhatsApp caller")

    # Set remote offer
    offer = RTCSessionDescription(sdp=offer_sdp, type="offer")
    await pc.setRemoteDescription(offer)

    # Create SDP answer
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    # Replace local candidate IPs with VM's public IP
    raw_sdp = pc.localDescription.sdp
    final_sdp = fix_sdp_candidates(raw_sdp, public_ip)

    # Store active call
    active_calls[call_id] = {
        "pc": pc,
        "player": player,
        "callerPhone": caller_phone,
        "startTime": time.time(),
        "sdpAnswer": final_sdp,
    }

    # Automatically clean up after 15 minutes max
    asyncio.get_event_loop().call_later(900, lambda: asyncio.create_task(cleanup_call(call_id)))

    logger.info(f"[{call_id}] Generated compliant SDP answer with DTLS-SRTP & Opus audio")

    return web.json_response({
        "ok": True,
        "callId": call_id,
        "sdpAnswer": final_sdp,
    })

async def cleanup_call(call_id: str):
    if call_id in active_calls:
        data = active_calls.pop(call_id)
        logger.info(f"[{call_id}] Cleaning up call session")
        try:
            await data["pc"].close()
        except Exception:
            pass

async def init_app():
    await ensure_greeting_audio()
    app = web.Application()
    app.router.add_get("/", handle_health)
    app.router.add_get("/health", handle_health)
    app.router.add_post("/webrtc/answer-offer", handle_answer_offer)
    return app

if __name__ == "__main__":
    web.run_app(init_app(), host="0.0.0.0", port=PORT)

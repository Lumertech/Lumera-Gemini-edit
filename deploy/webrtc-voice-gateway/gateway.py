#!/usr/bin/env python3
"""
Lumera WhatsApp WebRTC Voice Gateway
Runs on Always-Free GCP Compute Engine e2-micro VM (34.46.39.52:3000)
Handles WebRTC signaling, RFC-compliant ICE, DTLS-SRTP negotiation,
and streams Maya AI Receptionist voice with continuous frame pacing into WhatsApp voice calls.
"""

import asyncio
import fractions
import json
import logging
import os
import re
import time
from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription, AudioStreamTrack
import av
from av import AudioFrame, AudioResampler
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("lumera-voice-gateway")

PORT = int(os.environ.get("PORT", 3000))
PUBLIC_IP = os.environ.get("PUBLIC_IP", "34.46.39.52")
GREETING_FILE = "/opt/lumera-voice/maya_greeting.mp3"

# Preloaded greeting PCM in memory (48kHz mono 16-bit)
cached_greeting_pcm = np.zeros(0, dtype=np.int16)

# Active call sessions: callId -> { pc, track, callerPhone, startTime, sdpAnswer }
active_calls = {}

def load_audio_pcm(file_path: str, target_sample_rate: int = 48000) -> np.ndarray:
    """Decodes and resamples any audio file into 48kHz mono 16-bit PCM for WebRTC Opus."""
    try:
        container = av.open(file_path)
        resampler = AudioResampler(format="s16", layout="mono", rate=target_sample_rate)
        chunks = []
        for frame in container.decode(audio=0):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().flatten())
        if chunks:
            pcm = np.concatenate(chunks).astype(np.int16)
            logger.info(f"Loaded audio PCM: {len(pcm)} samples ({len(pcm) / target_sample_rate:.2f}s) at {target_sample_rate}Hz")
            return pcm
    except Exception as e:
        logger.error(f"Error loading audio PCM from {file_path}: {e}")
    return np.zeros(0, dtype=np.int16)

class MayaVoiceTrack(AudioStreamTrack):
    """
    WebRTC Audio Track that streams Maya's voice greeting at exact 20ms intervals,
    then seamlessly transitions to continuous comfort noise / silence frames
    so Meta never disconnects the call due to media silence.
    """
    kind = "audio"

    def __init__(self, pcm_data: np.ndarray, sample_rate: int = 48000):
        super().__init__()
        self.sample_rate = sample_rate
        self.samples_per_frame = 960  # 20ms at 48000Hz
        self.pcm = pcm_data
        self.cursor = 0
        self.pts = 0
        self._start_time = None

    async def recv(self):
        # Precise 20ms WebRTC clock pacing
        if self._start_time is None:
            self._start_time = time.time()
        else:
            expected_time = self._start_time + (self.pts / self.sample_rate)
            delay = expected_time - time.time()
            if delay > 0:
                await asyncio.sleep(delay)

        # 960 samples per frame
        if self.cursor < len(self.pcm):
            chunk = self.pcm[self.cursor : self.cursor + self.samples_per_frame]
            if len(chunk) < self.samples_per_frame:
                chunk = np.pad(chunk, (0, self.samples_per_frame - len(chunk)))
            self.cursor += self.samples_per_frame
        else:
            # Keep media session active with continuous silence frames
            chunk = np.zeros(self.samples_per_frame, dtype=np.int16)

        frame = AudioFrame.from_ndarray(chunk.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = self.sample_rate
        frame.pts = self.pts
        frame.time_base = fractions.Fraction(1, self.sample_rate)
        self.pts += self.samples_per_frame
        return frame

async def ensure_greeting_audio():
    """Generates Maya's natural AI Receptionist voice greeting using Edge TTS if not present."""
    global cached_greeting_pcm
    if not os.path.exists(GREETING_FILE) or os.path.getsize(GREETING_FILE) < 1000:
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

    if os.path.exists(GREETING_FILE):
        cached_greeting_pcm = load_audio_pcm(GREETING_FILE, 48000)

def fix_sdp_candidates(sdp: str, public_ip: str) -> str:
    """Ensures SDP answer advertises the VM's public IP for host candidates and c= line."""
    lines = []
    for line in sdp.split("\r\n"):
        if line.startswith("c=IN IP4"):
            lines.append(f"c=IN IP4 {public_ip}")
        elif line.startswith("a=candidate:"):
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
        "engine": "aiortc (Continuous 48kHz Opus Audio Stream)",
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

    # Reuse session if callId already exists (pre_accept followed by accept)
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

    # Attach Maya Voice Track with preloaded 48kHz PCM
    track = MayaVoiceTrack(cached_greeting_pcm, 48000)
    pc.addTrack(track)
    logger.info(f"[{call_id}] Attached MayaVoiceTrack (continuous 48kHz Opus) to WebRTC peer")

    @pc.on("connectionstatechange")
    def on_connection_state_change():
        logger.info(f"[{call_id}] PeerConnection state changed to: {pc.connectionState}")
        if pc.connectionState in ["failed", "closed"]:
            asyncio.create_task(cleanup_call(call_id))

    @pc.on("iceconnectionstatechange")
    def on_ice_connection_state_change():
        logger.info(f"[{call_id}] ICE state changed to: {pc.iceConnectionState}")

    @pc.on("track")
    def on_track(inbound_track):
        if inbound_track.kind == "audio":
            logger.info(f"[{call_id}] Inbound caller audio stream active")

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
        "track": track,
        "callerPhone": caller_phone,
        "startTime": time.time(),
        "sdpAnswer": final_sdp,
    }

    # Automatically clean up after 15 minutes max
    asyncio.get_event_loop().call_later(900, lambda: asyncio.create_task(cleanup_call(call_id)))

    logger.info(f"[{call_id}] Generated compliant SDP answer with DTLS-SRTP & 48kHz Opus stream")

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

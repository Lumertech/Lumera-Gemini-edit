#!/usr/bin/env python3
"""
Lumera WhatsApp WebRTC Voice Gateway
Runs on Always-Free GCP Compute Engine e2-micro VM (34.46.39.52:3000)
Handles WebRTC signaling, RFC-compliant ICE, DTLS-SRTP negotiation,
streams Maya AI Receptionist voice into WhatsApp voice calls, listens to caller speech,
and cognitively responds in real time using Gemini AI.
"""

import asyncio
import base64
import fractions
import io
import json
import logging
import os
import re
import time
import wave
import aiohttp
from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
import av
from av import AudioFrame, AudioResampler
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("lumera-voice-gateway")

PORT = int(os.environ.get("PORT", 3000))
PUBLIC_IP = os.environ.get("PUBLIC_IP", "34.46.39.52")
GREETING_FILE = "/opt/lumera-voice/maya_greeting.mp3"
LUMERA_API_URL = os.environ.get("LUMERA_API_URL", "https://www.mylumera.in/api/voice/inbound")

# Preloaded greeting PCM in memory (48kHz mono 16-bit)
cached_greeting_pcm = np.zeros(0, dtype=np.int16)

# Active call sessions: callId -> { pc, track, callerPhone, startTime, sdpAnswer, listenerTask }
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

def decode_mp3_bytes_to_pcm(audio_bytes: bytes, target_sample_rate: int = 48000) -> np.ndarray:
    """Decodes MP3 byte stream into 48kHz mono 16-bit PCM."""
    try:
        bio = io.BytesIO(audio_bytes)
        container = av.open(bio, format="mp3")
        resampler = AudioResampler(format="s16", layout="mono", rate=target_sample_rate)
        chunks = []
        for frame in container.decode(audio=0):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().flatten())
        if chunks:
            return np.concatenate(chunks).astype(np.int16)
    except Exception as e:
        logger.error(f"Error decoding MP3 bytes to PCM: {e}")
    return np.zeros(0, dtype=np.int16)

class MayaVoiceTrack(MediaStreamTrack):
    """
    WebRTC Audio Track that streams Maya's voice greeting at exact 20ms intervals,
    then seamlessly transitions to continuous comfort noise / silence frames
    so Meta never disconnects the call due to media silence.
    Allows queuing new speech responses in real time.
    """
    kind = "audio"

    def __init__(self, pcm_data: np.ndarray, sample_rate: int = 48000):
        super().__init__()
        self.sample_rate = sample_rate
        self.samples_per_frame = 960  # 20ms at 48000Hz
        self.pcm = pcm_data.copy()
        self.cursor = 0
        self.pts = 0
        self._start_time = None
        self._speech_start_time = time.time() if len(self.pcm) > 0 else 0.0

    def is_speaking(self) -> bool:
        """Returns True if Maya is currently streaming voice audio (not silence)."""
        return self.cursor < len(self.pcm)

    def speech_elapsed_s(self) -> float:
        """Returns seconds elapsed since current speech chunk started playing."""
        if not self.is_speaking():
            return 0.0
        return max(0.0, time.time() - self._speech_start_time)

    def queue_audio(self, new_pcm: np.ndarray, replace: bool = True):
        """Queues new audio PCM (Maya's cognitive voice response) to be played into WebRTC."""
        if len(new_pcm) == 0:
            return
        if replace or self.cursor >= len(self.pcm):
            self.pcm = new_pcm.copy()
            self.cursor = 0
        else:
            self.pcm = np.concatenate([self.pcm[:self.cursor], new_pcm])
        self._speech_start_time = time.time()
        logger.info(f"Queued {len(new_pcm)} samples ({len(new_pcm)/self.sample_rate:.2f}s) of Maya voice audio (replace={replace})")

    def interrupt(self):
        """Stops playing current speech immediately."""
        self.cursor = len(self.pcm)
        self._speech_start_time = 0.0

    async def recv(self):
        # Precise 20ms WebRTC clock pacing with drift recovery
        if self._start_time is None:
            self._start_time = time.time()
            self._frame_count = 0

        self._frame_count += 1
        expected_time = self._start_time + (self._frame_count * 0.020)
        delay = expected_time - time.time()
        if delay < -0.100:
            self._start_time = time.time()
            self._frame_count = 0
            delay = 0.020

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
    """Preloads Maya's Google Cloud Neural2 AI Receptionist voice greeting."""
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
        logger.info(f"Preloaded Maya greeting into memory: {len(cached_greeting_pcm)/48000:.2f}s")

def _encode_wav_sync(pcm: np.ndarray) -> str:
    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(pcm.tobytes())
    return base64.b64encode(wav_io.getvalue()).decode("utf-8")

async def handle_caller_utterance(call_id: str, pcm_16k: np.ndarray, out_track: MayaVoiceTrack, caller_phone: str):
    """Encodes caller speech to WAV, queries Lumera Gemini AI, synthesizes TTS, and queues audio to caller."""
    try:
        loop = asyncio.get_event_loop()
        # 1. Encode 16kHz mono PCM into in-memory WAV on worker thread (non-blocking)
        audio_b64 = await loop.run_in_executor(None, _encode_wav_sync, pcm_16k)

        # 2. Retrieve ongoing conversation history and tenantId for this call
        conv_history = []
        tenant_id = "tenant-lumera-main"
        if call_id in active_calls:
            conv_history = active_calls[call_id].get("history", [])
            tenant_id = active_calls[call_id].get("tenantId", "tenant-lumera-main")

        # 3. Send to Lumera Cloud Run cognitive brain
        headers = {
            "Content-Type": "application/json",
            "Origin": "https://www.mylumera.in"
        }
        async with aiohttp.ClientSession(headers=headers) as session:
            payload = {
                "from": caller_phone or "+919999973271",
                "audioBase64": audio_b64,
                "mimeType": "audio/wav",
                "callerName": "Patient",
                "tenantId": tenant_id,
                "conversationHistory": conv_history,
            }
            logger.info(f"[{call_id}] Sending caller speech ({len(pcm_16k)/16000:.2f}s) for tenant {tenant_id} to Lumera AI...")
            async with session.post(LUMERA_API_URL, json=payload, timeout=aiohttp.ClientTimeout(total=18)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    speech_text = data.get("speechText", "")
                    intent = data.get("intent", "INQUIRY")
                    transcript = data.get("transcript", "")
                    logger.info(f"[{call_id}] Caller said: \"{transcript}\" | Maya reply ({intent}): \"{speech_text}\"")

                    if transcript and call_id in active_calls:
                        active_calls[call_id]["history"].append({"role": "caller", "text": transcript})

                    if not speech_text and len(pcm_16k) >= 9600:
                        logger.warn(f"[{call_id}] Lumera AI returned empty speechText. Using polite clarification fallback.")
                        speech_text = "I'm sorry, I couldn't hear that clearly. Could you please repeat?"

                    if speech_text:
                        if call_id in active_calls:
                            active_calls[call_id]["history"].append({"role": "maya", "text": speech_text})

                        resp_audio_bytes = b""
                        if data.get("audioBase64"):
                            try:
                                resp_audio_bytes = base64.b64decode(data["audioBase64"])
                                logger.info(f"[{call_id}] Received Google Cloud Neural2 audio ({len(resp_audio_bytes)} bytes)")
                            except Exception as b64_err:
                                logger.warn(f"[{call_id}] Error decoding audioBase64: {b64_err}")

                        # Fallback to edge-tts if audioBase64 is absent
                        if not resp_audio_bytes:
                            import edge_tts
                            communicate = edge_tts.Communicate(speech_text, "en-IN-NeerjaNeural")
                            async for chunk in communicate.stream():
                                if chunk["type"] == "audio":
                                    resp_audio_bytes += chunk["data"]

                        # Decode into 48kHz mono 16-bit PCM asynchronously on worker thread (non-blocking)
                        resp_pcm = await loop.run_in_executor(None, decode_mp3_bytes_to_pcm, resp_audio_bytes, 48000)
                        if len(resp_pcm) > 0:
                            out_track.queue_audio(resp_pcm, replace=True)
                            logger.info(f"[{call_id}] Streaming Maya's response into call ({len(resp_pcm)/48000:.2f}s)")
                else:
                    err_txt = await resp.text()
                    logger.warn(f"[{call_id}] Lumera AI returned HTTP {resp.status}: {err_txt}")
    except Exception as e:
        logger.error(f"[{call_id}] Error handling caller utterance: {repr(e)}")

async def process_inbound_audio(call_id: str, inbound_track, out_track: MayaVoiceTrack, caller_phone: str):
    """Listens to caller audio, detects speech activity (VAD), and routes utterances to Gemini."""
    logger.info(f"[{call_id}] Started inbound audio listener loop for caller: {caller_phone}")
    resampler = AudioResampler(format="s16", layout="mono", rate=16000)

    buffer = []
    is_speaking = False
    silence_frames = 0
    speech_frames = 0
    interruption_frames = 0
    min_speech_frames = 15        # ~300ms of speech minimum
    silence_threshold_frames = 45 # ~900ms of silence for natural human pauses without chopping
    energy_threshold = 350        # RMS amplitude threshold for speech detection
    max_speech_frames = 600       # ~12 seconds cap on single speech utterance
    is_processing = False         # Lock to prevent overlapping queries
    pending_utterance = None      # Buffer continuation if caller speaks while Gemini is answering

    try:
        while True:
            frame = await inbound_track.recv()
            if not frame:
                break

            maya_talking = out_track.is_speaking()

            for resampled in resampler.resample(frame):
                data = resampled.to_ndarray().flatten()
                rms = np.sqrt(np.mean(data.astype(np.float32) ** 2))

                # If Maya is speaking:
                # 1. Do NOT interrupt during the first 1.8 seconds (grace period to eliminate initial speaker echo spike)
                # 2. Require sustained loud caller speech: at least 10 consecutive frames (200ms) with RMS > 2000
                #    (acoustic echo spikes are usually 1-2 frames; human caller speaking over Maya is sustained and loud)
                if maya_talking:
                    if out_track.speech_elapsed_s() > 1.8 and rms > 2000:
                        interruption_frames += 1
                        if interruption_frames >= 10:
                            logger.info(f"[{call_id}] Caller sustained speech interrupted Maya (RMS: {rms:.0f}, frames: {interruption_frames})")
                            out_track.interrupt()
                            maya_talking = False
                            is_speaking = True
                            buffer = [data]
                            speech_frames = 10
                            silence_frames = 0
                            interruption_frames = 0
                    else:
                        interruption_frames = 0
                    continue

                interruption_frames = 0

                if rms > energy_threshold:
                    if not is_speaking:
                        logger.info(f"[{call_id}] Caller speech started (RMS: {rms:.0f})")
                        is_speaking = True
                        buffer = []
                        speech_frames = 0
                    buffer.append(data)
                    speech_frames += 1
                    silence_frames = 0
                    if speech_frames >= max_speech_frames:
                        logger.info(f"[{call_id}] Utterance hit 12s cap, finalizing...")
                        silence_frames = silence_threshold_frames + 1
                else:
                    if is_speaking:
                        buffer.append(data)
                        silence_frames += 1
                        if silence_frames > silence_threshold_frames:
                            if speech_frames >= min_speech_frames:
                                complete_pcm = np.concatenate(buffer)
                                duration_s = len(complete_pcm) / 16000.0
                                logger.info(f"[{call_id}] Speech utterance captured: {duration_s:.2f}s ({len(complete_pcm)} samples)")
                                
                                if not is_processing:
                                    is_processing = True

                                    async def run_utterance(b_pcm):
                                        nonlocal is_processing, pending_utterance
                                        try:
                                            await handle_caller_utterance(call_id, b_pcm, out_track, caller_phone)
                                        finally:
                                            is_processing = False
                                            if pending_utterance is not None:
                                                next_pcm = pending_utterance
                                                pending_utterance = None
                                                is_processing = True
                                                asyncio.create_task(run_utterance(next_pcm))

                                    asyncio.create_task(run_utterance(complete_pcm))
                                else:
                                    logger.info(f"[{call_id}] Storing speech utterance as pending while previous completes")
                                    pending_utterance = complete_pcm

                            buffer = []
                            is_speaking = False
                            silence_frames = 0
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"[{call_id}] Inbound audio listener loop exception: {repr(e)}")

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
        "engine": "aiortc (Continuous 48kHz Opus Audio Stream + Bidirectional Cognitive Speech)",
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
    caller_phone = body.get("callerPhone", "+919999973271")
    tenant_id = body.get("tenantId", "tenant-lumera-main")
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

    listener_task = None

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
        nonlocal listener_task
        if inbound_track.kind == "audio":
            logger.info(f"[{call_id}] Inbound caller audio stream active - starting listener")
            listener_task = asyncio.create_task(process_inbound_audio(call_id, inbound_track, track, caller_phone))

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
        "tenantId": tenant_id,
        "startTime": time.time(),
        "history": [],
        "sdpAnswer": final_sdp,
        "listenerTask": listener_task,
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
        if data.get("listenerTask") and not data["listenerTask"].done():
            data["listenerTask"].cancel()
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

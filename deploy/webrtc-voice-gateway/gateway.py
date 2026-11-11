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
import hmac
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
LUMERA_API_URL = os.environ.get("LUMERA_API_URL", "https://www.mylumera.in/api/voice/inbound")
VOICE_GATEWAY_SECRET = os.environ.get("VOICE_GATEWAY_SECRET", "").strip()
NEUTRAL_HOLD_TEXT = "Namaste, one moment please."

# Preloaded neutral hold and conversational filler PCM (48kHz mono 16-bit).
# The hold clip is the only audio played before a clinic greeting is ready.
cached_hold_pcm = np.zeros(0, dtype=np.int16)
cached_filler_pcm = np.zeros(0, dtype=np.int16)
HOLD_FILE = "/opt/lumera-voice/maya_hold.mp3"
FILLER_FILE = "/opt/lumera-voice/maya_filler.mp3"

# Active call sessions: callId -> { pc, track, callerPhone, startTime, sdpAnswer, listenerTask }
active_calls = {}

class SileroVAD:
    """Neural Voice Activity Detector using Silero ONNX v5 with context buffer. Detects speech accurately across accents and noise."""
    def __init__(self, model_path="/opt/lumera-voice/models/silero_vad.onnx", sample_rate=16000):
        self.session = None
        self.sample_rate = sample_rate
        self.context_size = 64
        self._sr = np.array([sample_rate], dtype=np.int64)
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.context = np.zeros((1, self.context_size), dtype=np.float32)
        try:
            import onnxruntime as ort
            if os.path.exists(model_path):
                opts = ort.SessionOptions()
                opts.inter_op_num_threads = 1
                opts.intra_op_num_threads = 1
                self.session = ort.InferenceSession(model_path, sess_options=opts)
                logger.info(f"Silero VAD Neural Engine initialized successfully from {model_path}")
            else:
                logger.warning(f"Silero VAD model not found at {model_path}, using fallback RMS")
        except Exception as e:
            logger.warning(f"Could not load Silero VAD ({e}), using fallback RMS")

    def reset(self):
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.context = np.zeros((1, self.context_size), dtype=np.float32)

    def is_speech(self, audio_chunk_16k: np.ndarray, threshold: float = 0.40) -> bool:
        """Returns True if chunk contains human speech. Expects 512 samples (~32ms) at 16kHz."""
        rms = float(np.sqrt(np.mean(audio_chunk_16k.astype(np.float32) ** 2)))
        if self.session is None or len(audio_chunk_16k) < 512:
            return rms > 300

        try:
            # Silero VAD v5 requires preceding context concatenated with current 512-sample chunk
            chunk = audio_chunk_16k[:512].astype(np.float32) / 32768.0
            if chunk.ndim == 1:
                chunk = np.expand_dims(chunk, axis=0)

            x = np.concatenate([self.context, chunk], axis=1)
            inputs = {
                "input": x,
                "sr": self._sr,
                "state": self.state
            }
            out, next_state = self.session.run(None, inputs)
            self.state = next_state
            self.context = x[:, -self.context_size:]
            prob = float(out.item())
            # Dual validation: neural probability with soft energy guard
            return prob >= threshold or (prob >= 0.25 and rms > 600)
        except Exception as err:
            logger.warning(f"Silero VAD evaluation error: {err}")
            return rms > 300

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

    def queue_audio(self, new_pcm: np.ndarray, replace: bool = True, after_current: bool = False):
        """Queues new audio PCM (Maya's cognitive voice response) to be played into WebRTC."""
        if len(new_pcm) == 0:
            return
        if after_current:
            self.pcm = np.concatenate([self.pcm, new_pcm])
        elif replace or self.cursor >= len(self.pcm):
            self.pcm = new_pcm.copy()
            self.cursor = 0
        else:
            self.pcm = np.concatenate([self.pcm[:self.cursor], new_pcm])
        self._speech_start_time = time.time()
        logger.info(f"Queued {len(new_pcm)} samples ({len(new_pcm)/self.sample_rate:.2f}s) of Maya voice audio (replace={replace}, after_current={after_current})")

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
    """Preloads a neutral hold clip and conversational fillers. Never a named-clinic greeting."""
    global cached_hold_pcm, cached_filler_pcm
    if not os.path.exists(HOLD_FILE) or os.path.getsize(HOLD_FILE) < 1000:
        logger.info("Generating neutral hold clip...")
        try:
            import edge_tts
            communicate = edge_tts.Communicate(NEUTRAL_HOLD_TEXT, "en-IN-NeerjaNeural")
            await communicate.save(HOLD_FILE)
            logger.info(f"Successfully generated {HOLD_FILE} ({os.path.getsize(HOLD_FILE)} bytes)")
        except Exception as e:
            logger.error(f"Failed to generate neutral hold clip with edge-tts: {e}")

    if os.path.exists(HOLD_FILE):
        cached_hold_pcm = load_audio_pcm(HOLD_FILE, 48000)
        logger.info(f"Preloaded neutral hold clip into memory: {len(cached_hold_pcm)/48000:.2f}s")

    # Preload natural conversational filler ("Ji, ek second main check karti hoon...")
    if not os.path.exists(FILLER_FILE) or os.path.getsize(FILLER_FILE) < 1000:
        logger.info("Generating Maya conversational filler audio...")
        filler_text = "Ji, ek second main check karti hoon."
        try:
            import edge_tts
            communicate = edge_tts.Communicate(filler_text, "en-IN-NeerjaNeural")
            await communicate.save(FILLER_FILE)
            logger.info(f"Successfully generated {FILLER_FILE}")
        except Exception as e:
            logger.error(f"Failed to generate filler audio: {e}")

    if os.path.exists(FILLER_FILE):
        cached_filler_pcm = load_audio_pcm(FILLER_FILE, 48000)
        logger.info(f"Preloaded conversational filler into memory: {len(cached_filler_pcm)/48000:.2f}s")

tenant_greetings: dict = {}

def clinic_greeting_text(clinic_name: str = "", receptionist_name: str = "", custom_greeting: str = "") -> str:
    """Patient-facing greeting. Clinic and receptionist names are variables. Missing name stays neutral."""
    if custom_greeting and custom_greeting.strip():
        return custom_greeting.strip()
    rec_name = receptionist_name.strip() or "Maya"
    cl_name = clinic_name.strip() or "the clinic"
    return (
        f"Hello! Welcome to {cl_name}. I am {rec_name}, your AI Receptionist. "
        "How can I help you today? Would you like to book an appointment or check clinic timings?"
    )

async def synthesize_tts_pcm(text: str) -> np.ndarray:
    try:
        import edge_tts
        communicate = edge_tts.Communicate(text, "en-IN-NeerjaNeural")
        audio_bytes = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_bytes += chunk["data"]
        return decode_mp3_bytes_to_pcm(audio_bytes, 48000)
    except Exception as e:
        logger.error(f"Failed to synthesize greeting: {e}")
        return np.zeros(0, dtype=np.int16)

async def prepare_call_greeting(tenant_id: str, clinic_name: str = "", receptionist_name: str = "", custom_greeting: str = ""):
    """
    1-ring pickup. Cache hit returns the clinic greeting immediately.
    Cache miss returns the neutral hold clip and the text to speak after it.
    The SDP answer is never blocked on TTS.
    """
    cache_key = f"{tenant_id}:{clinic_name}:{receptionist_name}:{custom_greeting}"
    cached = tenant_greetings.get(cache_key)
    if cached is not None and len(cached) > 0:
        return cached, None
    text = clinic_greeting_text(clinic_name, receptionist_name, custom_greeting)
    hold = cached_hold_pcm if len(cached_hold_pcm) > 0 else np.zeros(0, dtype=np.int16)
    return hold, (cache_key, text)

async def warmup_and_queue(cache_key: str, text: str, track: MayaVoiceTrack):
    pcm = await synthesize_tts_pcm(text)
    if len(pcm) == 0:
        return
    tenant_greetings[cache_key] = pcm
    track.queue_audio(pcm, replace=False, after_current=True)
    logger.info(f"Queued clinic greeting after neutral hold ({len(pcm)/48000:.2f}s): {text[:60]}...")

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
        tenant_id = ""
        if call_id in active_calls:
            conv_history = active_calls[call_id].get("history", [])
            tenant_id = active_calls[call_id].get("tenantId") or ""

        # 3. Send to Lumera Cloud Run cognitive brain
        privileged = False
        phone_number_id = ""
        if call_id in active_calls:
            privileged = bool(active_calls[call_id].get("privileged"))
            if privileged:
                phone_number_id = active_calls[call_id].get("phoneNumberId", "") or ""
        headers = {
            "Content-Type": "application/json",
            "Origin": "https://www.mylumera.in",
        }
        # Only an offer that presented the secret may reuse it. A public offer
        # still gets SDP so the live Cloud Run revision can answer during rollout.
        if privileged and VOICE_GATEWAY_SECRET:
            headers["X-Voice-Gateway-Secret"] = VOICE_GATEWAY_SECRET
        async with aiohttp.ClientSession(headers=headers) as session:
            payload = {
                "from": caller_phone or "",
                "audioBase64": audio_b64,
                "mimeType": "audio/wav",
                "callerName": "Patient",
                "phoneNumberId": phone_number_id,
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
                            dur_s = len(resp_pcm) / 48000.0
                            logger.info(f"[{call_id}] Streaming Maya's response into call ({dur_s:.2f}s)")

                            if intent == "TRANSFER":
                                # WhatsApp Cloud API calling on this gateway can accept, reject, or
                                # terminate the WebRTC leg. It cannot bridge the caller to a PSTN
                                # or SIP desk. The spoken line and WhatsApp card carry the clinic number.
                                logger.info(f"[{call_id}] Escalation spoken. No live transfer on this stack. Ending media in {dur_s + 2.0:.1f}s")
                                loop.call_later(dur_s + 2.0, lambda: asyncio.create_task(cleanup_call(call_id)))
                else:
                    err_txt = await resp.text()
                    logger.warn(f"[{call_id}] Lumera AI returned HTTP {resp.status}: {err_txt}")
    except Exception as e:
        logger.error(f"[{call_id}] Error handling caller utterance: {repr(e)}")

async def process_inbound_audio(call_id: str, inbound_track, out_track: MayaVoiceTrack, caller_phone: str):
    """Listens to caller audio using Neural Silero VAD with pre-roll buffering & AGC to eliminate dropped speech."""
    logger.info(f"[{call_id}] Started neural inbound audio listener loop for caller: {caller_phone}")
    resampler = AudioResampler(format="s16", layout="mono", rate=16000)
    vad = SileroVAD()

    from collections import deque
    # Pre-roll ring buffer: keeps previous ~300ms (10 frames of 32ms) so first syllables are never cut
    pre_roll_buffer = deque(maxlen=10)
    speech_buffer = []
    chunk_accumulator = []
    is_speaking = False
    silence_frames = 0
    speech_frames = 0
    interruption_frames = 0
    min_speech_frames = 8         # ~250ms of neural speech minimum to trigger processing
    silence_threshold_frames = 25 # ~800ms of natural human pause to finalize utterance
    max_speech_frames = 450       # ~14 seconds max cap
    is_processing = False         # Lock to serialize queries cleanly
    pending_utterance = None

    try:
        while True:
            frame = await inbound_track.recv()
            if not frame:
                break

            maya_talking = out_track.is_speaking()

            for resampled in resampler.resample(frame):
                raw_data = resampled.to_ndarray().flatten()
                chunk_accumulator.extend(raw_data)

                # Process in 512-sample blocks (~32ms at 16kHz) for optimal Silero VAD inference
                while len(chunk_accumulator) >= 512:
                    block = np.array(chunk_accumulator[:512], dtype=np.int16)
                    chunk_accumulator = chunk_accumulator[512:]

                    # Evaluate speech probability using Neural VAD
                    speech_detected = vad.is_speech(block, threshold=0.42)
                    rms = np.sqrt(np.mean(block.astype(np.float32) ** 2))

                    # If Maya is speaking:
                    # Echo suppression with barge-in support:
                    # Allow caller to interrupt if loud human voice is sustained for > 150ms after initial greeting grace
                    if maya_talking:
                        if out_track.speech_elapsed_s() > 1.2 and speech_detected and rms > 1500:
                            interruption_frames += 1
                            if interruption_frames >= 5: # ~160ms sustained human speech
                                logger.info(f"[{call_id}] Caller interrupted Maya (RMS: {rms:.0f}, frames: {interruption_frames})")
                                out_track.interrupt()
                                maya_talking = False
                                is_speaking = True
                                speech_buffer = list(pre_roll_buffer) + [block]
                                speech_frames = 5
                                silence_frames = 0
                                interruption_frames = 0
                        else:
                            interruption_frames = 0
                        pre_roll_buffer.append(block)
                        continue

                    interruption_frames = 0

                    if speech_detected:
                        if not is_speaking:
                            logger.info(f"[{call_id}] Caller speech detected via Neural VAD (RMS: {rms:.0f})")
                            is_speaking = True
                            # Prepend pre-roll buffer so words like 'Hello', 'Dr', 'Appointment' are never clipped
                            speech_buffer = list(pre_roll_buffer)
                            speech_frames = 0
                        speech_buffer.append(block)
                        speech_frames += 1
                        silence_frames = 0
                        if speech_frames >= max_speech_frames:
                            logger.info(f"[{call_id}] Utterance reached cap, finalizing...")
                            silence_frames = silence_threshold_frames + 1
                    else:
                        pre_roll_buffer.append(block)
                        if is_speaking:
                            speech_buffer.append(block)
                            silence_frames += 1
                            if silence_frames > silence_threshold_frames:
                                if speech_frames >= min_speech_frames:
                                    complete_pcm = np.concatenate(speech_buffer)
                                    # Apply soft AGC normalization if volume is low
                                    peak = np.max(np.abs(complete_pcm))
                                    if 0 < peak < 16000:
                                        gain = min(2.5, 24000.0 / peak)
                                        complete_pcm = np.clip(complete_pcm.astype(np.float32) * gain, -32767, 32767).astype(np.int16)

                                    duration_s = len(complete_pcm) / 16000.0
                                    logger.info(f"[{call_id}] Neural VAD speech captured: {duration_s:.2f}s ({len(complete_pcm)} samples)")

                                    # Play instant conversational filler so caller receives immediate feedback (<250ms)
                                    if len(cached_filler_pcm) > 0 and not out_track.is_speaking():
                                        out_track.queue_audio(cached_filler_pcm, replace=False)

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

                                speech_buffer = []
                                is_speaking = False
                                silence_frames = 0
                                vad.reset()
    except asyncio.CancelledError:
        pass
    except Exception as e:
        # MediaStreamError is standard when caller hangs up on WhatsApp
        err_name = type(e).__name__
        if "MediaStreamError" in err_name or "ConnectionResetError" in err_name:
            logger.info(f"[{call_id}] Inbound audio stream ended by caller ({err_name})")
        else:
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

def offer_presented_secret(request) -> bool:
    """True only when the caller proved it holds VOICE_GATEWAY_SECRET. Missing secret is not a 403."""
    expected = VOICE_GATEWAY_SECRET
    if not expected:
        return False
    provided = request.headers.get("X-Voice-Gateway-Secret", "") or ""
    expected_b = expected.encode("utf-8")
    provided_b = provided.encode("utf-8")
    if len(provided_b) != len(expected_b):
        hmac.compare_digest(expected_b, expected_b)
        return False
    return hmac.compare_digest(provided_b, expected_b)

async def handle_answer_offer(request):
    privileged = offer_presented_secret(request)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    call_id = body.get("callId")
    caller_phone = body.get("callerPhone", "+919999973271")
    tenant_id = body.get("tenantId") or ""
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

    clinic_name = body.get("clinicName", "")
    receptionist_name = body.get("receptionistName", "")
    custom_greeting = body.get("customGreeting", "")
    phone_number_id = body.get("phoneNumberId") or body.get("phone_number_id") or ""
    if not privileged:
        phone_number_id = ""

    logger.info(f"[{call_id}] Initializing WebRTC call for tenant='{tenant_id}' clinic='{clinic_name}' caller={caller_phone}")

    # Neutral hold on cache miss, then the clinic greeting. SDP is not blocked on TTS.
    greeting_pcm, followup = await prepare_call_greeting(tenant_id, clinic_name, receptionist_name, custom_greeting)

    # Create RTCPeerConnection
    pc = RTCPeerConnection()

    # Attach Maya Voice Track. Empty PCM still answers on the first ring.
    track = MayaVoiceTrack(greeting_pcm if len(greeting_pcm) else np.zeros(0, dtype=np.int16), 48000)
    if followup:
        cache_key, followup_text = followup
        asyncio.create_task(warmup_and_queue(cache_key, followup_text, track))
    pc.addTrack(track)
    logger.info(f"[{call_id}] Attached MayaVoiceTrack ({len(greeting_pcm)/48000:.2f}s) to WebRTC peer")

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
        "phoneNumberId": phone_number_id,
        "privileged": privileged,
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

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
FILLER_TEXT = {
    "en": "Ji, one moment, I am checking.",
    "hi": "जी, एक क्षण, मैं देख रही हूँ।",
    "mr": "हो, एक क्षण, मी बघते.",
}

# Preloaded neutral hold and conversational filler PCM (48kHz mono 16-bit).
# The hold clip is the only audio played before a clinic greeting is ready.
# Audio comes from Lumera's Google Cloud TTS WaveNet voice. Never a second engine.
cached_hold_pcm = np.zeros(0, dtype=np.int16)
cached_filler_pcm = np.zeros(0, dtype=np.int16)
filler_by_lang = {}
clip_pcm_cache = {}

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

def lumera_clips_url() -> str:
    """Same Lumera host as the inbound brain, on the shared Google TTS route."""
    explicit = os.environ.get("LUMERA_CLIPS_URL", "").strip()
    if explicit:
        return explicit
    inbound = LUMERA_API_URL.rstrip("/")
    marker = "/api/voice/inbound"
    if inbound.endswith(marker):
        return inbound[: -len("inbound")] + "clips"
    return inbound.rsplit("/", 1)[0] + "/clips"

def normalize_spoken_language(value: str) -> str:
    text = (value or "").strip().lower()
    if text.startswith("hi"):
        return "hi"
    if text.startswith("mr"):
        return "mr"
    return "en"

def voice_language_for_text(text: str, hinted: str = "en") -> str:
    sample = text or ""
    if re.search(r"आहे|नाही|झाले|मला|नमस्कार", sample):
        return "mr"
    if re.search(r"[\u0900-\u097F]", sample):
        return "hi"
    return normalize_spoken_language(hinted)

async def fetch_google_tts_pcm(text: str, language: str, clip: str, send_secret: bool) -> np.ndarray:
    """One Google Cloud TTS voice. A failure is silence, never another voice."""
    headers = {
        "Content-Type": "application/json",
        "Origin": "https://www.mylumera.in",
    }
    if send_secret and VOICE_GATEWAY_SECRET:
        headers["X-Voice-Gateway-Secret"] = VOICE_GATEWAY_SECRET
    try:
        timeout = aiohttp.ClientTimeout(total=4)
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.post(
                lumera_clips_url(),
                json={"text": text, "language": language, "clip": clip},
                timeout=timeout,
            ) as resp:
                if resp.status != 200:
                    logger.warning(f"Google TTS clip {clip} returned HTTP {resp.status}")
                    return np.zeros(0, dtype=np.int16)
                data = await resp.json()
                audio_b64 = data.get("audioBase64") or ""
                if not audio_b64:
                    return np.zeros(0, dtype=np.int16)
                return decode_mp3_bytes_to_pcm(base64.b64decode(audio_b64), 48000)
    except Exception as exc:
        logger.warning(f"Google TTS clip {clip} failed: {exc}")
        return np.zeros(0, dtype=np.int16)

async def ensure_greeting_audio(attempt: int = 0):
    """Preloads a neutral hold clip and conversational fillers from Google TTS."""
    global cached_hold_pcm, cached_filler_pcm
    send_secret = bool(VOICE_GATEWAY_SECRET)
    hold = await synthesize_tts_pcm(NEUTRAL_HOLD_TEXT, "en", "hold", send_secret)
    if len(hold) > 0:
        cached_hold_pcm = hold
        logger.info(f"Preloaded neutral hold clip into memory: {len(cached_hold_pcm)/48000:.2f}s")
    else:
        logger.warning("Neutral hold clip unavailable from Google TTS. Callers hear silence until a retry succeeds.")

    for lang, filler_text in FILLER_TEXT.items():
        pcm = await synthesize_tts_pcm(filler_text, lang, "filler", send_secret)
        if len(pcm) == 0:
            continue
        filler_by_lang[lang] = pcm
        if lang == "en":
            cached_filler_pcm = pcm
            logger.info(f"Preloaded conversational filler into memory: {len(cached_filler_pcm)/48000:.2f}s")

    if (len(cached_hold_pcm) == 0 or len(cached_filler_pcm) == 0) and attempt < 4:
        asyncio.get_running_loop().call_later(
            8,
            lambda: asyncio.create_task(ensure_greeting_audio(attempt + 1)),
        )

tenant_greetings: dict = {}

def clinic_greeting_text(clinic_name: str = "", receptionist_name: str = "", custom_greeting: str = "") -> str:
    """Patient-facing greeting. Clinic and receptionist names are variables. Missing name stays neutral."""
    if custom_greeting and custom_greeting.strip():
        return custom_greeting.strip()
    cl_name = clinic_name.strip() or "the clinic"
    return f"Namaste! Thank you for calling {cl_name}. How can I help you today?"

async def synthesize_tts_pcm(text: str, language: str = "en", clip: str = "greeting", send_secret: bool = False) -> np.ndarray:
    """Google Cloud TTS only. A miss becomes silence and one retry, never another voice."""
    spoken = voice_language_for_text(text, language)
    cache_key = f"{spoken}:{clip}:{text}"
    cached = clip_pcm_cache.get(cache_key)
    if cached is not None and len(cached) > 0:
        return cached
    for attempt in range(2):
        pcm = await fetch_google_tts_pcm(text, spoken, clip, send_secret)
        if len(pcm) > 0:
            clip_pcm_cache[cache_key] = pcm
            return pcm
        if attempt == 0:
            await asyncio.sleep(0.35)
    return np.zeros(0, dtype=np.int16)

async def prepare_call_greeting(tenant_id: str, clinic_name: str = "", receptionist_name: str = "", custom_greeting: str = "", language: str = "en"):
    """
    1-ring pickup. Cache hit returns the clinic greeting immediately.
    Cache miss returns the neutral hold clip and the text to speak after it.
    The SDP answer is never blocked on TTS.
    """
    spoken = normalize_spoken_language(language)
    cache_key = f"{tenant_id}:{spoken}:{clinic_name}:{receptionist_name}:{custom_greeting}"
    cached = tenant_greetings.get(cache_key)
    if cached is not None and len(cached) > 0:
        return cached, None
    text = clinic_greeting_text(clinic_name, receptionist_name, custom_greeting)
    hold = cached_hold_pcm if len(cached_hold_pcm) > 0 else np.zeros(0, dtype=np.int16)
    return hold, (cache_key, text)

async def warmup_and_queue(cache_key: str, text: str, track: MayaVoiceTrack, send_secret: bool = False):
    pcm = await synthesize_tts_pcm(text, voice_language_for_text(text, "en"), "greeting", send_secret)
    if len(pcm) == 0:
        logger.warning("Clinic greeting TTS unavailable. Keeping silence instead of another voice.")
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

async def handle_caller_utterance(call_id: str, pcm_16k: np.ndarray, out_track: MayaVoiceTrack, caller_phone: str, barge_in: bool = False):
    """Encodes caller speech to WAV, queries Lumera Gemini AI, and queues the same Google voice."""
    try:
        loop = asyncio.get_event_loop()
        # 1. Encode 16kHz mono PCM into in-memory WAV on worker thread (non-blocking)
        audio_b64 = await loop.run_in_executor(None, _encode_wav_sync, pcm_16k)

        lock = asyncio.Lock()
        if call_id in active_calls:
            lock = active_calls[call_id].setdefault("turnLock", asyncio.Lock())

        speech_text = ""
        intent = "INQUIRY"
        resp_audio_bytes = b""
        spoken = "en"
        send_secret = False
        # The lock covers the read of history and the append of this transcript,
        # including while the brain request is in flight. A newer utterance waits.
        async with lock:
            conv_history = []
            tenant_id = ""
            known_name = ""
            booking_draft = None
            if call_id in active_calls:
                conv_history = list(active_calls[call_id].get("history") or [])
                tenant_id = active_calls[call_id].get("tenantId") or ""
                known_name = active_calls[call_id].get("callerName") or ""
                booking_draft = active_calls[call_id].get("bookingDraft")

            privileged = False
            phone_number_id = ""
            secret_required = bool(VOICE_GATEWAY_SECRET)
            if call_id in active_calls:
                privileged = bool(active_calls[call_id].get("privileged"))
                # With no secret configured, forward the receiving line so the server
                # can resolve the clinic. Once the secret is set, only a signed offer may.
                if privileged or not secret_required:
                    phone_number_id = active_calls[call_id].get("phoneNumberId", "") or ""
            send_secret = bool(privileged and secret_required)
            headers = {
                "Content-Type": "application/json",
                "Origin": "https://www.mylumera.in",
            }
            if send_secret:
                headers["X-Voice-Gateway-Secret"] = VOICE_GATEWAY_SECRET
            async with aiohttp.ClientSession(headers=headers) as session:
                payload = {
                    "from": caller_phone or "",
                    "audioBase64": audio_b64,
                    "mimeType": "audio/wav",
                    "callerName": known_name,
                    "phoneNumberId": phone_number_id,
                    "conversationHistory": conv_history,
                    "bookingDraft": booking_draft,
                }
                logger.info(f"[{call_id}] Sending caller speech ({len(pcm_16k)/16000:.2f}s) for tenant {tenant_id} to Lumera AI...")
                async with session.post(LUMERA_API_URL, json=payload, timeout=aiohttp.ClientTimeout(total=18)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        speech_text = data.get("speechText", "") or ""
                        intent = data.get("intent", "INQUIRY")
                        transcript = data.get("transcript", "") or ""
                        spoken = normalize_spoken_language(str(data.get("ttsLanguage") or ""))
                        logger.info(f"[{call_id}] Caller said: \"{transcript}\" | Maya reply ({intent}): \"{speech_text}\"")

                        if call_id in active_calls:
                            if transcript:
                                active_calls[call_id]["history"].append({"role": "caller", "text": transcript})
                            if "bookingDraft" in data:
                                active_calls[call_id]["bookingDraft"] = data.get("bookingDraft")
                            learned = ""
                            draft = data.get("bookingDraft")
                            if isinstance(draft, dict):
                                learned = str(draft.get("patientName") or "").strip()
                            if not learned:
                                learned = str(data.get("callerName") or "").strip()
                            if learned:
                                active_calls[call_id]["callerName"] = learned
                            if spoken:
                                active_calls[call_id]["spokenLanguage"] = spoken

                        if not speech_text and len(pcm_16k) >= 9600:
                            logger.warning(f"[{call_id}] Lumera AI returned empty speechText. Using polite clarification fallback.")
                            speech_text = "I'm sorry, I couldn't hear that clearly. Could you please repeat?"

                        if speech_text and call_id in active_calls:
                            active_calls[call_id]["history"].append({"role": "maya", "text": speech_text})

                        if data.get("audioBase64"):
                            try:
                                resp_audio_bytes = base64.b64decode(data["audioBase64"])
                                logger.info(f"[{call_id}] Received Cloud TTS audio ({len(resp_audio_bytes)} bytes)")
                            except Exception as b64_err:
                                logger.warning(f"[{call_id}] Error decoding audioBase64: {b64_err}")
                    else:
                        err_txt = await resp.text()
                        logger.warning(f"[{call_id}] Lumera AI returned HTTP {resp.status}: {err_txt}")

        resp_pcm = np.zeros(0, dtype=np.int16)
        if resp_audio_bytes:
            resp_pcm = await loop.run_in_executor(None, decode_mp3_bytes_to_pcm, resp_audio_bytes, 48000)
        elif speech_text:
            # Same Google voice as the brain. Silence if it fails. No second voice.
            resp_pcm = await synthesize_tts_pcm(speech_text, spoken, "reply", send_secret)
            if len(resp_pcm) == 0:
                logger.warning(f"[{call_id}] Google TTS returned no audio. Staying silent instead of switching voice.")

        pending = (active_calls.get(call_id) or {}).get("pendingUtterances")
        superseded = bool(pending) and len(pending) > 0
        if superseded:
            logger.info(f"[{call_id}] Kept the earlier transcript and skipped playback because a newer utterance is waiting")
        elif len(resp_pcm) > 0:
            if barge_in or not out_track.is_speaking():
                out_track.queue_audio(resp_pcm, replace=True)
            else:
                out_track.queue_audio(resp_pcm, replace=False, after_current=True)
            dur_s = len(resp_pcm) / 48000.0
            logger.info(f"[{call_id}] Streaming Maya's response into call ({dur_s:.2f}s)")
            if intent == "TRANSFER":
                # WhatsApp Cloud API calling on this gateway can accept, reject, or
                # terminate the WebRTC leg. It cannot bridge the caller to a PSTN
                # or SIP desk. The spoken line and WhatsApp card carry the clinic number.
                logger.info(f"[{call_id}] Escalation spoken. No live transfer on this stack. Ending media in {dur_s + 2.0:.1f}s")
                loop.call_later(dur_s + 2.0, lambda: asyncio.create_task(cleanup_call(call_id)))
    except Exception as e:
        logger.error(f"[{call_id}] Error handling caller utterance: {repr(e)}")

def endpoint_silence_ms() -> int:
    """End-of-turn silence. MAYA_ENDPOINT_SILENCE_MS defaults to about 500ms."""
    try:
        ms = int(os.environ.get("MAYA_ENDPOINT_SILENCE_MS", "500"))
    except ValueError:
        ms = 500
    return max(320, min(ms, 900))


def endpoint_silence_frames() -> int:
    return max(10, int(round(endpoint_silence_ms() / 32.0)))


async def process_inbound_audio(call_id: str, inbound_track, out_track: MayaVoiceTrack, caller_phone: str):
    """Listens to caller audio using Neural Silero VAD with pre-roll buffering & AGC to eliminate dropped speech."""
    logger.info(f"[{call_id}] Started neural inbound audio listener loop for caller: {caller_phone}")
    resampler = AudioResampler(format="s16", layout="mono", rate=16000)
    vad = SileroVAD()

    from collections import deque
    # Pre-roll ring buffer: keeps previous ~300ms (10 frames of 32ms) so first syllables are never cut
    pre_roll_buffer = deque(maxlen=10)
    # Speech that arrives while Maya is talking. Kept so barge-in does not drop the caller's words.
    overlap_buffer = deque(maxlen=60)
    speech_buffer = []
    chunk_accumulator = []
    is_speaking = False
    silence_frames = 0
    speech_frames = 0
    interruption_frames = 0
    soft_hold = 0
    was_talking = False
    min_speech_frames = 8         # ~250ms of neural speech minimum to trigger processing
    silence_threshold_frames = endpoint_silence_frames()
    max_speech_frames = 450       # ~14 seconds max cap
    is_processing = False         # Lock to serialize queries cleanly
    pending_utterances = deque()
    barge_capture = False
    if call_id in active_calls:
        active_calls[call_id]["pendingUtterances"] = pending_utterances

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

                    # While Maya speaks, keep the caller audio. A sustained voice interrupts
                    # playback and the buffered words become the start of the utterance.
                    if maya_talking:
                        was_talking = True
                        overlap_buffer.append(block)
                        if out_track.speech_elapsed_s() > 0.35 and speech_detected and rms > 1100:
                            interruption_frames += 1
                            if interruption_frames >= 4:
                                logger.info(f"[{call_id}] Caller interrupted Maya (RMS: {rms:.0f}, frames: {interruption_frames})")
                                out_track.interrupt()
                                maya_talking = False
                                was_talking = False
                                is_speaking = True
                                speech_buffer = list(overlap_buffer)
                                speech_frames = max(4, len(speech_buffer))
                                silence_frames = 0
                                soft_hold = 0
                                interruption_frames = 0
                                barge_capture = True
                                overlap_buffer.clear()
                        else:
                            interruption_frames = 0
                        continue

                    if was_talking and overlap_buffer and not is_speaking:
                        promoted = list(overlap_buffer)
                        overlap_buffer.clear()
                        loud = 0
                        for earlier in promoted:
                            earlier_rms = float(np.sqrt(np.mean(earlier.astype(np.float32) ** 2)))
                            if earlier_rms > 800:
                                loud += 1
                        if loud >= 3:
                            logger.info(f"[{call_id}] Keeping caller speech that started while Maya was talking")
                            is_speaking = True
                            speech_buffer = promoted
                            speech_frames = loud
                            silence_frames = 0
                            soft_hold = 0
                    was_talking = False

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
                            if rms > 450:
                                soft_hold += 1
                                if soft_hold > silence_threshold_frames:
                                    silence_frames = silence_threshold_frames + 1
                            else:
                                soft_hold = 0
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

                                    # Play instant conversational filler in the call's Google voice.
                                    spoken_lang = "en"
                                    if call_id in active_calls:
                                        spoken_lang = active_calls[call_id].get("spokenLanguage") or "en"
                                    filler_pcm = filler_by_lang.get(spoken_lang)
                                    if filler_pcm is not None and len(filler_pcm) > 0 and not out_track.is_speaking():
                                        out_track.queue_audio(filler_pcm, replace=False)

                                    this_barge = barge_capture
                                    barge_capture = False
                                    if not is_processing:
                                        is_processing = True

                                        async def run_utterance(b_pcm, was_barge=False):
                                            nonlocal is_processing
                                            try:
                                                await handle_caller_utterance(call_id, b_pcm, out_track, caller_phone, barge_in=was_barge)
                                            finally:
                                                if pending_utterances:
                                                    next_pcm = pending_utterances.popleft()
                                                    is_processing = True
                                                    asyncio.create_task(run_utterance(next_pcm, False))
                                                else:
                                                    is_processing = False

                                        asyncio.create_task(run_utterance(complete_pcm, this_barge))
                                    else:
                                        logger.info(f"[{call_id}] Queuing speech utterance while the previous request is in flight")
                                        pending_utterances.append(complete_pcm)

                                barge_capture = False
                                speech_buffer = []
                                is_speaking = False
                                silence_frames = 0
                                soft_hold = 0
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
    return web.json_response({
        "status": "online",
        "service": "lumera-webrtc-voice-gateway",
        "engine": "aiortc (Continuous 48kHz Opus Audio Stream + Bidirectional Cognitive Speech)",
        "tier": "GCP Always Free (e2-micro)",
        "activeCallsCount": len(active_calls),
        "endpointSilenceMs": endpoint_silence_ms(),
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

    # Reuse session if callId already exists (pre_accept followed by accept).
    # Privilege is fixed by the first offer. A later secret must not be copied
    # onto a session a public caller already opened, and that caller's SDP is
    # not handed to Cloud Run.
    if call_id in active_calls:
        existing = active_calls[call_id]
        if existing.get("privileged") and not privileged:
            return web.json_response({"error": "Unauthorized"}, status=403)
        if privileged and not existing.get("privileged"):
            return web.json_response({"error": "Conflict"}, status=409)
        logger.info(f"[{call_id}] Reusing active call session. State: {existing['pc'].connectionState}")
        return web.json_response({
            "ok": True,
            "callId": call_id,
            "sdpAnswer": existing["sdpAnswer"],
        })

    clinic_name = body.get("clinicName", "")
    receptionist_name = body.get("receptionistName", "")
    custom_greeting = body.get("customGreeting", "")
    spoken_language = normalize_spoken_language(body.get("language") or "en")
    phone_number_id = body.get("phoneNumberId") or body.get("phone_number_id") or ""
    if VOICE_GATEWAY_SECRET and not privileged:
        phone_number_id = ""

    logger.info(f"[{call_id}] Initializing WebRTC call for tenant='{tenant_id}' clinic='{clinic_name}' caller={caller_phone}")

    # Neutral hold on cache miss, then the clinic greeting. SDP is not blocked on TTS.
    greeting_pcm, followup = await prepare_call_greeting(tenant_id, clinic_name, receptionist_name, custom_greeting, spoken_language)

    # Create RTCPeerConnection
    pc = RTCPeerConnection()

    # Attach Maya Voice Track. Empty PCM still answers on the first ring.
    track = MayaVoiceTrack(greeting_pcm if len(greeting_pcm) else np.zeros(0, dtype=np.int16), 48000)
    if followup:
        cache_key, followup_text = followup
        asyncio.create_task(warmup_and_queue(cache_key, followup_text, track, privileged and bool(VOICE_GATEWAY_SECRET)))
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
        "callerName": "",
        "spokenLanguage": spoken_language,
        "bookingDraft": None,
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
    asyncio.create_task(ensure_greeting_audio())
    app = web.Application()
    app.router.add_get("/", handle_health)
    app.router.add_get("/health", handle_health)
    app.router.add_post("/webrtc/answer-offer", handle_answer_offer)
    return app

if __name__ == "__main__":
    web.run_app(init_app(), host="0.0.0.0", port=PORT)

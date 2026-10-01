import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Zap,
  X,
  Eraser,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { SoapNote, Patient, Doctor } from "../types";
import {
  beginAmbientMicGesture,
  isSpeechRecognitionAvailable,
  micErrorMessage,
  microphoneStatusLabel,
  SPEECH_UNSUPPORTED_NOTICE,
  startAmbientMic,
  transcriptBadge,
  transcribeRecordedAudio,
  type AmbientMicGesture,
  type TranscriptOrigin,
} from "../lib/ambientMic";
import { extractClinicalTokens, type PulseExtractSource } from "../lib/pulseClinicalTokens";
import { resolveRxModule } from "../lib/specialtyWorkflow";
import { flashPopulatedRxFields } from "../lib/flashPopulatedRxFields";

export type AmbientScribeStatus = "idle" | "requesting" | "listening" | "transcribing" | "processing";

export interface CompactAmbientScribeHandle {
  startListening: () => void;
  stopListening: () => void;
}

interface CompactAmbientScribeProps {
  currentPatient: Patient;
  currentDoctor: Doctor;
  onApplyToRx: (soap: SoapNote) => void;
  isOpen?: boolean;
  onClose?: () => void;
  onStatusChange?: (status: AmbientScribeStatus) => void;
  /** Active Rx module — GP, cardiology, physio, etc. Independent of demo pack-id `gp`. */
  practiceSpecialty?: string;
}

const DEMO_BY_MODULE: Record<string, Array<{ id: string; label: string; text: string }>> = {
  "Physiotherapy & Rehabilitation": [
    {
      id: "demo-knee",
      label: "Demo: knee OA",
      text: `Doctor: नमस्कार, गुडघ्याचा त्रास कसा आहे?
Patient: डॉक्टर, गेल्या आठवड्यापासून डाव्या गुडघ्यात खूप तीव्र वेदना आहेत. जिने चढताना stiffness. VAS 7/10.
Doctor: Left knee ROM limited to 105 degrees, crepitus, medial joint line tenderness.
Doctor: Grade II osteoarthritis. Quadriceps strengthening, hot pack, Aceclofenac after food.`,
    },
    {
      id: "demo-shoulder",
      label: "Demo: frozen shoulder",
      text: `Doctor: How is the left shoulder this week?
Patient: Severe pain and stiffness for 3 weeks. I cannot reach overhead. Night pain, VAS 8/10.
Doctor: Abduction 75 degrees with capsular end-feel. Neer and Hawkins positive.
Doctor: Adhesive capsulitis stage II. Pendulum swings, yellow-band ER, Volini gel.`,
    },
  ],
  Cardiology: [
    {
      id: "demo-angina",
      label: "Demo: HTN / angina",
      text: `Doctor: How have you been since starting the blood pressure medicines?
Patient: For 2 weeks I feel mild retrosternal heaviness during brisk walking, which relieves within 3 minutes of rest.
Doctor: Blood pressure 142/88 mmHg, pulse 74 regular. ECG sinus rhythm. Increasing Telmisartan 40 mg, adding Aspirin 75 mg. Ordering 2D echo.`,
    },
  ],
  Dermatology: [
    {
      id: "demo-acne",
      label: "Demo: facial acne",
      text: `Doctor: Show me the flare.
Patient: Pimples and comedones on the cheeks and forehead for 6 weeks. Itchy after sun.
Doctor: Inflammatory papules, Fitzpatrick IV. Clindamycin gel twice daily, SPF 50 every morning.`,
    },
  ],
  Pediatrics: [
    {
      id: "demo-pyrexia",
      label: "Demo: pediatric fever",
      text: `Doctor: Vanakkam, what happened to papa?
Patient: High fever since last night, dry cough, vomiting sensation. Age 3 years.
Doctor: Temp 100.8°F, chest clear, throat congested. Viral pyrexia. Paracetamol syrup 15 mg/kg SOS, ORS.`,
    },
  ],
  Orthopedics: [
    {
      id: "demo-knee-ortho",
      label: "Demo: knee OA",
      text: `Doctor: Which knee is troubling you?
Patient: Left knee pain for one week on stairs, stiffness in the morning.
Doctor: Medial joint line tenderness, ROM 105 degrees. Grade II osteoarthritis. Hinged brace, Aceclofenac after food, X-ray AP/lateral.`,
    },
  ],
  "Dental Surgery": [
    {
      id: "demo-caries",
      label: "Demo: tooth pain",
      text: `Doctor: Which tooth hurts?
Patient: Lower left molar pain on biting for 4 days, sensitivity to cold.
Doctor: Deep occlusal caries 36, tender on percussion. Plan RCT, paracetamol after food.`,
    },
  ],
  "General Medicine": [
    {
      id: "demo-uri",
      label: "Demo: fever & cough",
      text: `Doctor: Namaste, kya takleef hai?
Patient: 2 din se tez fever, throat pain, mild dry cough. No breathlessness.
Doctor: Temp 100.4°F, pharynx congested, lungs clear. Viral URI. Dolo 650 after food, warm gargles.`,
    },
    {
      id: "demo-dm",
      label: "Demo: diabetes review",
      text: `Doctor: How is the sugar control?
Patient: Afternoon fatigue. Tingling in the soles for a few weeks.
Doctor: Random sugar 152. Early diabetic neuropathy. Continue metformin 500 SR, HbA1c, methylcobalamin at night.`,
    },
  ],
};

function demoConsultsFor(specialty?: string) {
  const module = resolveRxModule(specialty);
  return DEMO_BY_MODULE[module] || DEMO_BY_MODULE["General Medicine"];
}

export const CompactAmbientScribe = React.forwardRef<CompactAmbientScribeHandle, CompactAmbientScribeProps>(function CompactAmbientScribe({
  currentPatient,
  currentDoctor,
  onApplyToRx,
  isOpen = true,
  onClose,
  onStatusChange,
  practiceSpecialty,
}, ref) {
  const [isRecording, setIsRecording] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [textSource, setTextSource] = useState<TranscriptOrigin>("empty");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSoap, setGeneratedSoap] = useState<SoapNote | null>(null);
  const [extractSource, setExtractSource] = useState<PulseExtractSource | null>(null);
  const [appliedSuccess, setAppliedSuccess] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const sessionRef = useRef<{ stop: () => void } | null>(null);
  const transcriptRef = useRef("");
  const recordingRef = useRef(false);
  const requestingRef = useRef(false);
  const speechSawTextRef = useRef(false);
  const speechFallbackRef = useRef(false);
  const uploadLockRef = useRef(false);
  const cancelStartRef = useRef(false);

  const transcript = [finalTranscript, interimTranscript].filter(Boolean).join(interimTranscript ? " " : "");
  const status: AmbientScribeStatus = isTranscribing
    ? "transcribing"
    : isGenerating
      ? "processing"
      : isRequesting
        ? "requesting"
        : isRecording
          ? "listening"
          : "idle";
  const micLabel = microphoneStatusLabel({
    requesting: isRequesting,
    recording: isRecording,
    transcriptOrigin: textSource,
    transcribing: isTranscribing,
  });

  useEffect(() => {
    transcriptRef.current = finalTranscript;
  }, [finalTranscript]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isRecording) {
      interval = setInterval(() => setRecordingSeconds((prev) => prev + 1), 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  const stopMic = () => {
    cancelStartRef.current = true;
    sessionRef.current?.stop();
    sessionRef.current = null;
    recordingRef.current = false;
    requestingRef.current = false;
    setIsRecording(false);
    setIsRequesting(false);
    setInterimTranscript("");
    setAudioLevel(0);
  };

  const uploadFallback = async (audioBlob: Blob) => {
    if (!speechFallbackRef.current || speechSawTextRef.current) return;
    if (uploadLockRef.current) return;
    if (audioBlob.size < 100) {
      setMicError("No audio was captured to transcribe. Allow the microphone and speak, or type the consult.");
      return;
    }
    uploadLockRef.current = true;
    setIsTranscribing(true);
    try {
      const text = await transcribeRecordedAudio(audioBlob);
      setFinalTranscript(text);
      setInterimTranscript("");
      setTextSource("server");
      setMicError(null);
      setSpeechNotice(null);
    } catch (err) {
      speechFallbackRef.current = false;
      setMicError(err instanceof Error ? err.message : "Server transcription failed.");
    } finally {
      uploadLockRef.current = false;
      setIsTranscribing(false);
    }
  };

  const handleToggleRecording = (force?: "start" | "stop") => {
    const shouldStop = force === "stop" || (force !== "start" && (recordingRef.current || requestingRef.current));
    if (shouldStop) {
      stopMic();
      return;
    }
    if (recordingRef.current || requestingRef.current || uploadLockRef.current) return;
    // Microphone and AudioContext.resume must run in this turn, before any await.
    let gesture: AmbientMicGesture;
    try {
      gesture = beginAmbientMicGesture();
    } catch (err) {
      const mapped = micErrorMessage(err);
      setMicError(mapped.message);
      return;
    }
    cancelStartRef.current = false;
    requestingRef.current = true;
    setIsRequesting(true);
    setMicError(null);
    setSpeechNotice(null);
    setGeneratedSoap(null);
    setAppliedSuccess(false);
    speechSawTextRef.current = false;
    speechFallbackRef.current = !isSpeechRecognitionAvailable();
    if (textSource === "sample") {
      setFinalTranscript("");
      setInterimTranscript("");
      setTextSource("empty");
    }
    void openMicSession(gesture);
  };

  const openMicSession = async (gesture: AmbientMicGesture) => {
    try {
      const session = await startAmbientMic({
        gesture,
        lang: "en-IN",
        onLevel: setAudioLevel,
        onError: (message) => {
          speechFallbackRef.current = true;
          setMicError(message);
        },
        onSpeechNotice: (message) => {
          speechFallbackRef.current = true;
          setSpeechNotice(message);
        },
        onTranscript: ({ finalChunk, interim }) => {
          if (finalChunk || interim) {
            speechSawTextRef.current = true;
            speechFallbackRef.current = false;
            setTextSource("live");
            setMicError(null);
            setSpeechNotice(null);
          }
          if (finalChunk) {
            setFinalTranscript((prev) => (prev ? `${prev.trim()} ${finalChunk}` : finalChunk));
          }
          setInterimTranscript(interim);
        },
        onAudioRecorded: (blob) => {
          recordingRef.current = false;
          requestingRef.current = false;
          setIsRecording(false);
          setIsRequesting(false);
          setAudioLevel(0);
          void uploadFallback(blob);
        },
        onStopped: () => {
          recordingRef.current = false;
          requestingRef.current = false;
          setIsRecording(false);
          setIsRequesting(false);
        },
      });
      if (cancelStartRef.current) {
        session.stop();
        return;
      }
      sessionRef.current = session;
      recordingRef.current = true;
      requestingRef.current = false;
      setIsRequesting(false);
      setIsRecording(true);
      if (!isSpeechRecognitionAvailable()) {
        setSpeechNotice(SPEECH_UNSUPPORTED_NOTICE);
      }
    } catch (err) {
      const mapped = micErrorMessage(err);
      setMicError(mapped.message);
      recordingRef.current = false;
      requestingRef.current = false;
      setIsRecording(false);
      setIsRequesting(false);
    }
  };

  const toggleRef = useRef(handleToggleRecording);
  toggleRef.current = handleToggleRecording;
  useImperativeHandle(ref, () => ({
    startListening: () => {
      void toggleRef.current("start");
    },
    stopListening: () => {
      void toggleRef.current("stop");
    },
  }), []);

  const handleClearTranscript = () => {
    setFinalTranscript("");
    setInterimTranscript("");
    setTextSource("empty");
    setGeneratedSoap(null);
    setAppliedSuccess(false);
    setExtractSource(null);
    speechSawTextRef.current = false;
  };

  const handleGenerateAndMaybeApply = async (apply: boolean) => {
    const text = (transcriptRef.current || finalTranscript || transcript).trim();
    if (!text) {
      setMicError("Capture or type a consult transcript before extracting clinical tokens.");
      return;
    }
    stopMic();
    setIsGenerating(true);
    setAppliedSuccess(false);
    setMicError(null);
    try {
      const { soap, source } = await extractClinicalTokens({
        transcript: text,
        patient: currentPatient,
        doctor: currentDoctor,
        recordingSeconds,
        practiceSpecialty: practiceSpecialty || currentDoctor.specialty,
      });
      setGeneratedSoap(soap);
      setExtractSource(source);
      if (apply) {
        onApplyToRx(soap);
        setAppliedSuccess(true);
        window.setTimeout(() => flashPopulatedRxFields(), 80);
        setTimeout(() => setAppliedSuccess(false), 4000);
      }
    } catch (err) {
      setMicError(err instanceof Error ? err.message : "Pulse AI could not extract clinical tokens.");
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen) return null;

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const statusLabel =
    status === "listening"
      ? "Listening"
      : status === "requesting"
        ? "Allow mic"
        : status === "transcribing"
          ? "Transcribing…"
          : status === "processing"
            ? "Processing"
            : "Idle";
  const badge = transcriptBadge(textSource);
  const bars = Array.from({ length: 16 }, (_, i) => {
    const scale = 0.55 + (i % 5) * 0.12;
    const shaped = Math.sqrt(Math.max(audioLevel, 0) / 100);
    return isRecording ? Math.max(4, Math.round(shaped * 28 * scale)) : 4;
  });

  return (
    <section
      id="ambient-scribe-top"
      aria-label="Ambient AI Scribe"
      className="no-print w-full bg-white rounded-xl border border-violet-200 shadow-sm overflow-hidden"
    >
      <div className="px-4 py-3 bg-gradient-to-r from-violet-50 to-slate-50 border-b border-violet-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            data-testid="ambient-header-mic"
            onClick={() => handleToggleRecording()}
            aria-label={isRecording ? "Stop listening" : "Start listening"}
            title={isRecording ? "Stop the microphone" : "Start the microphone"}
            className={`w-9 h-9 rounded-lg flex items-center justify-center border cursor-pointer ${
              status === "listening"
                ? "bg-rose-50 border-rose-200 text-rose-600"
                : status === "requesting" || status === "processing" || status === "transcribing"
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-violet-50 border-violet-200 text-violet-700"
            }`}
          >
            <Mic className={`w-4 h-4 ${status === "listening" || status === "requesting" ? "animate-pulse" : ""}`} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-900">Ambient AI Scribe</span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  status === "listening"
                    ? "bg-rose-100 text-rose-800 border-rose-200"
                    : status === "processing" || status === "requesting" || status === "transcribing"
                      ? "bg-amber-100 text-amber-800 border-amber-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                }`}
              >
                {statusLabel}
              </span>
              {isRecording && (
                <span className="font-mono text-[10px] font-bold text-rose-600">{formatTimer(recordingSeconds)}</span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 truncate">
              Microphone for this {resolveRxModule(practiceSpecialty || currentDoctor.specialty)} consult. Notes stay suggestions until you apply them — nothing is printed or sent on WhatsApp from here.
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            title="Collapse Ambient Scribe"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isRequesting && (
        <div
          role="status"
          className="mx-4 mt-3 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs"
        >
          Waiting for the browser microphone prompt. If none appears, allow the microphone in the address bar, then tap Start listening again.
        </div>
      )}

      {speechNotice && (
        <div
          role="status"
          className="mx-4 mt-3 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{speechNotice}</span>
        </div>
      )}

      {micError && (
        <div
          role="alert"
          data-testid="ambient-mic-error"
          className="mx-4 mt-3 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{micError}</span>
        </div>
      )}

      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? "bg-rose-500 animate-ping" : isRequesting ? "bg-amber-500 animate-pulse" : "bg-slate-300"}`} />
              <span className="text-[11px] font-semibold text-slate-600" data-testid="ambient-mic-status">
                {micLabel}
              </span>
            </div>
            <div
              className="flex items-end gap-0.5 h-8 px-2 py-1 bg-slate-50 rounded border border-slate-200"
              data-testid="ambient-mic-level"
              role="meter"
              aria-label="Microphone level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={isRecording ? audioLevel : 0}
            >
              {bars.map((h, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full ${isRecording ? "bg-rose-500" : "bg-slate-300"}`}
                  style={{ height: `${h}px` }}
                />
              ))}
              <span className="ml-1 text-[10px] font-mono text-slate-500 self-center">{isRecording ? `${audioLevel}%` : "0%"}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="ambient-start-listening"
              onClick={() => handleToggleRecording()}
              aria-label={isRecording ? "Stop listening" : isRequesting ? "Waiting for microphone permission" : "Start listening"}
              title={isRecording ? "Stop the microphone" : "Request microphone access and start transcription"}
              className={`px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 ${
                isRecording ? "bg-rose-600 text-white" : isRequesting ? "bg-amber-600 text-white" : "bg-violet-600 text-white hover:bg-violet-700"
              }`}
            >
              {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              <span>
                {isTranscribing
                  ? "Transcribing…"
                  : isRecording
                    ? "Stop listening"
                    : isRequesting
                      ? "Waiting for microphone…"
                      : "Start listening"}
              </span>
            </button>
            <button
              type="button"
              onClick={handleClearTranscript}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold text-xs flex items-center gap-1.5 hover:bg-slate-50"
            >
              <Eraser className="w-3.5 h-3.5" />
              Clear / Reset Transcript
            </button>
            <button
              type="button"
              onClick={() => void handleGenerateAndMaybeApply(false)}
              disabled={isGenerating || !transcript.trim()}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5"
            >
              {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              <span>{isGenerating ? "Extracting tokens…" : "Extract clinical tokens"}</span>
            </button>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sample/Demo dialogues — not a live recording</p>
            <div className="flex flex-wrap gap-1">
              {demoConsultsFor(practiceSpecialty || currentDoctor.specialty).map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => {
                    stopMic();
                    setFinalTranscript(sample.text);
                    setInterimTranscript("");
                    setTextSource("sample");
                    setGeneratedSoap(null);
                    setAppliedSuccess(false);
                    setMicError(null);
                    setSpeechNotice(null);
                    speechSawTextRef.current = false;
                  }}
                  className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 border border-amber-200 text-[10px] text-amber-900"
                >
                  Sample/Demo: {sample.label.replace(/^Demo:\s*/i, "")}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase font-bold tracking-wider">
            <span>{badge || "Consult text"}</span>
            <span className="normal-case font-medium">{transcript.length} chars</span>
          </div>
          <textarea
            value={transcript}
            onChange={(e) => {
              setFinalTranscript(e.target.value);
              setInterimTranscript("");
              setTextSource(e.target.value.trim() ? "typed" : "empty");
            }}
            rows={6}
            placeholder="Transcript stays empty until you start the microphone or type the consult. Sample/Demo dialogues are labeled and are not a live recording."
            className="w-full min-h-[140px] bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 text-xs font-mono focus:border-violet-400 focus:outline-none resize-y leading-relaxed"
          />
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3">
        <button
          type="button"
          onClick={() => void handleGenerateAndMaybeApply(true)}
          disabled={isGenerating || !transcript.trim()}
          className={`w-full px-4 py-2.5 rounded-lg font-bold text-sm inline-flex items-center justify-center gap-2 shadow-sm ${
            appliedSuccess ? "bg-emerald-600 text-white" : "bg-violet-700 hover:bg-violet-800 text-white disabled:opacity-50"
          }`}
        >
          {isGenerating ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Pulse AI is extracting tokens…
            </>
          ) : appliedSuccess ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Suggestions applied — review before sign, print, or WhatsApp
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Apply suggestions to Rx draft
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
        <p className="text-[11px] text-slate-500">
          Extracted notes, diagnosis, and medicines stay suggestions until you apply them. Applying fills this draft only. It does not print or send WhatsApp.
        </p>

        {generatedSoap && (
          <div className="p-3 bg-violet-50 rounded-lg border border-violet-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-violet-800">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="font-bold text-xs">Extracted clinical tokens — edit highlighted Rx fields</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-700 bg-white px-1.5 py-0.5 rounded border border-emerald-200">
                ICD {generatedSoap.assessment.icd10Code}
                {extractSource ? ` · ${extractSource}` : ""}
              </span>
            </div>
            <p className="text-xs text-slate-800">
              <strong>{generatedSoap.assessment.primaryDiagnosis}</strong>
            </p>
            <ul className="list-disc list-inside text-[11px] text-slate-700 space-y-0.5">
              {generatedSoap.subjective.chiefComplaints.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            {generatedSoap.physiotherapyAssessment && (
              <p className="text-[11px] text-slate-600">
                ROM {generatedSoap.physiotherapyAssessment.jointRomFindings.map((r) => `${r.movement} ${r.degrees}`).join("; ")}
              </p>
            )}
            {(generatedSoap.prescribedExercises || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {generatedSoap.prescribedExercises!.map((m, i) => (
                  <span key={i} className="text-[10px] bg-white border border-violet-200 rounded px-1.5 py-0.5 text-slate-700">
                    HEP · {m.exerciseName}
                  </span>
                ))}
              </div>
            )}
            {generatedSoap.plan.medicines.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {generatedSoap.plan.medicines.map((m, i) => (
                  <span key={i} className="text-[10px] bg-white border border-violet-200 rounded px-1.5 py-0.5 text-slate-700">
                    {m.drugName} · {m.frequency}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
});

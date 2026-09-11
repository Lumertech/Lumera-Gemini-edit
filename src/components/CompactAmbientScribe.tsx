import React, { useEffect, useRef, useState } from "react";
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
import { isSpeechRecognitionAvailable, micErrorMessage, startAmbientMic } from "../lib/ambientMic";
import { extractClinicalTokens, type PulseExtractSource } from "../lib/pulseClinicalTokens";

export type AmbientScribeStatus = "idle" | "listening" | "processing";

interface CompactAmbientScribeProps {
  currentPatient: Patient;
  currentDoctor: Doctor;
  onApplyToRx: (soap: SoapNote) => void;
  isOpen?: boolean;
  onClose?: () => void;
  onStatusChange?: (status: AmbientScribeStatus) => void;
}

const DEMO_CONSULTS = [
  {
    id: "demo-knee",
    label: "Demo: knee OA (Marathi)",
    text: `Doctor: नमस्कार, गुडघ्याचा त्रास कसा आहे?
Patient: डॉक्टर, गेल्या आठवड्यापासून डाव्या गुडघ्यात खूप तीव्र वेदना आहेत. जिने चढताना आणि खाली बसताना stiffness आणि कट-कट आवाज येतो. VAS 7/10.
Doctor: Left knee examination: Medial joint line tenderness, crepitus on passive flexion, Active ROM limited to 105 degrees with pain on terminal extension.
Doctor: Grade II osteoarthritis. Quadriceps strengthening, hot pack, Aceclofenac after food for 5 days. Home exercise program 3 times daily.`,
  },
  {
    id: "demo-shoulder",
    label: "Demo: frozen shoulder",
    text: `Doctor: How is the left shoulder this week?
Patient: Severe pain and stiffness for 3 weeks. I cannot reach overhead or fasten clothes. Night pain, VAS 8/10.
Doctor: Abduction 75 degrees with capsular end-feel, external rotation 25 degrees. Neer and Hawkins positive.
Doctor: Adhesive capsulitis stage II. Pendulum swings, external rotation with yellow band, wand flexion. Volini gel twice daily.`,
  },
];

export const CompactAmbientScribe: React.FC<CompactAmbientScribeProps> = ({
  currentPatient,
  currentDoctor,
  onApplyToRx,
  isOpen = true,
  onClose,
  onStatusChange,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSoap, setGeneratedSoap] = useState<SoapNote | null>(null);
  const [extractSource, setExtractSource] = useState<PulseExtractSource | null>(null);
  const [appliedSuccess, setAppliedSuccess] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const sessionRef = useRef<{ stop: () => void } | null>(null);
  const transcriptRef = useRef("");

  const transcript = [finalTranscript, interimTranscript].filter(Boolean).join(interimTranscript ? " " : "");
  const status: AmbientScribeStatus = isGenerating ? "processing" : isRecording ? "listening" : "idle";

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
    sessionRef.current?.stop();
    sessionRef.current = null;
    setIsRecording(false);
    setInterimTranscript("");
    setAudioLevel(0);
  };

  const handleToggleRecording = async () => {
    if (isRecording) {
      stopMic();
      return;
    }
    setMicError(null);
    setGeneratedSoap(null);
    setAppliedSuccess(false);
    try {
      const session = await startAmbientMic({
        lang: "en-IN",
        onLevel: setAudioLevel,
        onError: (message) => setMicError(message),
        onTranscript: ({ finalChunk, interim }) => {
          if (finalChunk) {
            setFinalTranscript((prev) => (prev ? `${prev.trim()} ${finalChunk}` : finalChunk));
          }
          setInterimTranscript(interim);
        },
      });
      sessionRef.current = session;
      setIsRecording(true);
      if (!isSpeechRecognitionAvailable()) {
        setMicError(
          "Live microphone is on, but this browser has no Speech Recognition. Type the consult in the box, or use Chrome / Edge for live captions."
        );
      }
    } catch (err) {
      const mapped = micErrorMessage(err);
      setMicError(mapped.message);
      setIsRecording(false);
    }
  };

  const handleClearTranscript = () => {
    setFinalTranscript("");
    setInterimTranscript("");
    setGeneratedSoap(null);
    setAppliedSuccess(false);
    setExtractSource(null);
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
      });
      setGeneratedSoap(soap);
      setExtractSource(source);
      if (apply) {
        onApplyToRx(soap);
        setAppliedSuccess(true);
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

  const statusLabel = status === "listening" ? "Listening" : status === "processing" ? "Processing" : "Idle";
  const bars = Array.from({ length: 16 }, (_, i) => {
    const wave = ((i % 5) + 1) * 12;
    const live = Math.max(12, Math.round((audioLevel / 100) * wave + (i % 3) * 8));
    return isRecording ? live : 14;
  });

  return (
    <section
      id="ambient-scribe-top"
      aria-label="Ambient AI Scribe"
      className="no-print w-full bg-white rounded-xl border border-violet-200 shadow-sm overflow-hidden"
    >
      <div className="px-4 py-3 bg-gradient-to-r from-violet-50 to-slate-50 border-b border-violet-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
              status === "listening"
                ? "bg-rose-50 border-rose-200 text-rose-600"
                : status === "processing"
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-violet-50 border-violet-200 text-violet-700"
            }`}
          >
            <Mic className={`w-4 h-4 ${status === "listening" ? "animate-pulse" : ""}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-900">Ambient AI Scribe</span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  status === "listening"
                    ? "bg-rose-100 text-rose-800 border-rose-200"
                    : status === "processing"
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
              Live mic + transcript, then Pulse AI fills the Rx. Review highlighted fields before signing.
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

      {micError && (
        <div
          role="alert"
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
              <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? "bg-rose-500 animate-ping" : "bg-slate-300"}`} />
              <span className="text-[11px] font-semibold text-slate-600">
                {isRecording ? "Live mic + visualizer" : "Microphone idle"}
              </span>
            </div>
            <div className="flex items-end gap-0.5 h-6 px-2 py-0.5 bg-slate-50 rounded border border-slate-200" aria-hidden>
              {bars.map((h, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full ${isRecording ? "bg-rose-500" : "bg-slate-300"}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleToggleRecording()}
              aria-label={isRecording ? "Stop listening" : "Start listening / Live mic"}
              title={isRecording ? "Stop the live microphone" : "Request microphone access and start live transcription"}
              className={`px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 ${
                isRecording ? "bg-rose-600 text-white" : "bg-violet-600 text-white hover:bg-violet-700"
              }`}
            >
              {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              <span>{isRecording ? "Stop listening" : "Start listening"}</span>
              {!isRecording && <span className="opacity-80 font-medium">/ Live mic</span>}
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

          <div className="flex flex-wrap gap-1">
            {DEMO_CONSULTS.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => {
                  setFinalTranscript(sample.text);
                  setInterimTranscript("");
                  setGeneratedSoap(null);
                  setAppliedSuccess(false);
                  setMicError(null);
                }}
                className="px-2 py-1 rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[10px] text-slate-600"
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase font-bold tracking-wider">
            <span>Captured consult text</span>
            <span className="normal-case font-medium">{transcript.length} chars</span>
          </div>
          <textarea
            value={transcript}
            onChange={(e) => {
              setFinalTranscript(e.target.value);
              setInterimTranscript("");
            }}
            rows={6}
            placeholder="Transcript is empty until you start the live mic or type the consult here…"
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
              Rx fields auto-populated
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Continue to Rx (Auto-populate Fields)
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

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
};

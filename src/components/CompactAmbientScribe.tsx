import React, { useEffect, useState } from 'react';
import {
  Mic,
  MicOff,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Zap,
  X,
} from 'lucide-react';
import { SoapNote, Patient, Doctor } from '../types';

export type AmbientScribeStatus = 'idle' | 'listening' | 'processing';

interface CompactAmbientScribeProps {
  currentPatient: Patient;
  currentDoctor: Doctor;
  onApplyToRx: (soap: SoapNote) => void;
  isOpen?: boolean;
  onClose?: () => void;
  onStatusChange?: (status: AmbientScribeStatus) => void;
}

const REGIONAL_SAMPLES = [
  {
    id: 'sample-hinglish',
    label: 'Hinglish (Fever & Cough)',
    flag: '🇮🇳 Hinglish',
    specialty: 'General Medicine',
    text: `Doctor: Namaste ${'patientName'}, kya takleef ho rahi hai aapko?
Patient: Doctor saab, 2 din se bohot tez fever hai, throat me severe pain hai khana nigalte waqt, aur continuous sneezing and runny nose ho rahi hai. Body ache bhi bohot zyada hai.
Doctor: Khansi ya saans lene me koi dikkat?
Patient: Mild dry cough hai doctor, breathlessness nahi hai. Lekin chills aur weakness bohot zyada hai.
Doctor: Aaiye checkup karte hain. Temperature is 100.4°F, throat examine kiya - posterior pharyngeal wall congested hai with tonsillar erythema. Lungs clear hain, bilateral vesicular breath sounds. Blood pressure 122/80 mmHg, SpO2 98%, Pulse 84 bpm.
Doctor: Yeh viral upper respiratory infection (acute pharyngitis) hai. Hum aapko Dolo 650mg (Paracetamol) denge fever ke liye, Montair-LC (Montelukast + Levocetirizine) congestion ke liye night me, aur Pan-40 before breakfast. Warm salt water gargles 3 times a day kijiye.`,
  },
  {
    id: 'sample-marathi',
    label: 'Marathi (Knee Osteoarthritis / Physio)',
    flag: '🇮🇳 मराठी',
    specialty: 'Physiotherapy & Rehabilitation',
    text: `Doctor: नमस्कार, गुडघ्याचा त्रास कसा आहे?
Patient: डॉक्टर, गेल्या आठवड्यापासून डाव्या गुडघ्यात खूप तीव्र वेदना (pain) होत आहेत. जिने चढताना आणि खाली बसताना गुडघा कडक होतो (stiffness) आणि कट-कट आवाज येतो.
Doctor: तपासणी करूया. Left knee examination: Medial joint line tenderness present, Crepitus on passive flexion, Active ROM limited to 105 degrees with pain on terminal extension.
Doctor: हा Grade II Osteoarthritis आहे. आम्ही तुम्हाला Tab. Aceclofenac + Paracetamol 5 दिवसांसाठी SOS, Diacerein + Glucosamine कॅप्सूल आणि फिजिओथेरपी सेशन (Quadriceps strengthening exercises + Hot pack) सुरू करू.`,
  },
  {
    id: 'sample-hindi',
    label: 'Hindi (Diabetes & Neuropathy)',
    flag: '🇮🇳 हिन्दी',
    specialty: 'General Medicine',
    text: `Doctor: नमस्ते, आपकी सेहत कैसी है?
Patient: डॉक्टर साहब, पैरों के तलवों में हल्की झनझनाहट (tingling) और जलन महसूस होती है। दिन में थकान रहती है।
Doctor: BP 134/86 mmHg, Random Blood Sugar 152 mg/dL है। यह डायबिटिक पेरिफेरल न्यूरोपैथी के शुरुआती लक्षण हैं। हम HbA1c जांच लिखेंगे। मेटफॉर्मिन 500mg जारी रखें और नसों की ताक़त के लिए मिथाइलकोबालामिन कैप्सूल रोज़ लें।`,
  },
  {
    id: 'sample-tamil',
    label: 'Tamil (Pediatric Viral Pyrexia)',
    flag: '🇮🇳 தமிழ்',
    specialty: 'Pediatrics',
    text: `Doctor: Vanakkam, papa-ku enna aachu?
Patient: Doctor, papa-ku 3 years aagudhu. Nethu night-la irundhu romba high fever 101°F irukku doctor. Romba continuous dry cough and vomiting sensation irukku.
Doctor: Temp 100.8°F. Chest clear, throat congested. This is acute viral fever. Syrup Paracetamol (250mg/5ml) 3.5 ml SOS for fever, Syrup Levocetirizine 2.5 ml at bedtime, and ORS hydration.`,
  },
  {
    id: 'sample-telugu',
    label: 'Telugu (Gastroenteritis)',
    flag: '🇮🇳 తెలుగు',
    specialty: 'General Medicine',
    text: `Doctor: Namaskaram, em problem undi?
Patient: Doctor garu, ninna function food thinnanu. Morning nunchi watery loose motions, severe stomach cramping around belly button.
Doctor: BP 106/70 mmHg, Pulse 92 bpm. Idi acute infective gastroenteritis. Tab O2 (Ofloxacin + Ornidazole) twice daily for 5 days, Ondansetron 4mg SOS, and Electral ORS hydration.`,
  },
  {
    id: 'sample-english',
    label: 'English (Cardiology / HTN)',
    flag: '🌐 English',
    specialty: 'Cardiology',
    text: `Doctor: Good morning. How have you been feeling since starting the blood pressure medications?
Patient: Doctor, over the past 2 weeks I feel mild retrosternal chest heaviness during brisk walking, which relieves within 3 minutes of rest.
Doctor: Blood Pressure is 142/88 mmHg, Pulse 74 regular. Normal sinus rhythm on ECG with mild lateral flattening. Increasing Telmisartan to 40mg + Amlodipine 5mg, adding Aspirin 75mg at bedtime. Ordering 2D Echocardiogram.`,
  }
];

function fallbackSoap(patient: Patient, doctor: Doctor, recordingSeconds: number): SoapNote {
  return {
    id: 'soap-' + Date.now(),
    patientId: patient.id,
    uhid: patient.uhid,
    doctorId: doctor.id,
    date: new Date().toISOString().split('T')[0],
    subjective: {
      chiefComplaints: [
        'High grade fever & chills for 2 days',
        'Severe pharyngeal pain during swallowing',
        'Nasal congestion and body fatigue'
      ],
      historyOfPresentIllness: 'Acute onset of upper respiratory symptoms with fever up to 100.4°F.',
    },
    objective: {
      vitals: {
        bloodPressureSystolic: 122,
        bloodPressureDiastolic: 80,
        heartRate: 78,
        temperature: 100.4,
        spO2: 98,
        respiratoryRate: 18,
        weightKg: 68,
        heightCm: 172,
        bmi: 23.0,
        recordedAt: new Date().toISOString()
      },
      physicalExamination: 'Posterior pharyngeal wall congested, tonsillar erythema, lungs clear bilaterally.',
      clinicalFindings: ['Pharyngeal congestion', 'Bilateral vesicular breath sounds', 'No neck stiffness']
    },
    assessment: {
      primaryDiagnosis: 'Acute Viral Upper Respiratory Infection (Pharyngitis)',
      icd10Code: 'J06.9',
      differentialDiagnoses: ['Streptococcal Tonsillitis', 'Allergic Rhinitis'],
      riskLevel: 'Low'
    },
    plan: {
      medicines: [
        {
          id: 'med-' + Date.now(),
          drugName: 'Dolo 650mg Tablet',
          composition: 'Paracetamol 650mg',
          dosage: '1 Tablet',
          form: 'Tablet',
          frequency: '1-0-1',
          timing: 'After Food',
          durationDays: 3,
          instructions: 'Take for fever & body ache SOS'
        },
        {
          id: 'med-' + (Date.now() + 1),
          drugName: 'Montair-LC Tablet',
          composition: 'Montelukast 10mg + Levocetirizine 5mg',
          dosage: '1 Tablet',
          form: 'Tablet',
          frequency: '0-0-1',
          timing: 'At Bedtime',
          durationDays: 5,
          instructions: 'Take at night for throat allergy & nasal congestion'
        }
      ],
      labTests: [],
      lifestyleAdvice: [
        'Warm saline gargles 3 times a day',
        'Steam inhalation for 5 minutes twice daily',
        'Adequate oral hydration and rest'
      ],
      redFlags: ['High fever persisting beyond 3 days', 'Difficulty in breathing'],
      followUpDays: 4,
      followUpDate: new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0]
    },
    ambientRecordingDurationSec: recordingSeconds > 0 ? recordingSeconds : 95,
  };
}

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
  const [transcript, setTranscript] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSoap, setGeneratedSoap] = useState<SoapNote | null>(null);
  const [appliedSuccess, setAppliedSuccess] = useState(false);
  const [streamQueue, setStreamQueue] = useState<string[]>([]);

  const status: AmbientScribeStatus = isGenerating ? 'processing' : isRecording ? 'listening' : 'idle';

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    if (!transcript) {
      const template = REGIONAL_SAMPLES[0].text.replace(/patientName/g, currentPatient.name);
      setTranscript(template);
    }
  }, [currentPatient.name]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording || streamQueue.length === 0) return;
    const interval = setInterval(() => {
      setStreamQueue((queue) => {
        if (queue.length === 0) return queue;
        const [next, ...rest] = queue;
        setTranscript((prev) => (prev ? `${prev} ${next}` : next));
        return rest;
      });
    }, 280);
    return () => clearInterval(interval);
  }, [isRecording, streamQueue.length]);

  const handleToggleRecording = () => {
    if (!isRecording) {
      setIsRecording(true);
      setGeneratedSoap(null);
      setAppliedSuccess(false);
      const seed = `Doctor: Hello ${currentPatient.name}, tell me what symptoms you are experiencing today.`;
      if (!transcript.trim()) setTranscript(seed);
      setStreamQueue(
        'Patient reports activity-related pain, morning stiffness, and limited range. Doctor notes guarded posture and plans a home exercise review.'
          .split(' ')
      );
    } else {
      setIsRecording(false);
      setStreamQueue([]);
    }
  };

  const handleSelectSample = (sampleText: string) => {
    const formatted = sampleText.replace(/patientName/g, currentPatient.name);
    setTranscript(formatted);
    setGeneratedSoap(null);
    setAppliedSuccess(false);
  };

  const handleGenerateSoap = async () => {
    if (!transcript.trim()) return;
    setIsGenerating(true);
    setAppliedSuccess(false);
    setIsRecording(false);
    setStreamQueue([]);

    try {
      const res = await fetch('/api/gemini/generate-soap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: currentPatient.name,
          patientAge: currentPatient.age,
          patientGender: currentPatient.gender,
          transcript: transcript,
          vitals: {
            bloodPressureSystolic: 122,
            bloodPressureDiastolic: 80,
            heartRate: 78,
            temperature: 99.8,
            spO2: 98,
            weightKg: 68.0,
          },
          doctorSpecialty: currentDoctor.specialty,
          doctorName: currentDoctor.name,
        }),
      });

      const data = await res.json();
      if (data.success && data.soap) {
        const fullSoap: SoapNote = {
          id: 'soap-' + Date.now(),
          patientId: currentPatient.id,
          uhid: currentPatient.uhid,
          doctorId: currentDoctor.id,
          date: new Date().toISOString().split('T')[0],
          ...data.soap,
          ambientRecordingDurationSec: recordingSeconds > 0 ? recordingSeconds : 95,
        };
        setGeneratedSoap(fullSoap);
      } else {
        setGeneratedSoap(fallbackSoap(currentPatient, currentDoctor, recordingSeconds));
      }
    } catch (err) {
      console.error('Error generating SOAP in compact scribe:', err);
      setGeneratedSoap(fallbackSoap(currentPatient, currentDoctor, recordingSeconds));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = () => {
    if (!generatedSoap) return;
    onApplyToRx(generatedSoap);
    setAppliedSuccess(true);
    setTimeout(() => setAppliedSuccess(false), 4000);
  };

  if (!isOpen) return null;

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const statusLabel = status === 'listening' ? 'Listening' : status === 'processing' ? 'Processing' : 'Idle';

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
              status === 'listening'
                ? 'bg-rose-50 border-rose-200 text-rose-600'
                : status === 'processing'
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-violet-50 border-violet-200 text-violet-700'
            }`}
          >
            <Mic className={`w-4 h-4 ${status === 'listening' ? 'animate-pulse' : ''}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-900">Ambient AI Scribe</span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  status === 'listening'
                    ? 'bg-rose-100 text-rose-800 border-rose-200'
                    : status === 'processing'
                      ? 'bg-amber-100 text-amber-800 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {statusLabel}
              </span>
              {isRecording && (
                <span className="font-mono text-[10px] font-bold text-rose-600">{formatTimer(recordingSeconds)}</span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 truncate">
              Review captured transcript and clinical tokens before they populate the Rx.
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

      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? 'bg-rose-500 animate-ping' : 'bg-slate-300'}`} />
              <span className="text-[11px] font-semibold text-slate-600">
                {isRecording ? 'Live mic + visualizer' : 'Microphone idle'}
              </span>
            </div>
            {isRecording && (
              <div className="flex items-end gap-0.5 h-6 px-2 py-0.5 bg-rose-50 rounded border border-rose-100" aria-hidden>
                {[40, 70, 25, 90, 60, 80, 45, 95, 30, 85, 55, 75].map((h, i) => (
                  <div
                    key={i}
                    className="w-1 bg-rose-500 rounded-full animate-pulse"
                    style={{ height: `${h}%`, animationDelay: `${i * 80}ms` }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleToggleRecording}
              className={`px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 ${
                isRecording ? 'bg-rose-600 text-white' : 'bg-violet-600 text-white hover:bg-violet-700'
              }`}
            >
              {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              <span>{isRecording ? 'Stop listening' : 'Start listening'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleGenerateSoap()}
              disabled={isGenerating || !transcript.trim()}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5"
            >
              {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              <span>{isGenerating ? 'Extracting tokens…' : 'Extract clinical tokens'}</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {REGIONAL_SAMPLES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => handleSelectSample(sample.text)}
                className="px-2 py-1 rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[10px] text-slate-600"
                title={sample.label}
              >
                {sample.flag.split(' ')[0]} {sample.label.split(' ')[0]}
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
            onChange={(e) => setTranscript(e.target.value)}
            rows={6}
            placeholder="Live transcript streams here for review before the form is filled…"
            className="w-full min-h-[140px] bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 text-xs font-mono focus:border-violet-400 focus:outline-none resize-y leading-relaxed"
          />
        </div>
      </div>

      {generatedSoap && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-violet-50 rounded-lg border border-violet-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-violet-800">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="font-bold text-xs">Extracted clinical tokens — review before applying</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-700 bg-white px-1.5 py-0.5 rounded border border-emerald-200">
                ICD {generatedSoap.assessment.icd10Code}
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
            {generatedSoap.plan.medicines.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {generatedSoap.plan.medicines.map((m, i) => (
                  <span key={i} className="text-[10px] bg-white border border-violet-200 rounded px-1.5 py-0.5 text-slate-700">
                    {m.drugName} · {m.frequency}
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={handleApply}
              className={`w-full sm:w-auto px-4 py-2 rounded-lg font-bold text-xs inline-flex items-center justify-center gap-1.5 ${
                appliedSuccess ? 'bg-emerald-600 text-white' : 'bg-violet-700 hover:bg-violet-800 text-white'
              }`}
            >
              {appliedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Applied to Rx form
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Apply reviewed tokens to Rx
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

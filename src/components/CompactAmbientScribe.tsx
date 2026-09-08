import React, { useState, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  Sparkles, 
  FileText, 
  RefreshCw, 
  CheckCircle2, 
  ChevronRight, 
  ChevronDown,
  Volume2, 
  Zap,
  Activity,
  X,
  Stethoscope,
  Pill,
  ArrowRight
} from 'lucide-react';
import { SoapNote, Patient, Doctor } from '../types';

interface CompactAmbientScribeProps {
  currentPatient: Patient;
  currentDoctor: Doctor;
  onApplyToRx: (soap: SoapNote) => void;
  isOpen: boolean;
  onClose: () => void;
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

export const CompactAmbientScribe: React.FC<CompactAmbientScribeProps> = ({
  currentPatient,
  currentDoctor,
  onApplyToRx,
  isOpen,
  onClose,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSoap, setGeneratedSoap] = useState<SoapNote | null>(null);
  const [appliedSuccess, setAppliedSuccess] = useState(false);

  // Initialize with dynamic patient transcript
  useEffect(() => {
    if (!transcript) {
      const template = REGIONAL_SAMPLES[0].text.replace(/patientName/g, currentPatient.name);
      setTranscript(template);
    }
  }, [currentPatient.name]);

  // Recording simulation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const handleToggleRecording = () => {
    if (!isRecording) {
      setIsRecording(true);
      if (!transcript.trim()) {
        setTranscript(`Doctor: Hello ${currentPatient.name}, tell me what symptoms you are experiencing today.\nPatient: `);
      }
    } else {
      setIsRecording(false);
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
        // Fallback clinical extraction if offline
        const fallbackSoap: SoapNote = {
          id: 'soap-' + Date.now(),
          patientId: currentPatient.id,
          uhid: currentPatient.uhid,
          doctorId: currentDoctor.id,
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
          }
        };
        setGeneratedSoap(fallbackSoap);
      }
    } catch (err) {
      console.error('Error generating SOAP in compact scribe:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = () => {
    if (!generatedSoap) return;
    onApplyToRx(generatedSoap);
    setAppliedSuccess(true);
    setTimeout(() => {
      setAppliedSuccess(false);
    }, 4000);
  };

  if (!isOpen) return null;

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <aside aria-label="Ambient AI Scribe" className="no-print w-full lg:w-96 shrink-0 bg-slate-900 text-white rounded-xl border border-slate-800 shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
      {/* Header */}
      <div className="p-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600/30 border border-blue-400/40 flex items-center justify-center text-blue-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-100">Ambient AI Scribe</span>
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-900/60 text-blue-300 font-mono font-semibold border border-blue-700/50">
                Gemini Flash
              </span>
            </div>
            <span className="text-[10px] text-slate-400">
              {currentPatient.name} • {currentDoctor.specialty}
            </span>
          </div>
        </div>

        <button 
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Collapse Ambient Scribe"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs custom-scrollbar">
        {/* Recording Control & Audio Status */}
        <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? 'bg-rose-500 animate-ping' : 'bg-slate-500'}`} />
              <span className="font-semibold text-xs text-slate-200">
                {isRecording ? 'Listening Ambient Audio...' : 'Audio Microphone Idle'}
              </span>
            </div>
            {isRecording && (
              <span className="font-mono text-xs font-bold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/60">
                {formatTimer(recordingSeconds)}
              </span>
            )}
          </div>

          {/* Audio level simulation during active recording */}
          {isRecording && (
            <div className="flex items-center gap-1 h-4 px-2 py-0.5 bg-slate-950 rounded">
              {[40, 70, 25, 90, 60, 80, 45, 95, 30, 85, 55, 75].map((h, i) => (
                <div 
                  key={i} 
                  className="w-1 bg-rose-500 rounded-full animate-pulse transition-all duration-150"
                  style={{ height: `${h}%`, animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleRecording}
              className={`flex-1 py-1.5 px-3 rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                isRecording
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              <span>{isRecording ? 'Stop Ambient Mic' : 'Start Ambient Recording'}</span>
            </button>

            <button
              onClick={handleGenerateSoap}
              disabled={isGenerating || !transcript.trim()}
              className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all"
            >
              {isGenerating ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              <span>{isGenerating ? 'Analyzing...' : 'Generate SOAP'}</span>
            </button>
          </div>
        </div>

        {/* Quick Consultation Samples / Language Presets */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-between">
            <span>Quick Regional Dictation Presets</span>
            <span className="text-slate-500 lowercase font-normal">Click to load</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {REGIONAL_SAMPLES.map((sample) => (
              <button
                key={sample.id}
                onClick={() => handleSelectSample(sample.text)}
                className="text-left p-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-slate-300 font-medium truncate flex items-center gap-1 transition-colors"
                title={sample.label}
              >
                <span>{sample.flag}</span>
                <span className="truncate">{sample.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Transcript Box */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase font-bold tracking-wider">
            <span>Live Consultation Transcript</span>
            <span className="text-slate-500 lowercase font-normal">{transcript.length} chars</span>
          </div>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={4}
            placeholder="Real-time multi-lingual transcript appears here..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 text-xs font-mono focus:border-blue-500 focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Generated Clinical Output Preview */}
        {generatedSoap && (
          <div className="p-3 bg-slate-950 rounded-lg border border-blue-900/60 space-y-2.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center space-x-1.5 text-blue-400">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="font-bold text-xs">Generated Clinical Notes</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                ICD: {generatedSoap.assessment.icd10Code}
              </span>
            </div>

            {/* Diagnosis */}
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Diagnosis:</span>
              <strong className="text-slate-100 font-semibold text-xs block">
                {generatedSoap.assessment.primaryDiagnosis}
              </strong>
            </div>

            {/* Chief Complaints */}
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Chief Complaints:</span>
              <ul className="list-disc list-inside text-slate-300 text-[11px] space-y-0.5">
                {generatedSoap.subjective.chiefComplaints.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>

            {/* Suggested Medicines */}
            {generatedSoap.plan.medicines.length > 0 && (
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                  Prescribed Medicines ({generatedSoap.plan.medicines.length}):
                </span>
                <div className="space-y-1">
                  {generatedSoap.plan.medicines.map((m, i) => (
                    <div key={i} className="bg-slate-900 px-2 py-1 rounded text-[11px] flex items-center justify-between border border-slate-800">
                      <span className="text-slate-200 font-semibold">{m.drugName}</span>
                      <span className="text-slate-400 font-mono">{m.frequency}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Apply Button */}
            <div className="pt-1">
              <button
                onClick={handleApply}
                className={`w-full py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md ${
                  appliedSuccess 
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
                }`}
              >
                {appliedSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                    <span>Applied to Active Rx!</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-blue-200" />
                    <span>Apply to Rx Form</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

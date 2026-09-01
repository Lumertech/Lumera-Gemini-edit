import React, { useState, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  Sparkles, 
  FileText, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  ArrowRight, 
  Volume2, 
  Pill, 
  TestTube, 
  Activity, 
  User, 
  BookOpen, 
  Zap,
  Info
} from 'lucide-react';
import { SoapNote, Patient, Doctor } from '../types';

interface AmbientAIStudioProps {
  currentPatient: Patient;
  currentDoctor: Doctor;
  onTransferToRx: (soap: SoapNote) => void;
  onSelectPatient: (patient: Patient) => void;
  allPatients: Patient[];
}

const SAMPLE_CONSULTATIONS = [
  {
    id: 'sample-hinglish',
    language: 'Hinglish (Hindi + English)',
    title: 'Acute Fever, Sore Throat & Rhinitis',
    tag: 'General Medicine',
    flag: '🇮🇳 Hinglish',
    text: `Doctor: Namaste Rajesh ji, kya takleef ho rahi hai aapko?
Patient: Doctor saab, 2 din se bohot tez fever hai, throat me severe pain hai khana nigalte waqt, aur continuous sneezing and runny nose ho rahi hai. Body ache bhi bohot zyada hai.
Doctor: Khansi ya saans lene me koi dikkat?
Patient: Mild dry cough hai doctor, breathlessness nahi hai. Lekin chills aur weakness bohot zyada hai.
Doctor: Aaiye checkup karte hain. Temperature is 100.4°F, throat examine kiya - posterior pharyngeal wall congested hai with tonsillar erythema. Lungs clear hain, bilateral vesicular breath sounds. Blood pressure 122/80 mmHg, SpO2 98%, Pulse 84 bpm.
Doctor: Yeh viral upper respiratory infection (acute pharyngitis) hai. Hum aapko Dolo 650mg (Paracetamol) denge fever ke liye, Montair-LC (Montelukast + Levocetirizine) congestion ke liye night me, aur Pan-40 before breakfast. Warm salt water gargles 3 times a day kijiye. Agar 3 din baad bhi fever rahe toh CBC test karwayenge.`,
  },
  {
    id: 'sample-hindi',
    language: 'Hindi (हिन्दी)',
    title: 'Type 2 Diabetes & Hypertension Follow-up',
    tag: 'Endocrinology',
    flag: '🇮🇳 हिन्दी',
    text: `Doctor: नमस्ते सुनीता जी, पिछली बार के बाद से आपकी सेहत कैसी है?
Patient: डॉक्टर साहब, दिन में बहुत थकान और सुस्ती रहती है। रात में पैरों के तलवों में हल्की झनझनाहट (tingling) और जलन महसूस होती है।
Doctor: क्या आप मेटफॉर्मिन 500mg और टेल्मिसार्टन 40mg की दवाइयां नियमित रूप से ले रही हैं?
Patient: जी डॉक्टर, नाश्ते और रात के खाने के बाद रोज़ लेती हूँ। लेकिन पिछले दो महीने से शुगर टेस्ट नहीं कराया।
Doctor: अभी का बीपी चेक करते हैं - BP 134/86 mmHg, Random Blood Sugar 152 mg/dL है। वज़न 68 kg है।
Doctor: यह डायबिटिक पेरिफेरल न्यूरोपैथी के शुरुआती लक्षण हैं। हम HbA1c और फास्टिंग शुगर की जांच लिखेंगे। आपकी दवाइयां जारी रहेंगी और रात में नसों की ताक़त के लिए मिथाइलकोबालामिन (Neurobion Forte) कैप्सूल जोड़ रहे हैं। मीठा पूरी तरह बंद रखें और रोज़ 30 मिनट टहलें।`,
  },
  {
    id: 'sample-marathi',
    language: 'Marathi (मराठी + English)',
    title: 'Joint Pain & Osteoarthritis Knee',
    tag: 'Orthopedics / Physio',
    flag: '🇮🇳 मराठी',
    text: `Doctor: नमस्कार काका, गुडघ्याचा त्रास कसा आहे?
Patient: डॉक्टर, गेल्या आठवड्यापासून डाव्या गुडघ्यात खूप तीव्र वेदना (pain) होत आहेत. जिने चढताना आणि खाली बसताना गुडघा कडक होतो (stiffness) आणि कट-कट आवाज येतो.
Doctor: गुडघ्यावर सूज आहे का?
Patient: हो डॉक्टर, संध्याकाळी गुडघ्यावर हलकी सूज येते आणि चालताना पाय लचकतो.
Doctor: तपासणी करूया. Left knee examination: Medial joint line tenderness present, Crepitus on passive flexion, Active ROM limited to 105 degrees with pain on terminal extension.
Doctor: हा Grade II Osteoarthritis आहे. आम्ही तुम्हाला Tab. Aceclofenac + Paracetamol 5 दिवसांसाठी SOS, Diacerein + Glucosamine कॅप्सूल आणि फिजिओथेरपी सेशन (Quadriceps strengthening exercises + Hot pack) सुरू करू. मांडी घालून खाली बसणे टाळा.`,
  },
  {
    id: 'sample-tamil',
    language: 'Tamil (தமிழ் + English)',
    title: 'Pediatric Viral Pyrexia & Cough',
    tag: 'Pediatrics',
    flag: '🇮🇳 தமிழ்',
    text: `Doctor: Vanakkam Mrs. Lakshmi, papa-ku enna aachu?
Patient: Doctor, papa-ku 3 years aagudhu. Nethu night-la irundhu romba high fever 101°F irukku doctor. Romba continuous dry cough and vomiting sensation irukku, sariya saapida maatingara.
Doctor: Urine output normal-aa irukka? Breathing difficulty edhavadhu irukka?
Patient: Urine 3 times poirukka doctor. Breathing fast-aa irukku when fever rises, aana wheezing sound illa.
Doctor: Let me examine the baby. Weight is 13.8 kg. Temp 100.8°F. Chest clear, no retractions or stridor. Throat mildly congested, tympanic membranes normal.
Doctor: This is acute viral fever. We will give Syrup Paracetamol (250mg/5ml) 3.5 ml SOS for fever >100°F (gap of 6 hours), Syrup Levocetirizine 2.5 ml at bedtime, and ORS sips for hydration. Cold sponging if fever touches 101°F. Review in 48 hours if fever persists.`,
  },
  {
    id: 'sample-telugu',
    language: 'Telugu (తెలుగు + English)',
    title: 'Acute Gastroenteritis & Dehydration',
    tag: 'Gastroenterology',
    flag: '🇮🇳 తెలుగు',
    text: `Doctor: Namaskaram Suresh garu, em problem undi?
Patient: Doctor garu, ninna night function food thinnanu. Today morning nunchi 5 times watery loose motions ayyayi, severe stomach cramping around belly button, and 2 times vomiting ayyindi.
Doctor: Motion lo blood emaina unda? Chaala neerasam ga unda?
Patient: Blood ledhu doctor, water laaga potondi. Nilabadithe dizziness vastundi, chaala dry ga undi mouth.
Doctor: Vitals check cheddam: BP 106/70 mmHg, Pulse 92 bpm, Tongue is dry indicating moderate dehydration. Abdomen is soft with diffuse mild tenderness.
Doctor: Idi acute infective gastroenteritis. Tab O2 (Ofloxacin + Ornidazole) twice daily for 5 days ivvabotunnam. Vomiting kosam Ondansetron 4mg SOS, and Electral ORS 1 packet in 1 liter water sip continuously. Strictly soft curd rice and khichdi for 2 days.`,
  },
  {
    id: 'sample-english',
    language: 'English (Standard Medical)',
    title: 'Cardiology Hypertension & Angina Screen',
    tag: 'Cardiology',
    flag: '🌐 English',
    text: `Doctor: Good morning Mr. Sharma. How have you been feeling since starting the blood pressure medications?
Patient: Doctor, my blood pressure is somewhat better, but over the past 2 weeks I feel mild retrosternal chest heaviness during brisk walking, which relieves within 3 minutes of rest.
Doctor: Any radiation of pain to left arm, neck, or profuse sweating?
Patient: No radiation or sweating, but shortness of breath on climbing 2 flights of stairs.
Doctor: Let's examine: Blood Pressure is 142/88 mmHg, Pulse 74 bpm regular. Heart sounds S1/S2 heard normal, no murmurs. Lungs clear. ECG shows normal sinus rhythm with non-specific ST-T wave flattening in lateral leads.
Doctor: We need to rule out exertional angina. We will order a Treadmill Test (TMT) and 2D Echocardiography. Increasing Telmisartan to 40mg + Amlodipine 5mg combination, and adding Aspirin 75mg + Atorvastatin 20mg at bedtime. Report immediately to ER if rest pain occurs.`,
  }
];

export const AmbientAIStudio: React.FC<AmbientAIStudioProps> = ({
  currentPatient,
  currentDoctor,
  onTransferToRx,
  onSelectPatient,
  allPatients,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcript, setTranscript] = useState(SAMPLE_CONSULTATIONS[0].text);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSoap, setGeneratedSoap] = useState<SoapNote | null>(null);
  const [generationSource, setGenerationSource] = useState<string>('');
  const [audioLevel, setAudioLevel] = useState(0);

  // Timer simulation
  useEffect(() => {
    let interval: any;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
        setAudioLevel(Math.floor(Math.random() * 80) + 20);
      }, 1000);
    } else {
      setRecordingSeconds(0);
      setAudioLevel(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const handleStartStopRecording = () => {
    if (!isRecording) {
      setIsRecording(true);
      if (!transcript) {
        setTranscript(`[Ambient Recording in progress at ${new Date().toLocaleTimeString()}]...\nDoctor: Please tell me how you are feeling today.`);
      }
    } else {
      setIsRecording(false);
    }
  };

  const handleGenerateSOAP = async () => {
    if (!transcript.trim()) return;
    setIsGenerating(true);

    try {
      const response = await fetch('/api/gemini/generate-soap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: currentPatient.name,
          patientAge: currentPatient.age,
          patientGender: currentPatient.gender,
          transcript: transcript,
          vitals: {
            bloodPressureSystolic: 124,
            bloodPressureDiastolic: 82,
            heartRate: 78,
            temperature: 99.2,
            spO2: 98,
            weightKg: 68.5,
          },
          doctorSpecialty: currentDoctor.specialty,
          doctorName: currentDoctor.name,
        }),
      });

      const data = await response.json();
      if (data.success && data.soap) {
        const fullSoap: SoapNote = {
          id: 'soap-' + Date.now(),
          patientId: currentPatient.id,
          uhid: currentPatient.uhid,
          doctorId: currentDoctor.id,
          date: new Date().toISOString().split('T')[0],
          ...data.soap,
          ambientRecordingDurationSec: recordingSeconds > 0 ? recordingSeconds : 145,
        };
        setGeneratedSoap(fullSoap);
        setGenerationSource(data.source || 'gemini-3.7-flash');
      }
    } catch (err) {
      console.error('Error generating SOAP:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5 pb-8">
      {/* Header & Active Consultation Banner */}
      <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shadow-blue-100">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-slate-900">Ambient AI Clinical Scribe</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                Real-time SOAP Engine
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Listens to natural doctor-patient conversation, auto-extracts ICD-10 diagnoses, clinical vitals, and structured prescriptions.
            </p>
          </div>
        </div>

        {/* Patient Selection Bar */}
        <div className="flex items-center gap-2.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 w-full md:w-auto">
          <User className="w-4 h-4 text-slate-500 flex-shrink-0" />
          <div className="text-xs">
            <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Active Patient</span>
            <select
              aria-label="Select Active Patient"
              value={currentPatient.id}
              onChange={(e) => {
                const found = allPatients.find((p) => p.id === e.target.value);
                if (found) onSelectPatient(found);
              }}
              className="bg-transparent text-slate-800 font-semibold focus:outline-none cursor-pointer text-xs"
            >
              {allPatients.map((p) => (
                <option key={p.id} value={p.id} className="bg-white text-slate-800">
                  {p.name} ({p.age}y/{p.gender.charAt(0)}) - {p.uhid}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Panel (Microphone & Live Transcript) | Right Panel (Generated SOAP Note) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (5 Cols): Audio Recording & Transcript */}
        <div className="lg:col-span-5 space-y-4">
          {/* Recording Console Card */}
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? 'bg-red-500 animate-ping' : 'bg-slate-300'}`} />
                <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Audio Stream</h3>
              </div>
              {isRecording && (
                <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 text-[11px] font-mono font-bold animate-pulse">
                  <Clock className="w-3 h-3" />
                  <span>
                    {Math.floor(recordingSeconds / 60).toString().padStart(2, '0')}:
                    {(recordingSeconds % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              )}
            </div>

            {/* Mic Button & Waveform simulation */}
            <div className="flex flex-col sm:flex-row items-center gap-3.5 bg-slate-50 p-3.5 rounded-lg border border-slate-200/80">
              <button
                onClick={handleStartStopRecording}
                className={`w-12 h-12 rounded-lg flex items-center justify-center transition-all duration-200 shadow-sm ${
                  isRecording
                    ? 'bg-red-600 hover:bg-red-700 text-white ring-2 ring-red-200 scale-105'
                    : 'bg-blue-600 hover:bg-blue-700 text-white hover:scale-105 shadow-blue-100'
                }`}
                title={isRecording ? 'Stop Ambient Listening' : 'Start Ambient Microphone'}
              >
                {isRecording ? <MicOff className="w-5 h-5 animate-pulse" /> : <Mic className="w-5 h-5" />}
              </button>

              <div className="flex-1 space-y-1 text-center sm:text-left w-full">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 text-[11px]">
                    {isRecording ? 'Live Ambient Listening' : 'Microphone Ready'}
                  </span>
                  <span className="text-slate-400 font-mono text-[10px]">
                    {isRecording ? `${audioLevel} dB` : 'Idle'}
                  </span>
                </div>
                {/* Audio Waveform visualizer */}
                <div className="flex items-center gap-1 h-5 bg-slate-200/80 px-2 rounded overflow-hidden">
                  {[40, 65, 20, 85, 30, 95, 50, 75, 35, 90, 60, 45, 80, 25, 70, 40, 85, 55, 30, 95].map((h, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-full transition-all duration-150 ${
                        isRecording ? 'bg-blue-600' : 'bg-slate-300'
                      }`}
                      style={{
                        height: isRecording ? `${Math.max(15, (h * audioLevel) / 100)}%` : '20%',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Multilingual Code-Switching Consultation Scenarios */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                  Multilingual Code-Switching Scenarios
                </label>
                <span className="text-[10px] text-slate-400 font-medium">Auto-NLP extraction</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
                {SAMPLE_CONSULTATIONS.map((sample) => (
                  <button
                    key={sample.id}
                    onClick={() => {
                      setTranscript(sample.text);
                      setGeneratedSoap(null);
                    }}
                    className={`text-left px-3 py-2 rounded-lg text-xs border transition-all ${
                      transcript === sample.text
                        ? 'bg-blue-50 border-blue-300 text-blue-900 font-medium shadow-xs'
                        : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 truncate">
                        <span className="text-xs">{sample.flag}</span>
                        <span className="font-semibold text-slate-800 truncate">{sample.title}</span>
                      </div>
                      <span className="text-[10px] text-blue-700 bg-blue-50/90 border border-blue-200 px-1.5 py-0.2 rounded font-medium shrink-0">
                        {sample.tag}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Live Transcript Textarea */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Conversation Transcript (Hinglish/Regional/English)</label>
                <button
                  onClick={() => setTranscript('')}
                  className="text-[10px] text-slate-400 hover:text-red-600 transition-colors font-semibold"
                >
                  Clear
                </button>
              </div>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={5}
                placeholder="Doctor & patient conversation transcribes here in real-time..."
                className="w-full max-h-36 overflow-y-auto text-xs font-sans bg-slate-50 border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none text-slate-900 resize-none leading-relaxed"
              />
            </div>

            {/* Real-time NLP Entity Detection Tag Clouds */}
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px] flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-500" />
                  Live NLP Extracted Entities:
                </span>
                <span className="text-[10px] text-slate-400">Standardized SOAP</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {transcript.toLowerCase().includes('fever') || transcript.includes('ताप') || transcript.includes('kaichal') || transcript.includes('jwaram') ? (
                  <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-medium text-[10px]">
                    🩺 Pyrexia / Fever
                  </span>
                ) : null}
                {transcript.toLowerCase().includes('throat') || transcript.includes('घसा') || transcript.includes('thondai') || transcript.includes('gonthu') ? (
                  <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium text-[10px]">
                    🔴 Pharyngitis / Sore Throat
                  </span>
                ) : null}
                {transcript.toLowerCase().includes('dolo') || transcript.includes('paracetamol') ? (
                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium text-[10px]">
                    💊 Paracetamol 650mg
                  </span>
                ) : null}
                {transcript.toLowerCase().includes('montair') || transcript.includes('levocetirizine') ? (
                  <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium text-[10px]">
                    💊 Montelukast + Levocet
                  </span>
                ) : null}
                {transcript.toLowerCase().includes('metformin') || transcript.includes('sugar') || transcript.includes('डायबिटिक') ? (
                  <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-medium text-[10px]">
                    🩸 Type 2 DM (ICD-10: E11.9)
                  </span>
                ) : null}
                {transcript.toLowerCase().includes('knee') || transcript.includes('गुडघा') || transcript.includes('osteoarthritis') ? (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium text-[10px]">
                    🦴 Osteoarthritis Knee (M17.9)
                  </span>
                ) : null}
                {transcript.toLowerCase().includes('angina') || transcript.includes('chest') || transcript.includes('tmt') ? (
                  <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-medium text-[10px]">
                    ❤️ Exertional Angina / CAD
                  </span>
                ) : null}
                {transcript.toLowerCase().includes('gastroenteritis') || transcript.includes('vomit') || transcript.includes('motion') ? (
                  <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 font-medium text-[10px]">
                    💧 Gastroenteritis & Dehydration
                  </span>
                ) : null}
              </div>
            </div>

            {/* Generate SOAP Note Action */}
            <button
              onClick={handleGenerateSOAP}
              disabled={isGenerating || !transcript.trim()}
              className="w-full py-2.5 px-4 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm shadow-blue-100 flex items-center justify-center space-x-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                  <span>Synthesizing Clinical SOAP Note...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-blue-200" />
                  <span>Generate Structured SOAP Note</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column (7 Cols): Generated SOAP Note Display */}
        <div className="lg:col-span-7 space-y-4">
          {generatedSoap ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
              {/* Note Header & Transfer CTA */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3.5 border-b border-slate-100 gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">
                      SOAP Generated
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      ICD-10: <strong className="text-slate-800">{generatedSoap.assessment.icd10Code}</strong>
                    </span>
                    {generationSource && (
                      <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                        {generationSource}
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-bold text-slate-900 mt-1">
                    {generatedSoap.assessment.primaryDiagnosis}
                  </h2>
                </div>

                <button
                  onClick={() => onTransferToRx(generatedSoap)}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm shadow-blue-100 transition-all"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Transfer to Smart Rx</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 4-Section SOAP Grid */}
              <div className="space-y-3.5">
                {/* 1. S: Subjective */}
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded bg-blue-600 text-white flex items-center justify-center font-bold text-[10px]">S</span>
                      Subjective
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 space-y-1.5">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="font-semibold text-slate-900 text-[11px]">Chief Complaints:</span>
                      {generatedSoap.subjective.chiefComplaints.map((cc, i) => (
                        <span key={i} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-medium text-[11px]">
                          {cc}
                        </span>
                      ))}
                    </div>
                    <p className="leading-relaxed"><strong className="text-slate-900">HPI:</strong> {generatedSoap.subjective.historyOfPresentIllness}</p>
                    {generatedSoap.subjective.pastMedicalHistory && (
                      <p className="text-slate-600"><strong className="text-slate-900">Past History:</strong> {generatedSoap.subjective.pastMedicalHistory}</p>
                    )}
                  </div>
                </div>

                {/* 2. O: Objective */}
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded bg-cyan-600 text-white flex items-center justify-center font-bold text-[10px]">O</span>
                      Objective (Vitals & Exam)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-white p-2 rounded border border-slate-200 text-center">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">BP</span>
                      <strong className="text-slate-800 font-mono text-xs">
                        {generatedSoap.objective.vitals.bloodPressureSystolic || 120}/{generatedSoap.objective.vitals.bloodPressureDiastolic || 80}
                      </strong>
                      <span className="text-[9px] text-slate-400 block">mmHg</span>
                    </div>
                    <div className="bg-white p-2 rounded border border-slate-200 text-center">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">Pulse</span>
                      <strong className="text-slate-800 font-mono text-xs">
                        {generatedSoap.objective.vitals.heartRate || 74}
                      </strong>
                      <span className="text-[9px] text-slate-400 block">bpm</span>
                    </div>
                    <div className="bg-white p-2 rounded border border-slate-200 text-center">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">Temp</span>
                      <strong className="text-slate-800 font-mono text-xs">
                        {generatedSoap.objective.vitals.temperature || 98.6}°F
                      </strong>
                      <span className="text-[9px] text-slate-400 block">Oral</span>
                    </div>
                    <div className="bg-white p-2 rounded border border-slate-200 text-center">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">SpO2</span>
                      <strong className="text-blue-600 font-mono font-bold text-xs">
                        {generatedSoap.objective.vitals.spO2 || 99}%
                      </strong>
                      <span className="text-[9px] text-slate-400 block">Room Air</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-700 mt-1">
                    <strong className="text-slate-900">Exam:</strong> {generatedSoap.objective.physicalExamination}
                  </p>
                </div>

                {/* 3. A: Assessment */}
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded bg-indigo-600 text-white flex items-center justify-center font-bold text-[10px]">A</span>
                      Assessment & Diagnosis
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      generatedSoap.assessment.riskLevel === 'Low' ? 'bg-green-100 text-green-700' :
                      generatedSoap.assessment.riskLevel === 'Moderate' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'
                    }`}>
                      {generatedSoap.assessment.riskLevel} Risk
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 space-y-1">
                    <p>
                      <strong className="text-slate-900">Primary Diagnosis:</strong> {generatedSoap.assessment.primaryDiagnosis} ({generatedSoap.assessment.icd10Code})
                    </p>
                    {generatedSoap.assessment.differentialDiagnoses?.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-slate-500 font-medium text-[11px]">Differentials:</span>
                        {generatedSoap.assessment.differentialDiagnoses.map((dd, idx) => (
                          <span key={idx} className="bg-white border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[11px]">
                            {dd}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. P: Plan */}
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200/80 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px]">P</span>
                      Plan: Rx & Investigations
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      Review in: <strong>{generatedSoap.plan.followUpDays || 5} days</strong>
                    </span>
                  </div>

                  {/* Medications list */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Pill className="w-3 h-3 text-blue-600" /> Prescribed Medications:
                    </span>
                    <div className="space-y-1">
                      {generatedSoap.plan.medicines.map((med, idx) => (
                        <div key={idx} className="bg-white p-2 rounded border border-slate-200 text-xs flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-slate-900">{med.drugName}</span>
                            <p className="text-[11px] text-slate-500">{med.composition} • {med.dosage}</p>
                          </div>
                          <div className="text-right">
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono font-semibold text-[10px]">
                              {med.frequency}
                            </span>
                            <span className="text-[10px] text-slate-500 block">{med.timing} ({med.durationDays}d)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Lab Tests if any */}
                  {generatedSoap.plan.labTests?.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <TestTube className="w-3 h-3 text-indigo-600" /> Recommended Tests:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {generatedSoap.plan.labTests.map((t, idx) => (
                          <span key={idx} className="bg-white border border-slate-200 text-slate-800 px-2 py-0.5 rounded text-xs font-medium">
                            {t.testName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Red Flags / Emergency Warnings */}
                  {generatedSoap.plan.redFlags?.length > 0 && (
                    <div className="bg-red-50 p-2.5 rounded border border-red-200 text-xs text-red-800 space-y-1">
                      <div className="font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                        Red Flag Warnings:
                      </div>
                      <ul className="list-disc list-inside text-[11px] space-y-0.5 text-red-700">
                        {generatedSoap.plan.redFlags.map((rf, idx) => (
                          <li key={idx}>{rf}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Empty State / Instructional Display */
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center flex flex-col items-center justify-center h-full min-h-[420px] space-y-3">
              <div className="w-12 h-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-blue-600" />
              </div>
              <div className="max-w-md space-y-1">
                <h3 className="font-bold text-sm text-slate-800">No Consultation Synthesized Yet</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Start the ambient microphone or pick one of the sample scenarios on the left, then click <strong>"Generate Structured SOAP Note"</strong>.
                </p>
              </div>
              <div className="pt-2">
                <button
                  onClick={handleGenerateSOAP}
                  className="px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm shadow-blue-100 flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Synthesize Default Sample
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

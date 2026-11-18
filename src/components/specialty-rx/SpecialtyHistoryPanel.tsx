import React, { useState } from 'react';
import { ClipboardList, ChevronDown, ChevronUp, Sparkles, PlusCircle, AlertCircle } from 'lucide-react';
import { PolyclinicSpecialty, SpecialtyHistoryData } from '../../types';

interface SpecialtyHistoryConfig {
  title: string;
  subtitle: string;
  complaints: string[];
  indiaFlags: string[];
  rosFocus: string;
  menstrualOrDevLabel?: string;
  menstrualOrDevPlaceholder?: string;
}

export const SPECIALTY_HISTORY_CONFIGS: Record<string, SpecialtyHistoryConfig> = {
  Gynecology: {
    title: 'OB-GYN Structured History (FOGSI / e-Sushrut Women Desk)',
    subtitle: 'Menstrual PALM-COEIN history, obstetric GPLA/BOH, fertility/consanguinity, and maternal red flags',
    complaints: [
      'Amenorrhea — Antenatal booking visit',
      'Heavy menstrual bleeding with clots (AUB)',
      'Irregular delayed cycles >45 days (PCOS screen)',
      'Severe spasmodic dysmenorrhea',
      'Pruritus vulvae & curdy white discharge',
      'Lower abdominal / chronic pelvic pain',
      'Primary / secondary subfertility evaluation',
      'Perimenopausal hot flushes & sleep disturbance',
    ],
    indiaFlags: [
      'Nutritional Iron-Deficiency Anemia screen',
      'Thyroid dysfunction screen (TSH)',
      'DIPSI 75g GDM risk / Family Hx T2DM',
      'Prior LSCS scar tenderness check',
      'Consanguineous marriage history checked',
      'Rubella & HPV vaccination status reviewed',
    ],
    rosFocus: 'No bleeding per vaginam, leaking PV, blurring of vision, epigastric pain, or dysuria unless noted.',
    menstrualOrDevLabel: 'Menstrual, Obstetric & Contraceptive Timeline',
    menstrualOrDevPlaceholder: 'e.g. Menarche 13y, cycles 3/28–30d regular, moderate flow, G2P1L1A0, prev FTND 2023',
  },
  Pediatrics: {
    title: 'Pediatric & Perinatal History (IAP / IMNCI / RBSK India)',
    subtitle: 'Birth & neonatal cry/NICU history, IYCF breastfeeding/weaning, immunization, and IMNCI danger signs',
    complaints: [
      'High-grade fever with chills',
      'Cough, coryza & noisy breathing',
      'Loose watery stools & vomiting',
      'Routine well-baby immunization & growth check',
      'Poor appetite / faltering weight gain',
      'Ear tugging / throat pain on swallowing',
      'Maculopapular rash with fever',
    ],
    indiaFlags: [
      'IMNCI General Danger Signs negative',
      'UIP / IAP Immunization card verified',
      'Exclusive breastfeeding (first 6m) / IYCF checked',
      'Deworming (Albendazole 6-monthly) status checked',
      'Vitamin D3 & Iron prophylaxis reviewed',
      'ORS + Zinc home readiness counselled',
    ],
    rosFocus: 'Child playful and alert between febrile spikes; adequate urine output (>6 wet diapers/day); no convulsions or chest indrawing.',
    menstrualOrDevLabel: 'Perinatal, Feeding & Milestone Summary',
    menstrualOrDevPlaceholder: 'e.g. Term NVD, BW 2.9 kg, cried immediately, no NICU stay, complementary home diet + milk, milestones age-appropriate',
  },
  'General Medicine': {
    title: 'Adult OPD & Tropical / NCD History (e-Sushrut / NPCDCS India)',
    subtitle: 'Acute febrile vector/waterborne triage, diabetes/hypertension NCD tracking, NTEP TB screen, and lifestyle habits',
    complaints: [
      'High-grade fever with retro-orbital pain & myalgia',
      'Routine Type 2 Diabetes & Hypertension review',
      'Dry / productive cough & sore throat',
      'Epigastric burning, reflux & bloating (APD)',
      'Generalized fatigue, pallor & hair fall',
      'Burning micturition & suprapubic discomfort',
      'Episodic throbbing headache',
    ],
    indiaFlags: [
      'Dengue / Malaria warning signs screened (bleeding, abdominal pain)',
      'NTEP 4-symptom TB screen negative (cough >2w, fever, weight loss, night sweats)',
      'NPCDCS Blood Pressure & Random/Fasting Glucose checked',
      'Recent outside street food / untreated water exposure asked',
      'NSAID self-medication avoided in febrile thrombocytopenia risk',
    ],
    rosFocus: 'No chest pain, breathlessness at rest, hemoptysis, hematemesis, melena, or focal neurological deficit.',
  },
  Cardiology: {
    title: 'Cardiovascular History & Indian CAD Risk Profile',
    subtitle: 'Angina/dyspnea NYHA grading, premature Indian CAD risk factors, prior PTCA/CABG/RHD, and DAPT compliance',
    complaints: [
      'Exertional retrosternal heaviness / angina',
      'Breathlessness on climbing 1 flight of stairs (NYHA II–III)',
      'Episodic palpitations & lightheadedness',
      'Bilateral ankle swelling & orthopnea',
      'Post-PTCA stent / hypertension medication review',
    ],
    indiaFlags: [
      'Premature CAD family history (<55y male / <65y female)',
      'Childhood Rheumatic Fever / valvular history screened',
      'Dietary salt/pickle/papad restriction counselled',
      'Strict DAPT / Statin / Beta-blocker adherence verified',
      'Smokeless tobacco (gutkha/khaini) & smoking screened',
    ],
    rosFocus: 'No resting syncope, paroxysmal nocturnal dyspnea (PND), hemoptysis, or claudication unless documented.',
  },
  Dermatology: {
    title: 'Dermatology, Cosmetology & Topical Exposure History',
    subtitle: 'Lesion evolution, OTC topical steroid combination cream misuse screen, seasonal/monsoon triggers, and atopy',
    complaints: [
      'Itchy annular erythematous plaques in groin/body folds (Tinea)',
      'Inflammatory facial acne papules & post-acne hyperpigmentation',
      'Symmetric malar hyperpigmented patches (Melasma)',
      'Diffuse hair fall / telogen effluvium',
      'Chronic scaly plaques on elbows/scalp',
      'Recurrent urticarial wheals & angioedema',
    ],
    indiaFlags: [
      'OTC triple/quadruple topical steroid cream misuse screened',
      'PPD hair dye / kumkum / cosmetic contact allergy asked',
      'Monsoon humidity / occlusive synthetic clothing trigger noted',
      'Household close-contact itching (scabies/dermatophytosis) checked',
      'Personal/family history of atopy (asthma, allergic rhinitis) noted',
    ],
    rosFocus: 'No mucosal ulceration, blistering/skin peeling, joint swelling, or systemic fever.',
  },
  Orthopedics: {
    title: 'Musculoskeletal, Trauma & Indian Functional ADL History',
    subtitle: 'Traumatic vs degenerative onset, mechanical vs inflammatory pain, Vitamin D/osteoporosis risk, and squatting/cross-legged ADL',
    complaints: [
      'Bilateral medial knee pain worse on stair climbing & squatting',
      'Low back ache radiating to lower limb (sciatica)',
      'Acute ankle / wrist twist & swelling following fall',
      'Painful restriction of overhead shoulder abduction',
      'Morning heel pain on first step (plantar fasciitis)',
      'Neck pain radiating to arm (cervical radiculopathy)',
    ],
    indiaFlags: [
      'Indian ADL assessed (squatting / cross-legged sitting / floor rising)',
      'Vitamin D3 & dietary calcium deficiency risk evaluated',
      'Cauda equina red flags negative (bowel/bladder retention, saddle anesthesia)',
      'Two-wheeler commute / prolonged desk posture ergonomics noted',
      'Prior bone-setter / oil massage manipulation history asked',
    ],
    rosFocus: 'Distal pulses palpable, sensation intact, no constitutional fever or unexplained weight loss.',
  },
  ENT: {
    title: 'ENT, Head-Neck & Oral Mucosal History',
    subtitle: 'Otology discharge/hearing, nasal allergy/DNS, throat dysphagia/hoarseness, vertigo, and Indian oral submucous screen',
    complaints: [
      'Recurrent mucopurulent ear discharge & reduced hearing (CSOM)',
      'Sneezing bouts, watery rhinorrhea & nasal block',
      'Throat pain, odynophagia & recurrent tonsillitis',
      'Brief positional spinning vertigo on turning in bed (BPPV)',
      'Hoarseness of voice >2 weeks / vocal strain',
      'Burning sensation to spicy food & reduced mouth opening (OSMF)',
    ],
    indiaFlags: [
      'Areca nut / gutkha / pan masala oral mucosal OSMF screen done',
      'Swimming / ear-bud self-cleaning trauma history asked',
      'Dust / seasonal air-pollution allergic trigger noted',
      'Intracranial / mastoiditis ear red flags negative',
    ],
    rosFocus: 'No facial nerve asymmetry, stridor, diplopia, neck mass, or aspiration.',
  },
  Ophthalmology: {
    title: 'Comprehensive Ophthalmic & Systemic Retinopathy History',
    subtitle: 'Visual acuity/blur, cataract glare, diabetic/hypertensive retinopathy duration, glaucoma family risk, and VDT strain',
    complaints: [
      'Gradual painless diminution of distance/near vision',
      'Glare at night & misty vision (cataract evaluation)',
      'Annual Diabetic & Hypertensive Retinopathy fundus screen',
      'Gritty burning eyes & digital screen fatigue',
      'Redness, watering & mucopurulent discharge',
    ],
    indiaFlags: [
      'Glycemic duration & latest HbA1c verified for DR staging',
      'Family history of glaucoma / raised IOP screened',
      'OTC steroid eye-drop self-medication ruled out',
      'Prior cataract surgery (PCIOL status OD/OS) recorded',
    ],
    rosFocus: 'No sudden curtain-like visual field loss, acute colored halos with nausea, or ocular trauma.',
  },
  Neurology: {
    title: 'Neurology Structured History (Headache, Epilepsy, Stroke & Neuropathy)',
    subtitle: 'Temporal onset, migraine aura/triggers, seizure semiology & AED adherence, and diabetic/B12 neuropathy',
    complaints: [
      'Unilateral pulsatile headache with photophobia & nausea',
      'Breakthrough generalized / focal seizure episode',
      'Burning tingling paresthesia in bilateral feet (glove-stocking)',
      'Transient slurred speech / limb weakness (TIA follow-up)',
      'Postural tremor / gait unsteadiness',
    ],
    indiaFlags: [
      'Vegetarian Vitamin B12 deficiency neuropathy screen',
      'Neurocysticercosis / CNS TB history screened in seizures',
      'Strict anti-epileptic / stroke secondary-prevention compliance checked',
      'Fasting / sunlight / sleep-deprivation migraine triggers noted',
    ],
    rosFocus: 'Higher mental functions intact; no thunderclap onset, neck stiffness, papilledema symptoms, or sphincter disturbance.',
  },
  'Dental Surgery': {
    title: 'Dental, Endodontic & Oral Habit Medical History',
    subtitle: 'Odontogenic pain character, gutkha/tobacco OSMF mouth-opening check, and systemic extraction/RCT precautions',
    complaints: [
      'Sharp lingering toothache to hot/cold & night pain (irreversible pulpitis)',
      'Bleeding gums, halitosis & heavy calculus deposits',
      'Pericoronal swelling around impacted lower third molar (#38/#48)',
      'Fractured restoration / missing molar prosthetic consult',
      'Sensitivity on biting & food lodgement',
    ],
    indiaFlags: [
      'Blood thinner (Aspirin / Clopidogrel) & BP/RBS checked pre-procedure',
      'Gutkha / betel quid / tobacco pouch keratosis & OSMF screened',
      'Local anesthetic (Lignocaine) & antibiotic allergy verified',
      'Infective endocarditis prophylaxis need screened',
    ],
    rosFocus: 'No Ludwig angina floor-of-mouth elevation, trismus <15mm, or uncontrolled gingival hemorrhage.',
  },
  'Physiotherapy & Rehabilitation': {
    title: 'Musculoskeletal Rehab & Ergonomic History',
    subtitle: 'Pain behavior (24-hr pattern), post-op protocol week, occupational ergonomics, and functional goals',
    complaints: [
      'Mechanical low back pain after prolonged desk sitting',
      'Post-operative knee/shoulder stiffness — rehab progression',
      'Frozen shoulder painful capsular restriction',
      'Sports ligament sprain & proprioceptive instability',
      'Cervical spondylosis with trapezius myofascial trigger points',
    ],
    indiaFlags: [
      'Surgical surgeon clearance / weight-bearing protocol verified',
      'Floor sitting, stair climbing & two-wheeler commute tolerance noted',
      'Red flags (unexplained fever, night pain, progressive motor loss) negative',
    ],
    rosFocus: 'Hemodynamically stable for active therapeutic exercise; skin integrity intact over electrotherapy sites.',
  },
  Veterinary: {
    title: 'Companion Animal History & Preventive Husbandry (WSAVA India)',
    subtitle: 'Appetite/water intake, tick/flea vector exposure, deworming, diet, and anti-rabies vaccination status',
    complaints: [
      'Annual DHPPiL / FVRCP + Anti-Rabies booster & wellness exam',
      'Inappetence, lethargy & tick-fever screen (Ehrlichia / Babesia)',
      'Pruritus, alopecia & otitis externa head shaking',
      'Acute vomiting / loose stools after dietary indiscretion',
    ],
    indiaFlags: [
      'Tick/flea ectoparasite prophylaxis & street-dog contact checked',
      'Anti-rabies vaccination currency verified',
      'Quarterly deworming & toxic human food (chocolate/onion/xylitol) ruled out',
    ],
    rosFocus: 'Mucous membranes pink, CRT <2 sec, alert demeanor unless otherwise recorded.',
  },
};

const COMMON_COMORBIDITIES = [
  'None / No Chronic Illness',
  'Type 2 Diabetes (T2DM)',
  'Hypertension (HTN)',
  'Hypothyroidism',
  'Bronchial Asthma',
  'Dyslipidemia',
  'Iron Deficiency Anemia',
  'PCOS',
  'CAD / Post-PTCA',
  'CKD',
  'Past TB (ATT Completed)',
];

const PERSONAL_HABITS = [
  'Vegetarian Diet',
  'Eggetarian Diet',
  'Mixed / Non-Veg Diet',
  'Non-Smoker & Teetotaller',
  'Smokeless Tobacco (Gutkha/Khaini)',
  'Cigarette / Bidi Smoker',
  'Occasional Alcohol',
  'Sedentary / IT Desk Job',
];

const COMPLIANCE_OTC = [
  'Regular on Prescribed Meds',
  'Irregular / Missed Doses',
  'Took OTC Paracetamol / NSAID',
  'Prior OTC Antibiotic Course',
  'OTC Steroid Cream Applied',
  'Concomitant Ayurvedic / Homeopathic Rx',
];

interface SpecialtyHistoryPanelProps {
  specialty: PolyclinicSpecialty;
  value?: SpecialtyHistoryData;
  chiefComplaints: string[];
  onChange: (next: SpecialtyHistoryData) => void;
  onAddComplaint: (complaint: string) => void;
  onSyncToSoap: (composed: {
    hpiText: string;
    pmhText: string;
    rosText: string;
  }) => void;
}

export const SpecialtyHistoryPanel: React.FC<SpecialtyHistoryPanelProps> = ({
  specialty,
  value,
  chiefComplaints,
  onChange,
  onAddComplaint,
  onSyncToSoap,
}) => {
  const [expanded, setExpanded] = useState<boolean>(true);
  const config = SPECIALTY_HISTORY_CONFIGS[specialty] || SPECIALTY_HISTORY_CONFIGS['General Medicine'];

  const data: SpecialtyHistoryData = value || {
    specialty,
    symptomDuration: '3 days',
    onsetPattern: 'Subacute / Gradual',
    selectedSymptoms: [],
    comorbidities: [],
    personalSocialHabits: [],
    medicationComplianceOtc: [],
    indiaClinicalFlags: [],
    familyAndConsanguinityHistory: '',
    menstrualOrDevelopmentalNotes: '',
  };

  const toggleList = (
    key: 'selectedSymptoms' | 'comorbidities' | 'personalSocialHabits' | 'medicationComplianceOtc' | 'indiaClinicalFlags',
    item: string
  ) => {
    const cur = data[key] || [];
    const next = cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
    onChange({ ...data, specialty, [key]: next });
  };

  const handleQuickComplaint = (complaint: string) => {
    const withDuration = data.symptomDuration
      ? `${complaint} (${data.symptomDuration})`
      : complaint;
    if (!chiefComplaints.includes(withDuration) && !chiefComplaints.includes(complaint)) {
      onAddComplaint(withDuration);
    }
    toggleList('selectedSymptoms', complaint);
  };

  const handleComposeSoap = () => {
    const hpiParts: string[] = [];
    const symptoms = (data.selectedSymptoms || []).length
      ? (data.selectedSymptoms || []).join('; ')
      : chiefComplaints.join('; ');
    if (symptoms) {
      hpiParts.push(
        `Presenting with ${symptoms}${data.onsetPattern ? ` (${data.onsetPattern.toLowerCase()} onset` : ''}${
          data.symptomDuration ? `, duration: ${data.symptomDuration}` : ''
        }${data.onsetPattern ? ')' : ''}.`
      );
    }
    if (data.menstrualOrDevelopmentalNotes?.trim()) {
      hpiParts.push(data.menstrualOrDevelopmentalNotes.trim());
    }
    if ((data.medicationComplianceOtc || []).length) {
      hpiParts.push(`Prior treatment / adherence: ${(data.medicationComplianceOtc || []).join(', ')}.`);
    }
    if ((data.indiaClinicalFlags || []).length) {
      hpiParts.push(`India clinical screen: ${(data.indiaClinicalFlags || []).join('; ')}.`);
    }

    const pmhParts: string[] = [];
    if ((data.comorbidities || []).length) {
      pmhParts.push(`Comorbidities: ${(data.comorbidities || []).join(', ')}.`);
    }
    if ((data.personalSocialHabits || []).length) {
      pmhParts.push(`Personal/Dietary: ${(data.personalSocialHabits || []).join(', ')}.`);
    }
    if (data.familyAndConsanguinityHistory?.trim()) {
      pmhParts.push(`Family Hx: ${data.familyAndConsanguinityHistory.trim()}.`);
    }

    onSyncToSoap({
      hpiText: hpiParts.join(' '),
      pmhText: pmhParts.join(' '),
      rosText: config.rosFocus,
    });
  };

  return (
    <div
      data-testid="specialty-history-panel"
      className="no-print bg-gradient-to-br from-slate-50 via-white to-teal-50/30 rounded-xl border border-slate-200 shadow-2xs overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-900 text-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-teal-500/20 border border-teal-400/30 text-teal-300 shrink-0">
            <ClipboardList className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-tight truncate">{config.title}</div>
            <div className="text-[11px] text-slate-300 truncate">{config.subtitle}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="sync-specialty-history-to-soap"
            onClick={handleComposeSoap}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shadow-xs transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Populate HPI / PMH / ROS</span>
          </button>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={expanded ? 'Collapse structured history' : 'Expand structured history'}
            className="p-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-800"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-3.5 text-xs">
          {/* Duration & Onset + Quick Complaint Templates */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
            <div className="md:col-span-3 grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Duration</label>
                <select
                  value={data.symptomDuration || '3 days'}
                  onChange={(e) => onChange({ ...data, specialty, symptomDuration: e.target.value })}
                  className="w-full mt-1 px-2 py-1.5 bg-white border border-slate-200 rounded-md text-xs font-semibold"
                >
                  <option value="1 day">1 day</option>
                  <option value="3 days">3 days</option>
                  <option value="5 days">5 days</option>
                  <option value="1 week">1 week</option>
                  <option value="2 weeks">2 weeks</option>
                  <option value="1 month">1 month</option>
                  <option value="3 months">3 months</option>
                  <option value="6+ months">6+ months</option>
                  <option value="Routine follow-up">Routine follow-up</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Onset</label>
                <select
                  value={data.onsetPattern || 'Subacute / Gradual'}
                  onChange={(e) => onChange({ ...data, specialty, onsetPattern: e.target.value })}
                  className="w-full mt-1 px-2 py-1.5 bg-white border border-slate-200 rounded-md text-xs font-semibold"
                >
                  <option value="Acute / Sudden">Acute / Sudden</option>
                  <option value="Subacute / Gradual">Subacute / Gradual</option>
                  <option value="Chronic / Recurrent">Chronic / Recurrent</option>
                  <option value="Preventive / Scheduled">Preventive / Scheduled</option>
                </select>
              </div>
            </div>

            <div className="md:col-span-9">
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                1-Click {specialty} Presenting Complaints (adds to Chief Complaints):
              </label>
              <div className="flex flex-wrap gap-1.5">
                {config.complaints.map((complaint) => {
                  const active = (data.selectedSymptoms || []).includes(complaint);
                  return (
                    <button
                      key={complaint}
                      type="button"
                      onClick={() => handleQuickComplaint(complaint)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                        active
                          ? 'bg-teal-100 text-teal-900 border-teal-400 font-bold'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-teal-300 hover:bg-teal-50/40'
                      }`}
                    >
                      <PlusCircle className="w-3 h-3 text-teal-600 shrink-0" />
                      <span>{complaint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Specialty-Specific Menstrual / Perinatal Note if applicable */}
          {config.menstrualOrDevLabel && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                {config.menstrualOrDevLabel}
              </label>
              <input
                type="text"
                value={data.menstrualOrDevelopmentalNotes || ''}
                onChange={(e) => onChange({ ...data, specialty, menstrualOrDevelopmentalNotes: e.target.value })}
                placeholder={config.menstrualOrDevPlaceholder}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs"
              />
            </div>
          )}

          {/* India Clinical Screening Checklists + Comorbidities */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                India Specialty Clinical &amp; Epidemiological Screen
              </label>
              <div className="flex flex-wrap gap-1.5">
                {config.indiaFlags.map((flag) => {
                  const active = (data.indiaClinicalFlags || []).includes(flag);
                  return (
                    <button
                      key={flag}
                      type="button"
                      onClick={() => toggleList('indiaClinicalFlags', flag)}
                      className={`px-2 py-0.5 rounded text-[11px] border transition-all ${
                        active
                          ? 'bg-amber-100 text-amber-950 border-amber-300 font-bold'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {active ? '✓ ' : ''}
                      {flag}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-600 uppercase block">
                Known Comorbidities (NPCDCS / Past Medical History)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_COMORBIDITIES.map((cond) => {
                  const active = (data.comorbidities || []).includes(cond);
                  return (
                    <button
                      key={cond}
                      type="button"
                      onClick={() => toggleList('comorbidities', cond)}
                      className={`px-2 py-0.5 rounded text-[11px] border transition-all ${
                        active
                          ? 'bg-blue-100 text-blue-900 border-blue-300 font-bold'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {active ? '✓ ' : ''}
                      {cond}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Personal/Dietary Habits, OTC/Adherence & Family History */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-600 uppercase block">
                Diet, Tobacco &amp; Lifestyle Habits
              </label>
              <div className="flex flex-wrap gap-1">
                {PERSONAL_HABITS.map((habit) => {
                  const active = (data.personalSocialHabits || []).includes(habit);
                  return (
                    <button
                      key={habit}
                      type="button"
                      onClick={() => toggleList('personalSocialHabits', habit)}
                      className={`px-2 py-0.5 rounded text-[11px] border transition-all ${
                        active
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300 font-bold'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {active ? '✓ ' : ''}
                      {habit}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-600 uppercase block">
                Rx Adherence &amp; Prior OTC / Alternative Meds
              </label>
              <div className="flex flex-wrap gap-1">
                {COMPLIANCE_OTC.map((item) => {
                  const active = (data.medicationComplianceOtc || []).includes(item);
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => toggleList('medicationComplianceOtc', item)}
                      className={`px-2 py-0.5 rounded text-[11px] border transition-all ${
                        active
                          ? 'bg-purple-100 text-purple-900 border-purple-300 font-bold'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {active ? '✓ ' : ''}
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-600 uppercase block">
                Family &amp; Hereditary / Consanguinity History
              </label>
              <input
                type="text"
                value={data.familyAndConsanguinityHistory || ''}
                onChange={(e) => onChange({ ...data, specialty, familyAndConsanguinityHistory: e.target.value })}
                placeholder="e.g. Father T2DM + HTN; Mother Hypothyroid; non-consanguineous"
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


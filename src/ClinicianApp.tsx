import React, { useEffect, useState } from 'react';
import { Navbar, NavView } from './components/Navbar';
import { Sidebar, ROLE_VISIBLE_VIEWS } from './components/Sidebar';
import { ShieldCheck } from 'lucide-react';
import { AmbientAIStudio } from './components/AmbientAIStudio';
import { PrescriptionWriter } from './components/PrescriptionWriter';
import { QueueBoard } from './components/QueueBoard';
import { AppointmentsCalendar } from './components/AppointmentsCalendar';
import { PolyclinicManager } from './components/PolyclinicManager';
import { WhatsAppAssistant } from './components/WhatsAppAssistant';
import { VoiceBotAssistant } from './components/VoiceBotAssistant';
import { BillingManager } from './components/BillingManager';
import { PatientPortal } from './components/PatientPortal';
import { WaitingRoomKiosk } from './components/WaitingRoomKiosk';
import { LabReportAnalyzer } from './components/LabReportAnalyzer';
import { ClinicTeamManager } from './components/ClinicTeamManager';
import { GeminiAssistant } from './components/GeminiAssistant';
import { Reception } from './components/Reception';
import { DhisMeter } from './components/dhis/DhisMeter';
import { 
  MOCK_DOCTORS, 
  MOCK_PATIENTS, 
  MOCK_APPOINTMENTS, 
  DEFAULT_CLINIC_SETTINGS 
} from './data/clinicalData';
import { 
  Patient, 
  Doctor, 
  Appointment, 
  Prescription, 
  SoapNote, 
  Vitals,
  PolyclinicSpecialty
} from './types';
import { apiFetch } from './api/http';
import { useAuth } from './auth/AuthContext';

export default function ClinicianApp() {
  const { user } = useAuth();
  // Default landing view: OPD Queue & Vitals so clinician starts from live patient queue
  const [currentView, setCurrentView] = useState<NavView>('queue');
  const [currentDoctor, setCurrentDoctor] = useState<Doctor>(MOCK_DOCTORS[0]);
  const [currentPatient, setCurrentPatient] = useState<Patient>(MOCK_PATIENTS[0]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  const [patients, setPatients] = useState<Patient[]>(MOCK_PATIENTS);
  const [doctors, setDoctors] = useState<Doctor[]>(MOCK_DOCTORS);
  const [appointments, setAppointments] = useState<Appointment[]>(MOCK_APPOINTMENTS);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [activeSoapData, setActiveSoapData] = useState<SoapNote | null>(null);
  const [selectedSpecialty, setSelectedSpecialty] = useState<PolyclinicSpecialty | 'All'>('All');
  const [isHexaOpen, setIsHexaOpen] = useState(false);

  // Specialty locking enforcement for doctor accounts
  const isSpecialtyLocked = user?.role === 'doctor' || Boolean(user?.specialty) || user?.practiceType === 'individual';
  const lockedSpecialty = user?.specialty || (user?.role === 'doctor' ? currentDoctor.specialty : undefined);

  // Bind active clinician profile to logged-in user specialty if specified
  useEffect(() => {
    if (user?.specialty) {
      const match = doctors.find(
        (d) => d.specialty.toLowerCase().includes(user.specialty!.toLowerCase())
      );
      if (match) setCurrentDoctor(match);
    }
  }, [user?.specialty, doctors]);

  useEffect(() => {
    apiFetch<{ doctors: Doctor[] }>('/api/doctors')
      .then((d) => {
        if (d.doctors?.length) {
          setDoctors(d.doctors as Doctor[]);
          setCurrentDoctor((prev) => d.doctors.find((x) => x.id === prev.id) || d.doctors[0]);
        }
      })
      .catch(() => undefined);
  }, []);

  // SAFETY: the sidebar's patient switcher is intentionally always visible
  // (a receptionist may need to jump between patients quickly), but it must
  // never silently pull a doctor out from under an in-progress note or
  // prescription for a different patient — that's how clinical documentation
  // ends up attached to the wrong chart. Views where the doctor is actively
  // writing into currentPatient's record require confirmation before the
  // context switches.
  const CLINICAL_DOCUMENTATION_VIEWS: NavView[] = ['ambient', 'rx'];
  const handleSelectPatient = (patient: Patient) => {
    if (
      CLINICAL_DOCUMENTATION_VIEWS.includes(currentView) &&
      patient.id !== currentPatient.id
    ) {
      const confirmed = window.confirm(
        `You're actively documenting for ${currentPatient.name}. Switching to ${patient.name} now will not move this unsaved note or prescription to the new patient's chart. Switch anyway?`
      );
      if (!confirmed) return;
    }
    setCurrentPatient(patient);
  };

  const handleTransferToRx = (soap: SoapNote) => {
    setActiveSoapData(soap);
    setCurrentView('rx');
  };

  const handleSavePrescription = (newRx: Prescription) => {
    setPrescriptions((prev) => [newRx, ...prev.filter((p) => p.id !== newRx.id)]);
    // Mark patient's current appointment in consultation as Completed
    setAppointments((prev) =>
      prev.map((a) =>
        a.patientId === newRx.patientId && a.status === 'In Consultation'
          ? { ...a, status: 'Completed' }
          : a
      )
    );
  };

  const handleUpdateAppointmentStatus = (id: string, status: Appointment['status']) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: status } : a))
    );
  };

  const handleUpdateVitals = (id: string, vitals: Vitals) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, vitals: vitals } : a))
    );
  };

  const handleStartConsultation = (apt: Appointment) => {
    const p = patients.find((pat) => pat.id === apt.patientId) || currentPatient;
    const d = doctors.find((doc) => doc.id === apt.doctorId) || currentDoctor;
    setCurrentPatient(p);
    setCurrentDoctor(d);
    handleUpdateAppointmentStatus(apt.id, 'In Consultation');
    // Seamlessly navigate directly to Smart Rx Studio for the active consultation
    setCurrentView('rx');
  };

  const handleOpenBillForAppointment = (apt: Appointment) => {
    const p = patients.find((pat) => pat.id === apt.patientId) || currentPatient;
    setCurrentPatient(p);
    setCurrentView('billing');
  };

  const handleAddNewToken = (newToken: Partial<Appointment>) => {
    setAppointments((prev) => [newToken as Appointment, ...prev]);
  };

  const handleBookAppointment = (newApt: Partial<Appointment>) => {
    setAppointments((prev) => [newApt as Appointment, ...prev]);
  };

  const userRole = user?.role || 'doctor';
  let allowedViews = ROLE_VISIBLE_VIEWS[userRole] || ROLE_VISIBLE_VIEWS.doctor;
  if (user?.practiceType === 'individual') {
    allowedViews = allowedViews.filter(v => v !== 'team');
  }
  const isViewAllowed = allowedViews.includes(currentView) || currentView === 'opd-queue' || currentView === 'smart-rx';

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-100 text-slate-900 font-sans selection:bg-blue-600 selection:text-white">
      <Navbar
        currentView={currentView}
        onSelectView={setCurrentView}
        currentDoctor={currentDoctor}
        onSelectDoctor={setCurrentDoctor}
        allDoctors={doctors}
        onToggleHexa={() => setIsHexaOpen(!isHexaOpen)}
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isSidebarCollapsed={isSidebarCollapsed}
        userName={user?.name}
        userRole={user?.role}
        canOpenAdmin={user?.role === 'super_admin'}
        isSpecialtyLocked={isSpecialtyLocked}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          currentView={currentView}
          onSelectView={setCurrentView}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          currentPatient={currentPatient}
          onSelectPatient={handleSelectPatient}
          allPatients={patients}
          currentDoctor={currentDoctor}
        />

        <main className="flex-1 min-w-0 h-full overflow-y-auto bg-slate-100/70 p-4 sm:p-6 lg:p-8 flex flex-col">
          {!isViewAllowed ? (
            <div className="flex flex-col items-center justify-center h-full p-8 bg-white rounded-xl shadow-sm border border-slate-200 text-center my-auto">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-4 mx-auto">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Access Restricted for Your Role</h2>
              <p className="text-slate-600 max-w-md mb-6 text-sm mx-auto">
                Your current user role (<span className="font-semibold text-slate-800">{userRole}</span>) does not have permission to access the <span className="font-semibold text-slate-800">{currentView}</span> module.
              </p>
              <button
                onClick={() => setCurrentView('queue')}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm mx-auto"
              >
                Return to OPD Queue
              </button>
            </div>
          ) : (
            <>
              {currentView === 'reception' && (
            <Reception
              patients={patients}
              doctors={doctors}
              appointments={appointments}
              onSelectPatient={setCurrentPatient}
              onAddNewPatient={(newPat) => {
                setPatients((prev) => [newPat, ...prev]);
              }}
              onCheckInPatient={(pat, doc, type) => {
                const newApt: Appointment = {
                  id: 'apt-' + Date.now(),
                  tokenNumber: appointments.length + 1,
                  patientId: pat.id,
                  patientName: pat.name,
                  uhid: pat.uhid,
                  patientPhone: pat.phone,
                  doctorId: doc.id,
                  doctorName: doc.name,
                  specialty: doc.specialty as PolyclinicSpecialty,
                  date: new Date().toISOString().split('T')[0],
                  timeSlot: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                  status: 'Waiting',
                  type: type || 'New Consultation',
                  source: 'Walk-in',
                  consultationFee: doc.consultationFee,
                  isPaid: false,
                };
                setAppointments((prev) => [...prev, newApt]);
              }}
              onSwitchToConsultation={() => setCurrentView('ambient')}
            />
          )}

          {currentView === 'dhis' && (
            <DhisMeter compact={false} />
          )}

          {currentView === 'ambient' && (
            <AmbientAIStudio
              currentPatient={currentPatient}
              currentDoctor={currentDoctor}
              onTransferToRx={handleTransferToRx}
              onSelectPatient={handleSelectPatient}
              allPatients={patients}
            />
          )}

          {currentView === 'rx' && (
            <PrescriptionWriter
              currentPatient={currentPatient}
              currentDoctor={currentDoctor}
              initialSoapData={activeSoapData}
              onSavePrescription={handleSavePrescription}
              clinicSettings={DEFAULT_CLINIC_SETTINGS}
              isSpecialtyLocked={isSpecialtyLocked}
              lockedSpecialty={lockedSpecialty}
              onProceedToBilling={() => setCurrentView('billing')}
            />
          )}

          {currentView === 'queue' && (
            <QueueBoard
              appointments={appointments}
              doctors={doctors}
              patients={patients}
              onUpdateStatus={handleUpdateAppointmentStatus}
              onUpdateVitals={handleUpdateVitals}
              onStartConsultation={handleStartConsultation}
              onOpenBill={handleOpenBillForAppointment}
              onAddNewToken={handleAddNewToken}
            />
          )}

          {currentView === 'kiosk' && (
            <WaitingRoomKiosk
              appointments={appointments}
              doctors={doctors}
              patients={patients}
              onCheckInPatient={(name, phone, specialty) => {
                const newUHID = `UHID-2026-${Math.floor(1000 + Math.random() * 9000)}`;
                const newPat: Patient = {
                  id: 'p-' + Date.now(),
                  name,
                  uhid: newUHID,
                  age: 32,
                  gender: 'Female',
                  phone,
                  bloodGroup: 'B+',
                  allergies: ['None known'],
                  chronicConditions: [],
                  emergencyContact: phone,
                  lastVisit: 'Today',
                };
                setPatients((prev) => [newPat, ...prev]);
                const doc = doctors.find(d => d.specialty.toLowerCase().includes(specialty.toLowerCase())) || doctors[0];
                const newApt: Appointment = {
                  id: 'apt-' + Date.now(),
                  tokenNumber: appointments.length + 1,
                  patientId: newPat.id,
                  patientName: newPat.name,
                  uhid: newPat.uhid,
                  patientPhone: newPat.phone,
                  doctorId: doc.id,
                  doctorName: doc.name,
                  specialty: doc.specialty as PolyclinicSpecialty,
                  date: new Date().toISOString().split('T')[0],
                  timeSlot: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                  status: 'Waiting',
                  type: 'New Consultation',
                  source: 'Walk-in',
                  consultationFee: doc.consultationFee,
                  isPaid: false,
                };
                setAppointments((prev) => [...prev, newApt]);
              }}
            />
          )}

          {currentView === 'reports' && (
            <LabReportAnalyzer
              currentPatient={currentPatient}
              onApplyClinicalFindings={() => {
                setCurrentView('rx');
              }}
            />
          )}

          {currentView === 'appointments' && (
            <AppointmentsCalendar
              appointments={appointments}
              doctors={doctors}
              patients={patients}
              onBookAppointment={handleBookAppointment}
            />
          )}

          {currentView === 'polyclinic' && (
            <PolyclinicManager
              doctors={doctors}
              selectedSpecialty={selectedSpecialty}
              onSelectSpecialty={setSelectedSpecialty}
              onSelectDoctor={(doc) => {
                setCurrentDoctor(doc);
                setCurrentView('queue');
              }}
              onDoctorUpdated={(updated) => {
                setDoctors((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
                if (currentDoctor.id === updated.id) setCurrentDoctor(updated);
              }}
            />
          )}

          {currentView === 'whatsapp' && (
            <WhatsAppAssistant
              currentPatient={currentPatient}
              doctors={doctors}
            />
          )}

          {currentView === 'voicebot' && (
            <VoiceBotAssistant
              currentPatient={currentPatient}
              doctors={doctors}
            />
          )}

          {currentView === 'billing' && (
            <BillingManager
              currentPatient={currentPatient}
              currentDoctor={currentDoctor}
              clinicSettings={DEFAULT_CLINIC_SETTINGS}
              activePrescription={prescriptions.find((p) => p.patientId === currentPatient.id) || null}
              onPaymentSuccess={(_invoiceNumber, _amount) => {
                setAppointments((prev) =>
                  prev.map((a) =>
                    a.patientId === currentPatient.id
                      ? { ...a, isPaid: true, status: 'Completed' }
                      : a
                  )
                );
              }}
            />
          )}

          {currentView === 'portal' && (
            <PatientPortal
              currentPatient={currentPatient}
              prescriptions={prescriptions}
              appointments={appointments}
              onBookNewSlot={() => setCurrentView('appointments')}
            />
          )}

          {currentView === 'team' && (
            <ClinicTeamManager
              canManage={user?.role === 'doctor' || user?.role === 'polyclinic_admin' || user?.role === 'CLINIC_ADMIN'}
              currentUserId={user?.id}
              onDoctorsChanged={(next) => {
                if (next.length) {
                  setDoctors(next);
                  setCurrentDoctor((prev) => next.find((x) => x.id === prev.id) || next[0]);
                }
              }}
            />
          )}
            </>
          )}
        </main>
      </div>

      <footer className="h-7 bg-slate-950 text-slate-400 border-t border-slate-800 flex items-center justify-between px-4 text-[11px] font-mono shrink-0 select-none z-30">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-slate-400">EMR Core:</span>
            <span className="text-slate-200 font-semibold">Synchronized</span>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-slate-400">
            <span>Doctor:</span>
            <span className="text-blue-400">{currentDoctor.name}</span>
          </div>
          <div className="hidden md:flex items-center gap-1 text-slate-400">
            <span>Patient:</span>
            <span className="text-slate-200">{currentPatient.name} ({currentPatient.uhid})</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-slate-400">
          <div className="hidden sm:block">ICD-10 / ABDM Standard</div>
          <div className="text-purple-400 font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
            Pulse AI (Gemini 3.8 Flash)
          </div>
        </div>
      </footer>

      <GeminiAssistant
        isOpen={isHexaOpen}
        onClose={() => setIsHexaOpen(false)}
        currentPatient={currentPatient}
        currentDoctor={currentDoctor}
      />
    </div>
  );
}

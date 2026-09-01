import React, { useState } from 'react';
import { Navbar, NavView } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
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
import { HexaAssistant } from './components/HexaAssistant';
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

export default function App() {
  const [currentView, setCurrentView] = useState<NavView>('ambient');
  const [currentDoctor, setCurrentDoctor] = useState<Doctor>(MOCK_DOCTORS[0]);
  const [currentPatient, setCurrentPatient] = useState<Patient>(MOCK_PATIENTS[0]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  // Application Data States
  const [patients, setPatients] = useState<Patient[]>(MOCK_PATIENTS);
  const [doctors, setDoctors] = useState<Doctor[]>(MOCK_DOCTORS);
  const [appointments, setAppointments] = useState<Appointment[]>(MOCK_APPOINTMENTS);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  
  // SOAP to Rx handoff state
  const [activeSoapData, setActiveSoapData] = useState<SoapNote | null>(null);

  // Polyclinic specialty filter
  const [selectedSpecialty, setSelectedSpecialty] = useState<PolyclinicSpecialty | 'All'>('All');

  // Hexa Copilot Drawer
  const [isHexaOpen, setIsHexaOpen] = useState(false);

  // Handlers
  const handleTransferToRx = (soap: SoapNote) => {
    setActiveSoapData(soap);
    setCurrentView('rx');
  };

  const handleSavePrescription = (newRx: Prescription) => {
    setPrescriptions((prev) => [newRx, ...prev]);
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
    setCurrentView('ambient');
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

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-100 text-slate-900 font-sans selection:bg-blue-600 selection:text-white">
      {/* Sleek Non-Collapsible Header (h-14) */}
      <Navbar
        currentView={currentView}
        onSelectView={setCurrentView}
        currentDoctor={currentDoctor}
        onSelectDoctor={setCurrentDoctor}
        allDoctors={doctors}
        onToggleHexa={() => setIsHexaOpen(!isHexaOpen)}
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isSidebarCollapsed={isSidebarCollapsed}
      />

      {/* 2-Column Split Workspace Layout (flex flex-1 overflow-hidden) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Fixed Collapsible Sidebar (w-64 flex-shrink-0) */}
        <Sidebar
          currentView={currentView}
          onSelectView={setCurrentView}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          currentPatient={currentPatient}
          onSelectPatient={setCurrentPatient}
          allPatients={patients}
          currentDoctor={currentDoctor}
        />

        {/* Expandable Main Content Panel (flex-1 min-w-0 h-full overflow-y-auto) */}
        <main className="flex-1 min-w-0 h-full overflow-y-auto bg-slate-100/70 p-4 sm:p-6 lg:p-8">
          {currentView === 'ambient' && (
            <AmbientAIStudio
              currentPatient={currentPatient}
              currentDoctor={currentDoctor}
              onTransferToRx={handleTransferToRx}
              onSelectPatient={setCurrentPatient}
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
              onApplyClinicalFindings={(findings) => {
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
        </main>
      </div>

      {/* Professional Status Footer */}
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
          <div className="text-blue-400 font-medium">Gemini 3.7 Flash Engine</div>
        </div>
      </footer>

      {/* Floating HEXA AI Decision Support Drawer */}
      <HexaAssistant
        isOpen={isHexaOpen}
        onClose={() => setIsHexaOpen(false)}
        currentPatient={currentPatient}
        currentDoctor={currentDoctor}
      />
    </div>
  );
}

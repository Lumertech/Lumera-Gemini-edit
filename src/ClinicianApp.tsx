import React, { useEffect, useMemo, useState } from 'react';
import { Navbar, NavView } from './components/Navbar';
import { Sidebar, ROLE_VISIBLE_VIEWS } from './components/Sidebar';
import { ShieldCheck, UserPlus } from 'lucide-react';
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
import { WelcomeSetupDashboard } from './components/WelcomeSetupDashboard';
import { ClinicProfileSettings } from './components/ClinicProfileSettings';
import {
  MOCK_DOCTORS,
  MOCK_PATIENTS,
  MOCK_APPOINTMENTS,
} from './data/clinicalData';
import {
  Patient,
  Doctor,
  Appointment,
  Prescription,
  SoapNote,
  Vitals,
  PolyclinicSpecialty,
  TenantLetterhead,
} from './types';
import { apiFetch } from './api/http';
import type { LinkAbhaRequest, LinkAbhaResponse } from './lib/patientOnboarding';
import { useAuth } from './auth/AuthContext';
import {
  UNASSIGNED_PATIENT,
  clinicSettingsFromSession,
  consumeWelcomeDashboard,
  doctorFromUser,
  isPolyclinicPractice,
  resolveSessionDoctor,
} from './lib/sessionWorkspace';

export default function ClinicianApp() {
  const { user } = useAuth();
  const isDemo = Boolean(user?.isDemoWorkspace);
  const sessionDoctor = doctorFromUser(user);

  const [currentView, setCurrentView] = useState<NavView>('queue');
  const [currentDoctor, setCurrentDoctor] = useState<Doctor>(() =>
    isDemo ? MOCK_DOCTORS[0] : sessionDoctor
  );
  const [currentPatient, setCurrentPatient] = useState<Patient>(() =>
    isDemo ? MOCK_PATIENTS[0] : UNASSIGNED_PATIENT
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [patients, setPatients] = useState<Patient[]>(() => (isDemo ? MOCK_PATIENTS : []));
  const [doctors, setDoctors] = useState<Doctor[]>(() => (isDemo ? MOCK_DOCTORS : [sessionDoctor]));
  const [appointments, setAppointments] = useState<Appointment[]>(() =>
    isDemo ? MOCK_APPOINTMENTS : []
  );
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [activeSoapData, setActiveSoapData] = useState<SoapNote | null>(null);
  const [selectedSpecialty, setSelectedSpecialty] = useState<PolyclinicSpecialty | 'All'>('All');
  const [isHexaOpen, setIsHexaOpen] = useState(false);
  const [letterhead, setLetterhead] = useState<TenantLetterhead | null>(null);
  const [intakeIntent, setIntakeIntent] = useState<'none' | 'register' | 'start-consult'>('none');

  const clinicSettings = useMemo(
    () => clinicSettingsFromSession(user, currentDoctor, letterhead),
    [user, currentDoctor, letterhead]
  );

  // Specialty locking enforcement for doctor accounts
  const isSpecialtyLocked = user?.role === 'doctor' || Boolean(user?.specialty) || user?.practiceType === 'individual';
  const lockedSpecialty = user?.specialty || (user?.role === 'doctor' ? currentDoctor.specialty : undefined);

  useEffect(() => {
    if (consumeWelcomeDashboard()) setCurrentView('welcome');
  }, []);

  useEffect(() => {
    if (!user) return;
    if (isDemo) {
      const match = MOCK_DOCTORS.find(
        (d) => user.specialty && d.specialty.toLowerCase().includes(user.specialty!.toLowerCase())
      );
      setCurrentDoctor(match || MOCK_DOCTORS[0]);
      return;
    }
    setCurrentDoctor((prev) => resolveSessionDoctor(user, [prev, ...doctors]));
  }, [user?.id, user?.email, user?.specialty, isDemo]);

  useEffect(() => {
    let cancelled = false;

    const loadWorkspace = async () => {
      try {
        const [doctorRes, patientRes, appointmentRes, prescriptionRes, letterheadRes] = await Promise.all([
          apiFetch<{ doctors: Doctor[] }>('/api/doctors'),
          apiFetch<{ patients: Patient[] }>('/api/patients'),
          apiFetch<{ appointments: Appointment[] }>('/api/appointments'),
          apiFetch<{ prescriptions: Prescription[] }>('/api/prescriptions'),
          apiFetch<{ letterhead: TenantLetterhead }>('/api/tenant/letterhead').catch(() => ({ letterhead: null })),
        ]);
        if (cancelled) return;

        if (letterheadRes.letterhead) {
          setLetterhead(letterheadRes.letterhead);
          if (letterheadRes.letterhead.signatureUrl) {
            const sig = letterheadRes.letterhead.signatureUrl;
            setCurrentDoctor((prev) => (prev.signatureUrl ? prev : { ...prev, signatureUrl: sig }));
          }
        }

        const nextDoctors = doctorRes.doctors || [];
        if (nextDoctors.length) {
          setDoctors(nextDoctors);
          setCurrentDoctor((prev) => {
            if (isDemo) {
              return (
                nextDoctors.find((d) => d.id === prev.id) ||
                nextDoctors.find(
                  (d) => user?.specialty && d.specialty.toLowerCase().includes(user.specialty!.toLowerCase())
                ) ||
                nextDoctors[0]
              );
            }
            return resolveSessionDoctor(user, nextDoctors);
          });
        } else if (!isDemo) {
          const fallback = doctorFromUser(user);
          setDoctors([fallback]);
          setCurrentDoctor(fallback);
        }

        const nextPatients = patientRes.patients || [];
        const nextAppointments = appointmentRes.appointments || [];
        const nextPrescriptions = prescriptionRes.prescriptions || [];

        if (!isDemo) {
          setPatients(nextPatients);
          setCurrentPatient((prev) => nextPatients.find((p) => p.id === prev.id) || UNASSIGNED_PATIENT);
          setAppointments(nextAppointments);
          setPrescriptions(nextPrescriptions);
        } else {
          if (nextPatients.length) setPatients(nextPatients);
          if (nextAppointments.length) setAppointments(nextAppointments);
          setPrescriptions(nextPrescriptions);
        }
      } catch {
        if (cancelled || isDemo) return;
        const fallback = doctorFromUser(user);
        setDoctors([fallback]);
        setCurrentDoctor(fallback);
        setPatients([]);
        setCurrentPatient(UNASSIGNED_PATIENT);
        setAppointments([]);
        setPrescriptions([]);
      }
    };

    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.tenantId, isDemo]);

  // SAFETY: the sidebar's patient switcher is intentionally always visible
  // (a receptionist may need to jump between patients quickly), but it must
  // never silently pull a doctor out from under an in-progress note or
  // prescription for a different patient — that's how clinical documentation
  // ends up attached to the wrong chart. Views where the doctor is actively
  // writing into currentPatient's record require confirmation before the
  // context switches.
  const CLINICAL_DOCUMENTATION_VIEWS: NavView[] = ['ambient', 'rx', 'smart-rx'];
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

  const persistAppointmentPatch = async (id: string, body: Partial<Appointment>) => {
    const patch: {
      status?: Appointment['status'];
      tokenNumber?: number;
      vitals?: Vitals;
      isPaid?: boolean;
    } = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.tokenNumber !== undefined) patch.tokenNumber = body.tokenNumber;
    if (body.vitals !== undefined) patch.vitals = body.vitals;
    if (body.isPaid !== undefined) patch.isPaid = body.isPaid;
    const { appointment } = await apiFetch<{ appointment: Appointment }>(`/api/appointments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setAppointments((prev) => prev.map((a) => (a.id === id ? appointment : a)));
    return appointment;
  };

  const billingAppointment =
    appointments.find((a) => a.patientId === currentPatient.id && !a.isPaid) ||
    appointments.find((a) => a.patientId === currentPatient.id);

  const persistAppointmentCreate = async (input: Partial<Appointment>) => {
    const { appointment } = await apiFetch<{ appointment: Appointment }>('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patientId: input.patientId,
        doctorId: input.doctorId,
        date: input.date || new Date().toISOString().slice(0, 10),
        timeSlot: input.timeSlot || '',
        ...(input.type ? { type: input.type } : {}),
        ...(input.source ? { source: input.source } : {}),
      }),
    });
    setAppointments((prev) => [appointment, ...prev.filter((a) => a.id !== appointment.id && a.id !== input.id)]);
    return appointment;
  };

  const persistPatientCreate = async (input: Patient) => {
    // Practice-simple: name/phone only. No ABHA, consent, or KYC on this path.
    const { patient } = await apiFetch<{ patient: Patient }>('/api/patients', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        age: input.age,
        gender: input.gender,
        phone: input.phone,
        ...(input.email ? { email: input.email } : {}),
        ...(input.bloodGroup ? { bloodGroup: input.bloodGroup } : {}),
        ...(input.allergies ? { allergies: input.allergies } : {}),
        ...(input.chronicConditions ? { chronicConditions: input.chronicConditions } : {}),
        ...(input.emergencyContact ? { emergencyContact: input.emergencyContact } : {}),
        ...(input.address ? { address: input.address } : {}),
      }),
    });
    setPatients((prev) => [patient, ...prev.filter((p) => p.id !== patient.id && p.id !== input.id)]);
    setCurrentPatient(patient);
    return patient;
  };

  const persistLinkAbha = async (body: LinkAbhaRequest): Promise<LinkAbhaResponse> => {
    const result = await apiFetch<LinkAbhaResponse>('/api/patients/link-abha', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setPatients((prev) => [result.patient, ...prev.filter((p) => p.id !== result.patient.id)]);
    setCurrentPatient(result.patient);
    return result;
  };

  const handleSavePrescription = (newRx: Prescription) => {
    setPrescriptions((prev) => [newRx, ...prev.filter((p) => p.id !== newRx.id)]);
    setAppointments((prev) =>
      prev.map((a) =>
        a.patientId === newRx.patientId && a.status === 'In Consultation'
          ? { ...a, status: 'Completed' }
          : a
      )
    );
    void (async () => {
      try {
        const { prescription } = await apiFetch<{ prescription: Prescription }>('/api/prescriptions', {
          method: 'POST',
          body: JSON.stringify(newRx),
        });
        setPrescriptions((prev) => [prescription, ...prev.filter((p) => p.id !== prescription.id && p.id !== newRx.id)]);
        const inConsult = appointments.find(
          (a) => a.patientId === newRx.patientId && (a.status === 'In Consultation' || a.status === 'Completed')
        );
        if (inConsult) {
          await persistAppointmentPatch(inConsult.id, { status: 'Completed' });
        }
      } catch (err) {
        console.error('Failed to persist prescription', err);
      }
    })();
  };

  const handleUpdateAppointmentStatus = (id: string, status: Appointment['status']) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: status } : a))
    );
    void persistAppointmentPatch(id, { status }).catch((err) => {
      console.error('Failed to persist appointment status', err);
    });
  };

  const handleUpdateVitals = (id: string, vitals: Vitals) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, vitals: vitals } : a))
    );
    void persistAppointmentPatch(id, { vitals }).catch((err) => {
      console.error('Failed to persist vitals', err);
    });
  };

  const handleStartConsultation = (apt: Appointment) => {
    const p = patients.find((pat) => pat.id === apt.patientId) || currentPatient;
    const d = resolveSessionDoctor(user, doctors);
    const selected = doctors.find((doc) => doc.id === apt.doctorId);
    setCurrentPatient(p);
    setCurrentDoctor(user?.role === 'doctor' ? d : selected || d);
    handleUpdateAppointmentStatus(apt.id, 'In Consultation');
    setCurrentView('rx');
  };

  const handleOpenBillForAppointment = (apt: Appointment) => {
    const p = patients.find((pat) => pat.id === apt.patientId) || currentPatient;
    setCurrentPatient(p);
    setCurrentView('billing');
  };

  const handleAddNewToken = (newToken: Partial<Appointment>) => {
    void persistAppointmentCreate(newToken).catch((err) => {
      console.error('Failed to persist token', err);
    });
  };

  const handleBookAppointment = (newApt: Partial<Appointment>) => {
    void persistAppointmentCreate(newApt).catch((err) => {
      console.error('Failed to persist appointment', err);
    });
  };

  const handleSelectDoctor = (doctor: Doctor) => {
    if (user?.role === 'doctor') {
      setCurrentDoctor(resolveSessionDoctor(user, doctors));
      return;
    }
    setCurrentDoctor(doctor);
  };

  const userRole = user?.role || 'doctor';
  let allowedViews = ROLE_VISIBLE_VIEWS[userRole] || ROLE_VISIBLE_VIEWS.doctor;
  if (!isPolyclinicPractice(user)) {
    allowedViews = allowedViews.filter((v) => v !== 'team' && v !== 'polyclinic');
  }
  const isViewAllowed =
    allowedViews.includes(currentView) ||
    currentView === 'opd-queue' ||
    currentView === 'smart-rx' ||
    currentView === 'welcome' ||
    currentView === 'settings';

  useEffect(() => {
    if (!isPolyclinicPractice(user) && currentView === 'polyclinic') {
      setCurrentView('queue');
    }
  }, [user?.practiceType, currentView]);

  const showRxStudio = (currentView === 'rx' || currentView === 'smart-rx') && Boolean(currentPatient.id);
  const showRxEmptyGuard = (currentView === 'rx' || currentView === 'smart-rx') && !currentPatient.id;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-100 text-slate-900 font-sans selection:bg-blue-600 selection:text-white">
      <Navbar
        currentView={currentView}
        onSelectView={setCurrentView}
        currentDoctor={currentDoctor}
        onSelectDoctor={handleSelectDoctor}
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
              {currentView === 'welcome' && (
                <WelcomeSetupDashboard
                  hasPatients={patients.length > 0}
                  hasSelectedPatient={Boolean(currentPatient.id)}
                  onAddPatients={() => {
                    setIntakeIntent('register');
                    setCurrentView('reception');
                  }}
                  onStartFirstConsultation={() => {
                    if (currentPatient.id) {
                      setCurrentView('rx');
                      return;
                    }
                    setIntakeIntent('start-consult');
                    setCurrentView('reception');
                  }}
                  onAddStaff={() => setCurrentView('team')}
                />
              )}

              {currentView === 'settings' && (
                <ClinicProfileSettings
                  currentDoctor={currentDoctor}
                  letterhead={letterhead}
                  onDoctorUpdated={(updated) => {
                    setCurrentDoctor(updated);
                    setDoctors((prev) => {
                      const exists = prev.some((d) => d.id === updated.id);
                      if (!exists) return [updated, ...prev];
                      return prev.map((d) => (d.id === updated.id ? updated : d));
                    });
                  }}
                  onLetterheadSaved={(saved) => {
                    setLetterhead(saved);
                    if (saved.signatureUrl) {
                      setCurrentDoctor((prev) => ({ ...prev, signatureUrl: saved.signatureUrl }));
                    }
                  }}
                />
              )}

              {currentView === 'reception' && (
            <Reception
              patients={patients}
              doctors={doctors}
              appointments={appointments}
              firstRunHint={intakeIntent !== 'none' || patients.length === 0}
              openRxAfterSave={intakeIntent === 'start-consult'}
              onSelectPatient={setCurrentPatient}
              onLinkAbha={async (body) => persistLinkAbha(body)}
              onHandoff={(pat, view) => {
                setCurrentPatient(pat);
                setIntakeIntent('none');
                setCurrentView(view);
              }}
              onAddNewPatient={async (newPat) => {
                try {
                  return await persistPatientCreate(newPat);
                } catch (err) {
                  console.error('Failed to persist patient', err);
                  throw err instanceof Error ? err : new Error('Could not save patient');
                }
              }}
              onCheckInPatient={async (pat, doc, type) => {
                try {
                  await persistAppointmentCreate({
                    patientId: pat.id,
                    doctorId: doc.id,
                    date: new Date().toISOString().split('T')[0],
                    timeSlot: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                    type: (type as Appointment['type']) || 'New Consultation',
                    source: 'Walk-in',
                  });
                } catch (err) {
                  console.error('Failed to persist check-in', err);
                  throw err instanceof Error ? err : new Error('Could not issue OPD token');
                }
              }}
              onSwitchToConsultation={() => setCurrentView('rx')}
              onStartConsult={(pat) => {
                setCurrentPatient(pat);
                setIntakeIntent('none');
                setCurrentView('rx');
              }}
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

          {showRxEmptyGuard && (
            <div className="flex flex-col items-center justify-center h-full p-8 bg-white rounded-xl shadow-sm border border-slate-200 text-center my-auto">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 mb-4 mx-auto">
                <UserPlus className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">No patient selected</h2>
              <p className="text-slate-600 max-w-md mb-6 text-sm mx-auto">
                Register a patient at OPD Reception before writing a prescription. New clinics start with an empty chart list — there is no demo patient loaded.
              </p>
              <button
                type="button"
                onClick={() => setCurrentView('reception')}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm mx-auto"
              >
                Add Patient at Reception
              </button>
            </div>
          )}

          {showRxStudio && (
            <PrescriptionWriter
              currentPatient={currentPatient}
              currentDoctor={currentDoctor}
              initialSoapData={activeSoapData}
              onSavePrescription={handleSavePrescription}
              clinicSettings={clinicSettings}
              isSpecialtyLocked={isSpecialtyLocked}
              lockedSpecialty={lockedSpecialty}
              onProceedToBilling={() => setCurrentView('billing')}
            />
          )}

          {(currentView === 'queue' || currentView === 'opd-queue') && (
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
              onCheckInPatient={async (name, phone, specialty) => {
                const draftPat: Patient = {
                  id: '',
                  name,
                  uhid: '',
                  age: 32,
                  gender: 'Female',
                  phone,
                  bloodGroup: 'B+',
                  allergies: ['None known'],
                  chronicConditions: [],
                  emergencyContact: phone,
                  lastVisit: 'Today',
                };
                try {
                  const newPat = await persistPatientCreate(draftPat);
                  const doc =
                    doctors.find((d) => d.specialty.toLowerCase().includes(specialty.toLowerCase())) ||
                    currentDoctor;
                  await persistAppointmentCreate({
                    patientId: newPat.id,
                    doctorId: doc.id,
                    date: new Date().toISOString().split('T')[0],
                    timeSlot: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                    type: 'New Consultation',
                    source: 'Walk-in',
                  });
                } catch (err) {
                  console.error('Failed to persist kiosk check-in', err);
                }
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

          {currentView === 'polyclinic' && isPolyclinicPractice(user) && (
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
              clinicSettings={clinicSettings}
              activePrescription={prescriptions.find((p) => p.patientId === currentPatient.id) || null}
              appointmentId={billingAppointment?.id}
              appointmentIsPaid={Boolean(billingAppointment?.isPaid)}
              onPaymentSuccess={(_invoiceNumber, _amount) => {
                void apiFetch<{ appointments: Appointment[] }>('/api/appointments')
                  .then((res) => {
                    if (Array.isArray(res.appointments)) setAppointments(res.appointments);
                  })
                  .catch((err) => {
                    console.error('Failed to refresh appointments after payment', err);
                  });
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

          {currentView === 'team' && isPolyclinicPractice(user) && (
            <ClinicTeamManager
              canManage={user?.role === 'doctor' || user?.role === 'polyclinic_admin' || user?.role === 'CLINIC_ADMIN'}
              currentUserId={user?.id}
              onDoctorsChanged={(next) => {
                if (next.length) {
                  setDoctors(next);
                  setCurrentDoctor((prev) => resolveSessionDoctor(user, next) || next.find((x) => x.id === prev.id) || next[0]);
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
            <span className="text-slate-200">
              {currentPatient.id ? `${currentPatient.name} (${currentPatient.uhid})` : 'No patient selected'}
            </span>
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

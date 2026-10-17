import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navbar, NavView } from './components/Navbar';
import { Sidebar, visibleViewsForRole } from './components/Sidebar';
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
import { PracticeHome } from './components/PracticeHome';
import { ClinicProfileSettings } from './components/ClinicProfileSettings';
import { PharmacyDiagnosticsHub } from './components/PharmacyDiagnosticsHub';
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
import { appointmentIdForBillContext, appointmentsForClinicDay, clinicCalendarDate } from './lib/clinicDay';
import { useAuth } from './auth/AuthContext';
import { useNav } from './nav/NavigationContext';
import { canonicalizeAppView, appViewToPath } from './nav/surfaces';
import { isAppWorkspaceRootPath, workspaceSlugFromUser } from './lib/workspacePath';
import {
  UNASSIGNED_PATIENT,
  clinicSettingsFromSession,
  consumeWelcomeDashboard,
  doctorFromUser,
  isPolyclinicPractice,
  resolveSessionDoctor,
} from './lib/sessionWorkspace';
import { postOnboardingHomeView } from './lib/practiceOnboarding';
import {
  allowedViewsForWorkflow,
  clinicianHomeView,
  clinicianRxSpecialty,
  workflowForUser,
} from './lib/specialtyWorkflow';
import { canStartConsultRole, istClock } from './lib/clinicNav';
import { SpecialtyPackBoard } from './components/specialty-packs/SpecialtyPackBoard';
import { PatientsWorkspace } from './components/PatientsWorkspace';
import {
  alignSessionToPatient,
  canAutosaveDraft,
  completeDraftFetch,
  draftForStorage,
  failDraftFetch,
  mapSoapToRxDraft,
  openPatientDraft,
  readDemoDraft,
  sessionDemoDraftTenant,
  writeDemoDraft,
  writerKey,
  type PatientDraftSession,
} from './lib/rxDraft';

export default function ClinicianApp() {
  const { user } = useAuth();
  const { go, appView, pathname, recordId } = useNav();
  const isDemo = Boolean(user?.isDemoWorkspace);
  const sessionDoctor = doctorFromUser(user);
  const pack = workflowForUser(user);
  const currentView = appView;
  const sessionWorkspace = user ? workspaceSlugFromUser(user) : 'practice';
  const setCurrentView = (view: NavView) => {
    const targetPath = appViewToPath(view, sessionWorkspace);
    go('app', { appView: canonicalizeAppView(view), workspaceSlug: sessionWorkspace });
  };
  const [currentDoctor, setCurrentDoctor] = useState<Doctor>(() => sessionDoctor);
  const [currentPatient, setCurrentPatient] = useState<Patient>(() => UNASSIGNED_PATIENT);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [intakeName, setIntakeName] = useState('');

  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>(() => (sessionDoctor.id ? [sessionDoctor] : []));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [queueDate, setQueueDate] = useState(() => clinicCalendarDate());
  const [queueAppointments, setQueueAppointments] = useState<Appointment[]>([]);
  const [pinnedBillAppointmentId, setPinnedBillAppointmentId] = useState('');
  const [workspaceError, setWorkspaceError] = useState("");
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [draftState, setDraftState] = useState<PatientDraftSession>({
    patientId: '',
    phase: 'loading',
    draft: null,
    version: 0,
  });
  const saveImmediateRef = useRef(false);
  const [selectedSpecialty, setSelectedSpecialty] = useState<PolyclinicSpecialty | 'All'>('All');
  const [isHexaOpen, setIsHexaOpen] = useState(false);
  const [letterhead, setLetterhead] = useState<TenantLetterhead | null>(null);
  const [intakeIntent, setIntakeIntent] = useState<'none' | 'register' | 'start-consult'>('none');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [currentDraftRx, setCurrentDraftRx] = useState<Prescription | null>(null);

  const draftSession = alignSessionToPatient(draftState, currentPatient.id || '');
  const sessionTenantId = sessionDemoDraftTenant(user?.tenantId);
  const draftAppointmentId = useMemo(() => {
    const byId = new Map<string, Appointment>();
    for (const row of [...appointments, ...queueAppointments]) byId.set(row.id, row);
    const pool = [...byId.values()];
    const inConsult = pool.find(
      (row) => row.patientId === currentPatient.id && row.status === 'In Consultation'
    );
    if (inConsult?.id) return inConsult.id;
    return appointmentIdForBillContext(pool, {
      patientId: currentPatient.id,
      day: clinicCalendarDate(),
    });
  }, [appointments, queueAppointments, currentPatient.id]);

  useEffect(() => {
    const patientId = currentPatient.id;
    if (!patientId) {
      setDraftState({ patientId: '', phase: 'ready', draft: null, version: 0 });
      return;
    }
    let cancelled = false;
    setDraftState((prev) => openPatientDraft(patientId, prev.version));
    setCurrentDraftRx(null);
    void (async () => {
      try {
        let raw: unknown = null;
        if (isDemo) {
          raw = sessionTenantId
            ? readDemoDraft(sessionStorage, sessionTenantId, patientId, draftAppointmentId)
            : null;
        } else {
          const query = draftAppointmentId
            ? `?appointmentId=${encodeURIComponent(draftAppointmentId)}`
            : '';
          const res = await apiFetch<{ draft: unknown }>(`/api/prescriptions/draft/${patientId}${query}`);
          raw = res.draft ?? null;
        }
        if (cancelled) return;
        setDraftState((prev) => completeDraftFetch(alignSessionToPatient(prev, patientId), patientId, raw));
      } catch (err) {
        console.error('Failed to load patient draft', err);
        if (cancelled) return;
        setDraftState((prev) => failDraftFetch(alignSessionToPatient(prev, patientId), patientId));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentPatient.id, draftAppointmentId, isDemo, sessionTenantId]);

  useEffect(() => {
    if (!canAutosaveDraft(draftSession)) return;
    if (!currentDraftRx || !currentPatient.id) return;
    if (currentDraftRx.patientId !== currentPatient.id) return;
    const immediate = saveImmediateRef.current;
    saveImmediateRef.current = false;
    const patientId = currentPatient.id;
    const doctorId = currentDoctor.id;
    const body = draftForStorage({
      patientId,
      doctorId,
      ...currentDraftRx,
      appointmentId: draftAppointmentId,
    });

    const persist = async () => {
      try {
        setAutoSaveStatus('saving');
        if (isDemo) {
          if (!sessionTenantId) {
            setAutoSaveStatus('unsaved');
            return;
          }
          writeDemoDraft(sessionStorage, sessionTenantId, patientId, body, draftAppointmentId);
          setAutoSaveStatus('saved');
          return;
        }
        await apiFetch('/api/prescriptions/draft', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setAutoSaveStatus('saved');
      } catch (err) {
        console.error('Failed to auto-save draft', err);
        setAutoSaveStatus('unsaved');
      }
    };

    if (immediate) {
      void persist();
      return;
    }
    setAutoSaveStatus('unsaved');
    const timer = setTimeout(() => {
      void persist();
    }, 1200);
    return () => clearTimeout(timer);
  }, [currentDraftRx, currentPatient.id, draftAppointmentId, draftSession.phase, isDemo, sessionTenantId, currentDoctor.id]);

  const clinicSettings = useMemo(
    () => clinicSettingsFromSession(user, currentDoctor, letterhead),
    [user, currentDoctor, letterhead]
  );

  // Specialty locking — resolve pack-id `gp` / demo emails to the actual Rx module (Cardiology, Physio, …).
  const isSpecialtyLocked = user?.role === 'doctor' || Boolean(user?.specialty) || user?.practiceType === 'individual';
  const lockedSpecialty = clinicianRxSpecialty(user, currentDoctor.specialty);

  useEffect(() => {
    if (!user) return;
    const ws = workspaceSlugFromUser(user);
    if (consumeWelcomeDashboard()) {
      go('app', {
        appView: postOnboardingHomeView(user.practiceType === 'polyclinic' ? 'polyclinic' : 'individual'),
        workspaceSlug: ws,
        replace: true,
      });
      return;
    }
    if (isAppWorkspaceRootPath(pathname)) {
      go('app', { appView: canonicalizeAppView(clinicianHomeView(user)), workspaceSlug: ws, replace: true });
    }
  }, [user, pathname, go]);

  useEffect(() => {
    if (!user) return;
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
        setWorkspaceError("");

        if (letterheadRes.letterhead) {
          setLetterhead(letterheadRes.letterhead);
          if (letterheadRes.letterhead.signatureUrl) {
            const sig = letterheadRes.letterhead.signatureUrl;
            setCurrentDoctor((prev) => (prev.signatureUrl ? prev : { ...prev, signatureUrl: sig }));
          }
        } else {
          setLetterhead(null);
        }

        const nextDoctors = doctorRes.doctors || [];
        if (nextDoctors.length) {
          setDoctors(nextDoctors);
          setCurrentDoctor(() => resolveSessionDoctor(user, nextDoctors));
        } else {
          const fallback = doctorFromUser(user);
          setDoctors(fallback.id ? [fallback] : []);
          setCurrentDoctor(fallback);
        }

        const nextPatients = patientRes.patients || [];
        const nextAppointments = appointmentRes.appointments || [];
        const nextPrescriptions = prescriptionRes.prescriptions || [];

        setPatients(nextPatients);
        setCurrentPatient((prev) => nextPatients.find((p) => p.id === prev.id) || UNASSIGNED_PATIENT);
        setAppointments(nextAppointments);
        setPrescriptions(nextPrescriptions);
      } catch (err) {
        if (cancelled) return;
        const fallback = doctorFromUser(user);
        setDoctors(fallback.id ? [fallback] : []);
        setCurrentDoctor(fallback);
        setPatients([]);
        setCurrentPatient(UNASSIGNED_PATIENT);
        setAppointments([]);
        setPrescriptions([]);
        setLetterhead(null);
        const detail = err instanceof Error ? err.message.trim() : "";
        setWorkspaceError(
          detail
            ? `Could not load clinic data. ${detail}`
            : "Could not load clinic data from the server."
        );
      }
    };

    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.tenantId, isDemo]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiFetch<{ appointments: Appointment[] }>(`/api/appointments?date=${encodeURIComponent(queueDate)}`)
      .then((res) => {
        if (!cancelled) setQueueAppointments(Array.isArray(res.appointments) ? res.appointments : []);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load the clinic-day queue', err);
          setQueueAppointments([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.tenantId, queueDate, isDemo]);

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
    setPinnedBillAppointmentId('');
    setCurrentPatient(patient);
  };

  const handleAutoSaveDraft = (rx: Prescription, options?: { immediate?: boolean }) => {
    if (rx.patientId !== currentPatient.id) return;
    if (options?.immediate) saveImmediateRef.current = true;
    setCurrentDraftRx(rx);
  };

  const handleTransferToRx = (soap: SoapNote) => {
    const mapped = mapSoapToRxDraft(soap, {
      source: 'ambient-studio',
      generatedAt: new Date().toISOString(),
      transcriptSummary: soap.transcriptSummary,
      ambientRecordingDurationSec: soap.ambientRecordingDurationSec,
    });
    setDraftState((prev) => ({
      patientId: currentPatient.id,
      phase: 'ready',
      draft: mapped,
      version: prev.version + 1,
    }));
    setCurrentView('rx');
    saveImmediateRef.current = true;
    setCurrentDraftRx({
      id: 'rx-draft-' + currentPatient.id,
      rxNumber: '',
      patientId: currentPatient.id,
      patientName: currentPatient.name,
      patientAge: currentPatient.age,
      patientGender: currentPatient.gender,
      patientPhone: currentPatient.phone,
      patientUhid: currentPatient.uhid,
      doctorId: currentDoctor.id,
      doctorName: currentDoctor.name,
      doctorSpecialty: mapped.specialtyType || currentDoctor.specialty,
      doctorRegNumber: currentDoctor.regNumber,
      date: soap.date,
      chiefComplaints: mapped.chiefComplaints,
      diagnosis: mapped.diagnosis,
      icd10Code: mapped.icd10Code,
      medicines: mapped.medicines,
      labTests: mapped.labTests,
      advice: mapped.advice,
      followUpDate: mapped.followUpDate,
      followUpDays: mapped.followUpDays,
      clinicName: clinicSettings.name,
      clinicAddress: clinicSettings.address,
      clinicPhone: clinicSettings.phone,
      vitals: mapped.vitals,
      historyOfPresentIllness: mapped.historyOfPresentIllness,
      pastMedicalHistory: mapped.pastMedicalHistory,
      reviewOfSystems: mapped.reviewOfSystems,
      physicalExamination: mapped.physicalExamination,
      clinicalFindings: mapped.clinicalFindings,
      differentialDiagnoses: mapped.differentialDiagnoses,
      riskLevel: mapped.riskLevel,
      redFlags: mapped.redFlags,
      performedTherapies: mapped.performedTherapies,
      prescribedExercises: mapped.prescribedExercises,
      physiotherapyAssessment: mapped.physiotherapyAssessment,
      cardiologyAssessment: mapped.cardiologyAssessment,
      dermatologyAssessment: mapped.dermatologyAssessment,
      pediatricAssessment: mapped.pediatricAssessment,
      orthopedicAssessment: mapped.orthopedicAssessment,
      ophthalmologyAssessment: mapped.ophthalmologyAssessment,
      dentalAssessment: mapped.dentalAssessment,
      gynecologyAssessment: mapped.gynecologyAssessment,
      specialtyType: mapped.specialtyType,
      aiSource: mapped.aiSource,
      aiGeneratedAt: mapped.aiGeneratedAt,
      transcriptHash: mapped.transcriptHash,
      transcriptSummary: mapped.transcriptSummary,
      ambientRecordingDurationSec: mapped.ambientRecordingDurationSec,
      pendingAiFields: mapped.pendingAiFields,
      aiAcknowledged: false,
      whatsappSentStatus: 'unsent',
    });
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
    setQueueAppointments((prev) => {
      const rest = prev.filter((a) => a.id !== appointment.id);
      return appointment.date === queueDate ? [...rest, appointment].sort((a, b) => a.tokenNumber - b.tokenNumber) : rest;
    });
    return appointment;
  };

  const billPool = useMemo(() => {
    const byId = new Map<string, Appointment>();
    for (const row of [...appointments, ...queueAppointments]) byId.set(row.id, row);
    return [...byId.values()];
  }, [appointments, queueAppointments]);
  const billingAppointmentId = appointmentIdForBillContext(billPool, {
    selectedAppointmentId: pinnedBillAppointmentId,
    patientId: currentPatient.id,
    day: clinicCalendarDate(),
  });
  const billingAppointment = billPool.find((a) => a.id === billingAppointmentId);

  useEffect(() => {
    if (!pinnedBillAppointmentId) return;
    const pinned = billPool.find((row) => row.id === pinnedBillAppointmentId);
    if (pinned && pinned.patientId !== currentPatient.id) setPinnedBillAppointmentId('');
  }, [billPool, currentPatient.id, pinnedBillAppointmentId]);

  const persistAppointmentCreate = async (input: Partial<Appointment>) => {
    const { appointment } = await apiFetch<{ appointment: Appointment }>('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patientId: input.patientId,
        doctorId: input.doctorId,
        date: input.date || clinicCalendarDate(),
        timeSlot: input.timeSlot || '',
        ...(input.type ? { type: input.type } : {}),
        ...(input.source ? { source: input.source } : {}),
      }),
    });
    setAppointments((prev) => [appointment, ...prev.filter((a) => a.id !== appointment.id && a.id !== input.id)]);
    if (appointment.date === queueDate) {
      setQueueAppointments((prev) => [appointment, ...prev.filter((a) => a.id !== appointment.id)].sort((a, b) => a.tokenNumber - b.tokenNumber));
    }
    return appointment;
  };

  const persistPatientCreate = async (input: Patient) => {
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
    let next = patient;
    if (input.abhaNumber || input.abhaAddress) {
      const abha = await apiFetch<{
        success: boolean;
        id: string;
        abhaNumber: string;
        abhaAddress: string;
        kycStatus: Patient['kycStatus'];
      }>(`/api/patients/${patient.id}/abha`, {
        method: 'PATCH',
        body: JSON.stringify({
          abhaNumber: input.abhaNumber,
          abhaAddress: input.abhaAddress,
          ...(input.kycStatus ? { kycStatus: input.kycStatus } : {}),
        }),
      });
      next = {
        ...patient,
        abhaNumber: abha.abhaNumber,
        abhaAddress: abha.abhaAddress,
        kycStatus: abha.kycStatus,
      };
    }
    setPatients((prev) => [next, ...prev.filter((p) => p.id !== next.id && p.id !== input.id)]);
    return next;
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
    setQueueAppointments((prev) =>
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
          body: JSON.stringify({ ...newRx, appointmentId: draftAppointmentId }),
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
    setQueueAppointments((prev) =>
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
    setQueueAppointments((prev) =>
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
    setPinnedBillAppointmentId(apt.id);
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
  let allowedViews = visibleViewsForRole(userRole);
  if (!isPolyclinicPractice(user)) {
    allowedViews = allowedViews.filter((v) => v !== 'team' && v !== 'polyclinic');
  }
  allowedViews = allowedViewsForWorkflow(allowedViews, pack);
  const clinicalViewAllowed =
    allowedViews.includes(currentView) ||
    currentView === 'opd-queue' ||
    currentView === 'smart-rx' ||
    currentView === 'welcome' ||
    currentView === 'settings' ||
    currentView === 'wellness' ||
    currentView === 'therapy-session' ||
    currentView === 'consult-practice' ||
    currentView === 'physio-session' ||
    currentView === 'dental-chart' ||
    currentView === 'gp-home';
  const isViewAllowed =
    userRole === 'super_admin'
      ? currentView === 'settings'
      : userRole === 'admin'
        ? false
        : clinicalViewAllowed;

  useEffect(() => {
    if (!isPolyclinicPractice(user) && (currentView === 'polyclinic' || currentView === 'team')) {
      setCurrentView('queue');
    }
  }, [user?.practiceType, currentView]);

  const showRxStudio = (currentView === 'rx' || currentView === 'smart-rx') && Boolean(currentPatient.id);
  const showRxEmptyGuard = (currentView === 'rx' || currentView === 'smart-rx') && !currentPatient.id;

  if (!user) {
    return null;
  }

  return (
    <div
      data-testid="clinician-app"
      className="h-dvh max-h-dvh w-full max-w-full overflow-hidden flex flex-col bg-slate-100 text-slate-900 font-sans selection:bg-blue-600 selection:text-white"
    >
      <Navbar
        currentView={currentView}
        onSelectView={setCurrentView}
        currentDoctor={currentDoctor}
        onSelectDoctor={handleSelectDoctor}
        allDoctors={isPolyclinicPractice(user) ? doctors : [currentDoctor]}
        onToggleHexa={() => setIsHexaOpen(!isHexaOpen)}
        onToggleSidebar={() => {
          if (window.matchMedia('(max-width: 767px)').matches) {
            setMobileNavOpen((open) => !open);
            return;
          }
          setIsSidebarCollapsed((collapsed) => !collapsed);
        }}
        isSidebarCollapsed={isSidebarCollapsed}
        userName={user?.name}
        userRole={user?.role}
        canOpenAdmin={user?.role === 'super_admin'}
        isSpecialtyLocked={isSpecialtyLocked}
      />

      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {mobileNavOpen && (
          <button
            type="button"
            className="md:hidden fixed inset-0 z-30 bg-slate-950/50"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <div
          className={
            mobileNavOpen
              ? 'fixed inset-y-0 left-0 z-40 flex h-full md:static md:inset-auto md:z-auto'
              : 'hidden md:flex h-full'
          }
        >
          <Sidebar
            currentView={currentView}
            onSelectView={setCurrentView}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => {
              if (window.matchMedia('(max-width: 767px)').matches) {
                setMobileNavOpen(false);
                return;
              }
              setIsSidebarCollapsed((collapsed) => !collapsed);
            }}
            currentPatient={currentPatient}
            onSelectPatient={handleSelectPatient}
            allPatients={patients}
            currentDoctor={currentDoctor}
            onPatientCreated={(p) => setPatients((prev) => [p, ...prev])}
            onNavigate={() => setMobileNavOpen(false)}
          />
        </div>

        <main className="flex-1 min-w-0 w-full h-full overflow-y-auto overflow-x-hidden bg-slate-100/70 p-4 sm:p-6 lg:p-8 flex flex-col">
          {workspaceError && (
            <div
              role="alert"
              className="mb-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-900"
              data-testid="workspace-load-error"
            >
              {workspaceError}
            </div>
          )}
          {isDemo && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900" data-testid="demo-sandbox-banner">
              Sandbox workspace. Sample data only.
            </div>
          )}
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
              {(currentView === 'welcome' || currentView === 'gp-home' || currentView === 'wellness' || currentView === 'therapy-session' || currentView === 'consult-practice' || currentView === 'physio-session' || currentView === 'dental-chart') && (
                <div className="space-y-4">
                  <PracticeHome
                    user={user}
                    pack={pack}
                    patients={patients}
                    appointments={appointments}
                    doctor={currentDoctor}
                    canConsult={canStartConsultRole(user.role, allowedViews)}
                    hasLogo={Boolean(letterhead?.signatureUrl)}
                    hasHoursAndFees={Number(currentDoctor.consultationFee) > 0}
                    onOpen={setCurrentView}
                    onCheckInWalkIn={() => {
                      const patient = patients[0];
                      if (!patient) {
                        setIntakeIntent('register');
                        setCurrentView('reception');
                        return;
                      }
                      void persistAppointmentCreate({
                        patientId: patient.id,
                        doctorId: currentDoctor.id,
                        date: clinicCalendarDate(),
                        timeSlot: istClock(),
                        type: 'New Consultation',
                        source: 'Walk-in',
                        status: 'Waiting',
                      }).then(() => setCurrentView('queue'));
                    }}
                    onCheckIn={(apt) => {
                      handleUpdateAppointmentStatus(apt.id, 'Waiting');
                      setQueueDate(apt.date || clinicCalendarDate());
                      setCurrentView('queue');
                    }}
                    onReady={(apt) => {
                      handleUpdateAppointmentStatus(apt.id, 'Triage / Vitals');
                      setQueueDate(apt.date || clinicCalendarDate());
                      setCurrentView('queue');
                    }}
                    onStartConsult={canStartConsultRole(user.role, allowedViews) ? handleStartConsultation : undefined}
                    onCreateBill={handleOpenBillForAppointment}
                  />
                  {currentView !== 'welcome' && currentView !== 'gp-home' && (
                    <details className="bg-white rounded-2xl border border-slate-200">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">Session tools</summary>
                      <div className="px-2 pb-4">
                        <SpecialtyPackBoard
                          pack={pack}
                          patients={patients}
                          appointments={appointments}
                          currentDoctor={currentDoctor}
                          onSelectView={setCurrentView}
                          onSelectPatient={handleSelectPatient}
                        />
                      </div>
                    </details>
                  )}
                </div>
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

              {currentView === 'patients' && (
                <PatientsWorkspace
                  recordId={recordId}
                  canPrescribe={allowedViews.includes('rx') || allowedViews.includes('smart-rx')}
                  onOpenPatient={(id) =>
                    go('app', { appView: 'patients', recordId: id, workspaceSlug: sessionWorkspace })
                  }
                  onBack={() => go('app', { appView: 'patients', workspaceSlug: sessionWorkspace })}
                  onRegister={(name) => {
                    setIntakeName(name || '');
                    setIntakeIntent('register');
                    setCurrentView('reception');
                  }}
                  onSelectPatient={handleSelectPatient}
                  onOpenPrescription={(patient) => {
                    if (!(allowedViews.includes('rx') || allowedViews.includes('smart-rx'))) return;
                    handleSelectPatient(patient);
                    setCurrentView('rx');
                  }}
                  onCheckIn={(patient) => {
                    handleSelectPatient(patient);
                    setIntakeIntent('register');
                    setCurrentView('reception');
                  }}
                  onOpenLinked={(patient, view) => {
                    handleSelectPatient(patient);
                    if (view === 'rx' && !(allowedViews.includes('rx') || allowedViews.includes('smart-rx'))) return;
                    setCurrentView(view);
                  }}
                />
              )}

              {currentView === 'reception' && (
            <Reception
              patients={patients}
              doctors={doctors}
              appointments={appointments}
              workflow={pack}
              firstRunHint={intakeIntent !== 'none' || patients.length === 0}
              canStartConsult={allowedViews.includes('rx') || allowedViews.includes('smart-rx')}
              openRxAfterSave={intakeIntent === 'start-consult' && (allowedViews.includes('rx') || allowedViews.includes('smart-rx'))}
              intakeName={intakeName}
              onSelectPatient={setCurrentPatient}
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
                    date: clinicCalendarDate(),
                    timeSlot: istClock(),
                    type: (type as Appointment['type']) || 'New Consultation',
                    source: 'Walk-in',
                  });
                } catch (err) {
                  console.error('Failed to persist check-in', err);
                  throw err instanceof Error ? err : new Error('Could not issue OPD token');
                }
              }}
              onSwitchToConsultation={() => {
                if (allowedViews.includes('rx') || allowedViews.includes('smart-rx')) setCurrentView('rx');
              }}
              onStartConsult={
                allowedViews.includes('rx') || allowedViews.includes('smart-rx')
                  ? (pat) => {
                      setCurrentPatient(pat);
                      setIntakeIntent('none');
                      setCurrentView('rx');
                    }
                  : undefined
              }
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
            <div className="flex-1 flex flex-col overflow-y-auto relative">
              <div className="bg-white border-b border-slate-200 px-4 py-1.5 flex items-center justify-between text-xs text-slate-500 shadow-xs z-10 shrink-0">
                <span className="font-medium flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${autoSaveStatus === 'saved' ? 'bg-emerald-500' : autoSaveStatus === 'saving' ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'}`}></span>
                  {autoSaveStatus === 'saved' && (isDemo ? 'Draft saved in this browser session' : 'Draft securely auto-saved to database')}
                  {autoSaveStatus === 'saving' && 'Saving draft...'}
                  {autoSaveStatus === 'unsaved' && 'Unsaved changes (auto-saving soon...)'}
                </span>
                <span className="text-slate-400">SOAP Notes & Prescription Auto-Sync Active</span>
              </div>
              <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col">
                {draftSession.phase === 'loading' && (
                  <p className="p-4 text-sm text-slate-500">Loading saved prescription draft…</p>
                )}
                {draftSession.phase === 'error' && (
                  <p className="p-4 text-sm text-rose-700">Couldn't load the saved draft. Autosave is paused so an empty form cannot overwrite it.</p>
                )}
                {draftSession.phase === 'ready' && writerKey(draftSession) && (
                  <PrescriptionWriter
                    key={writerKey(draftSession) || currentPatient.id}
                    currentPatient={currentPatient}
                    currentDoctor={currentDoctor}
                    initialDraft={draftSession.draft}
                    initialSoapData={null}
                    onSavePrescription={handleSavePrescription}
                    clinicSettings={clinicSettings}
                    isSpecialtyLocked={isSpecialtyLocked}
                    lockedSpecialty={lockedSpecialty}
                    onProceedToBilling={() => {
                      const id = appointmentIdForBillContext(billPool, {
                        patientId: currentPatient.id,
                        day: clinicCalendarDate(),
                      });
                      setPinnedBillAppointmentId(id);
                      setCurrentView('billing');
                    }}
                    appointments={appointments}
                    onBookFollowUp={async (input) => persistAppointmentCreate(input)}
                    onAutoSave={handleAutoSaveDraft}
                  />
                )}
              </div>
            </div>
          )}

          {(currentView === 'queue' || currentView === 'opd-queue') && (
            <QueueBoard
              appointments={queueAppointments}
              queueDate={queueDate}
              onQueueDateChange={setQueueDate}
              doctors={doctors}
              patients={patients}
              onUpdateStatus={handleUpdateAppointmentStatus}
              onUpdateVitals={handleUpdateVitals}
              onStartConsultation={handleStartConsultation}
              onOpenBill={handleOpenBillForAppointment}
              onAddNewToken={handleAddNewToken}
              canConsult={canStartConsultRole(user.role, allowedViews)}
            />
          )}

          {currentView === 'kiosk' && (
            <WaitingRoomKiosk
              appointments={appointmentsForClinicDay(appointments, clinicCalendarDate())}
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
                    date: clinicCalendarDate(),
                    timeSlot: istClock(),
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
              onCheckIn={(apt) => {
                handleUpdateAppointmentStatus(apt.id, 'Waiting');
                setQueueDate(apt.date || clinicCalendarDate());
                setCurrentView('queue');
              }}
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

          {currentView === 'pharmacy-hub' && (
            <PharmacyDiagnosticsHub
              currentPatient={currentPatient}
              currentPrescription={prescriptions.find((p) => p.patientId === currentPatient.id) || null}
            />
          )}

          {currentView === 'billing' && (
            <BillingManager
              currentPatient={currentPatient}
              currentDoctor={currentDoctor}
              clinicSettings={clinicSettings}
              activePrescription={prescriptions.find((p) => p.patientId === currentPatient.id) || null}
              appointmentId={billingAppointmentId || undefined}
              appointment={billingAppointment}
              appointmentIsPaid={Boolean(billingAppointment?.isPaid)}
              onPaymentSuccess={(_invoiceNumber, _amount) => {
                void Promise.all([
                  apiFetch<{ appointments: Appointment[] }>('/api/appointments'),
                  apiFetch<{ appointments: Appointment[] }>(`/api/appointments?date=${encodeURIComponent(queueDate)}`),
                ])
                  .then(([history, day]) => {
                    if (Array.isArray(history.appointments)) setAppointments(history.appointments);
                    if (Array.isArray(day.appointments)) setQueueAppointments(day.appointments);
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
              unlinked={user?.role === 'patient' && !user.chartLinked}
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

      <GeminiAssistant
        isOpen={isHexaOpen}
        onClose={() => setIsHexaOpen(false)}
        currentPatient={currentPatient}
        currentDoctor={currentDoctor}
      />
    </div>
  );
}

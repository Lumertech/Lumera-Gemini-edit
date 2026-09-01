import React, { useState } from "react";
import { Link } from "react-router-dom";
import { PatientPortal } from "./components/PatientPortal";
import { MOCK_APPOINTMENTS, MOCK_PATIENTS } from "./data/clinicalData";
import { useAuth } from "./auth/AuthContext";

export default function PatientPortalApp() {
  const { user, logout } = useAuth();
  const patient = MOCK_PATIENTS.find((p) => p.email === user?.email) || MOCK_PATIENTS[0];
  const [appointments] = useState(MOCK_APPOINTMENTS);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="h-12 bg-slate-900 text-white flex items-center justify-between px-4 text-xs">
        <span className="font-bold">Lumera Patient Portal</span>
        <div className="flex items-center gap-3">
          <span className="text-slate-400">{user?.name}</span>
          <Link to="/" className="hover:text-blue-300">Site</Link>
          <button onClick={() => logout().then(() => { window.location.href = "/"; })}>Sign out</button>
        </div>
      </header>
      <PatientPortal
        currentPatient={patient}
        prescriptions={[]}
        appointments={appointments}
        onBookNewSlot={() => undefined}
      />
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { Camera, Edit3, CheckCircle2, ShieldCheck, Award } from "lucide-react";
import { apiFetch } from "../../api/http";
import { Doctor, PolyclinicSpecialty } from "../../types";
import { DoctorProfileModal } from "../DoctorProfileModal";

interface StaffRow {
  id: string;
  name: string;
  role: string;
  department: string;
  phone: string;
  email: string;
  status: string;
  shift: string;
}

const SPECIALTIES: PolyclinicSpecialty[] = [
  "General Medicine",
  "Cardiology",
  "Pediatrics",
  "Dermatology",
  "Orthopedics",
  "Physiotherapy & Rehabilitation",
  "Gynecology",
  "ENT",
  "Neurology",
  "Ophthalmology",
  "Dental Surgery",
  "Psychiatry & Mental Health",
];

export const AdminPeople: React.FC = () => {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [docForm, setDocForm] = useState({
    name: "",
    specialty: "General Medicine" as PolyclinicSpecialty,
    qualification: "",
    regNumber: "",
    consultationFee: 600,
    opdRoom: "",
    email: "",
  });
  const [staffForm, setStaffForm] = useState({
    name: "",
    role: "Staff Nurse",
    department: "OPD",
    phone: "",
    email: "",
    shift: "Morning",
  });

  const load = () => {
    apiFetch<{ doctors: Doctor[] }>("/api/doctors")
      .then((d) => setDoctors(d.doctors))
      .catch(() => {});
    apiFetch<{ staff: StaffRow[] }>("/api/staff")
      .then((s) => setStaff(s.staff))
      .catch(() => {});
  };

  useEffect(load, []);

  const addDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch("/api/doctors", {
      method: "POST",
      body: JSON.stringify({ ...docForm, availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], active: true }),
    });
    setDocForm({ ...docForm, name: "", qualification: "", regNumber: "", email: "" });
    load();
  };

  const addStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch("/api/staff", { method: "POST", body: JSON.stringify(staffForm) });
    setStaffForm({ ...staffForm, name: "", phone: "", email: "" });
    load();
  };

  const handleEditDoctor = (doc: Doctor) => {
    setEditingDoctor(doc);
    setIsModalOpen(true);
  };

  const handleDoctorSaved = (updated: Doctor) => {
    setDoctors((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  };

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Doctors & Staff Directory</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Platform-level doctor license directory, credential verification, and facility staff roster.
        </p>
      </div>

      <section className="bg-white border rounded-2xl p-5 space-y-4 shadow-sm">
        <h2 className="font-bold text-sm text-slate-900">Licensed Medical Practitioners ({doctors.length})</h2>
        <form onSubmit={addDoctor} className="grid sm:grid-cols-4 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
          <input required placeholder="Name (e.g. Dr. Jane Doe)" className="border rounded-lg px-2.5 py-1.5 bg-white" value={docForm.name} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })} />
          <select className="border rounded-lg px-2.5 py-1.5 bg-white" value={docForm.specialty} onChange={(e) => setDocForm({ ...docForm, specialty: e.target.value as PolyclinicSpecialty })}>
            {SPECIALTIES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input placeholder="Council Reg Number" className="border rounded-lg px-2.5 py-1.5 bg-white" value={docForm.regNumber} onChange={(e) => setDocForm({ ...docForm, regNumber: e.target.value })} />
          <button className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold py-1.5">Add Doctor</button>
        </form>

        <div className="grid md:grid-cols-2 gap-3.5">
          {doctors.map((d) => (
            <div key={d.id} className="border border-slate-200 rounded-xl p-3.5 text-xs space-y-2 bg-white hover:border-slate-300 transition-all">
              <div className="flex items-start gap-3">
                {/* Avatar with hover camera */}
                <div className="relative group shrink-0">
                  <div className="w-13 h-13 rounded-xl overflow-hidden bg-gradient-to-br from-blue-700 to-indigo-900 border border-slate-200 flex items-center justify-center">
                    {d.avatarUrl ? (
                      <img src={d.avatarUrl} alt={d.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold text-white">{d.name.split(" ")[1]?.charAt(0) || "D"}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleEditDoctor(d)}
                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 rounded-xl flex items-center justify-center text-white transition-opacity"
                    title="Change photo"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-900 text-sm truncate">{d.name}</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  </div>
                  <div className="text-blue-700 font-medium text-xs mt-0.5">{d.specialty}</div>
                  <div className="text-slate-500 text-[11px] truncate mt-0.5">{d.qualification || "Licensed Clinician"}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-600 pt-1">
                {d.regNumber && (
                  <span className="px-2 py-0.5 rounded bg-slate-100 font-mono flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-600" />
                    Reg: {d.regNumber}
                  </span>
                )}
                {d.hprId && (
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono flex items-center gap-1">
                    <Award className="w-3 h-3 text-blue-600" />
                    {d.hprId}
                  </span>
                )}
                <span className="px-2 py-0.5 rounded bg-slate-100">Room: {d.opdRoom || "OPD 101"}</span>
                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">₹{d.consultationFee} OPD</span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => handleEditDoctor(d)}
                  className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                >
                  <Edit3 className="w-3 h-3" />
                  Edit Profile & Photo
                </button>

                <div className="flex items-center gap-3">
                  <button
                    className={d.active ? "text-slate-600 hover:text-slate-900" : "text-emerald-600 hover:text-emerald-700 font-semibold"}
                    onClick={async () => {
                      await apiFetch(`/api/doctors/${d.id}`, { method: "PATCH", body: JSON.stringify({ active: !d.active }) });
                      load();
                    }}
                  >
                    {d.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    className="text-red-600 hover:text-red-700"
                    onClick={async () => {
                      if (confirm(`Remove ${d.name}?`)) {
                        await apiFetch(`/api/doctors/${d.id}`, { method: "DELETE" });
                        load();
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border rounded-2xl p-5 space-y-4 shadow-sm">
        <h2 className="font-bold text-sm text-slate-900">Clinical Support Staff ({staff.length})</h2>
        <form onSubmit={addStaff} className="grid sm:grid-cols-5 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
          <input required placeholder="Staff Name" className="border rounded-lg px-2.5 py-1.5 bg-white" value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} />
          <input placeholder="Clinical Role" className="border rounded-lg px-2.5 py-1.5 bg-white" value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} />
          <input placeholder="Department" className="border rounded-lg px-2.5 py-1.5 bg-white" value={staffForm.department} onChange={(e) => setStaffForm({ ...staffForm, department: e.target.value })} />
          <input placeholder="Phone" className="border rounded-lg px-2.5 py-1.5 bg-white" value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} />
          <button className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold py-1.5">Add Staff</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-2 px-3">Name</th>
                <th className="py-2 px-3">Role</th>
                <th className="py-2 px-3">Department</th>
                <th className="py-2 px-3">Shift</th>
                <th className="py-2 px-3">Contact</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-t hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-semibold text-slate-900">{s.name}</td>
                  <td className="py-2.5 px-3 text-slate-700">{s.role}</td>
                  <td className="py-2.5 px-3 text-slate-500">{s.department}</td>
                  <td className="py-2.5 px-3">{s.shift}</td>
                  <td className="py-2.5 px-3 text-slate-500">{s.email || s.phone}</td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      className="text-red-600 hover:text-red-700"
                      onClick={async () => {
                        await apiFetch(`/api/staff/${s.id}`, { method: "DELETE" });
                        load();
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Doctor Profile Modal */}
      {isModalOpen && editingDoctor && (
        <DoctorProfileModal
          doctor={editingDoctor}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingDoctor(null);
          }}
          onSave={handleDoctorSaved}
        />
      )}
    </div>
  );
};

import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { Doctor, PolyclinicSpecialty } from "../../types";

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
  const [docForm, setDocForm] = useState({
    name: "",
    specialty: "General Medicine" as PolyclinicSpecialty,
    qualification: "",
    regNumber: "",
    consultationFee: 600,
    opdRoom: "",
    phone: "",
    email: "",
    opdTiming: "09:00 AM - 02:00 PM",
  });
  const [staffForm, setStaffForm] = useState({
    name: "",
    role: "Nurse",
    department: "OPD",
    phone: "",
    email: "",
    shift: "Morning",
  });

  const load = () => {
    apiFetch<{ doctors: Doctor[] }>("/api/doctors").then((d) => setDoctors(d.doctors)).catch(() => undefined);
    apiFetch<{ staff: StaffRow[] }>("/api/staff").then((d) => setStaff(d.staff)).catch(() => undefined);
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

  return (
    <div className="space-y-8 max-w-6xl">
      <h1 className="text-xl font-extrabold">Doctors & staff</h1>

      <section className="bg-white border rounded-xl p-4 space-y-3">
        <h2 className="font-bold text-sm">Licensed practitioners ({doctors.length})</h2>
        <form onSubmit={addDoctor} className="grid sm:grid-cols-4 gap-2 text-xs">
          <input required placeholder="Name" className="border rounded px-2 py-1.5" value={docForm.name} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })} />
          <select className="border rounded px-2 py-1.5" value={docForm.specialty} onChange={(e) => setDocForm({ ...docForm, specialty: e.target.value as PolyclinicSpecialty })}>
            {SPECIALTIES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input placeholder="Reg number" className="border rounded px-2 py-1.5" value={docForm.regNumber} onChange={(e) => setDocForm({ ...docForm, regNumber: e.target.value })} />
          <button className="bg-blue-600 text-white rounded font-semibold">Add doctor</button>
        </form>
        <div className="grid md:grid-cols-2 gap-3">
          {doctors.map((d) => (
            <div key={d.id} className="border rounded-lg p-3 text-xs space-y-1">
              <div className="font-bold">{d.name}</div>
              <div className="text-blue-700">{d.specialty}</div>
              <div>Reg: {d.regNumber} · Room: {d.opdRoom}</div>
              <div>Fee ₹{d.consultationFee} · {d.active ? "Active" : "Inactive"}</div>
              <div className="flex gap-2 pt-1">
                <button
                  className="text-slate-600"
                  onClick={async () => {
                    await apiFetch(`/api/doctors/${d.id}`, { method: "PATCH", body: JSON.stringify({ active: !d.active }) });
                    load();
                  }}
                >
                  {d.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  className="text-red-600"
                  onClick={async () => {
                    await apiFetch(`/api/doctors/${d.id}`, { method: "DELETE" });
                    load();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border rounded-xl p-4 space-y-3">
        <h2 className="font-bold text-sm">Support staff ({staff.length})</h2>
        <form onSubmit={addStaff} className="grid sm:grid-cols-5 gap-2 text-xs">
          <input required placeholder="Name" className="border rounded px-2 py-1.5" value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} />
          <select className="border rounded px-2 py-1.5" value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}>
            {["Nurse", "Receptionist", "Pharmacist", "Lab Tech", "Admin"].map((r) => <option key={r}>{r}</option>)}
          </select>
          <input placeholder="Department" className="border rounded px-2 py-1.5" value={staffForm.department} onChange={(e) => setStaffForm({ ...staffForm, department: e.target.value })} />
          <input placeholder="Phone" className="border rounded px-2 py-1.5" value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} />
          <button className="bg-blue-600 text-white rounded font-semibold">Add staff</button>
        </form>
        <table className="w-full text-xs">
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="py-2 font-semibold">{s.name}</td>
                <td>{s.role}</td>
                <td>{s.department}</td>
                <td>{s.phone}</td>
                <td>{s.shift}</td>
                <td>
                  <button className="text-red-600" onClick={async () => { await apiFetch(`/api/staff/${s.id}`, { method: "DELETE" }); load(); }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};

/** Sample physio packages for the tenant-demo-physio workspace only. */
export interface DemoPhysioPackage {
  patientId: string;
  patientName: string;
  packageName: string;
  totalSessions: number;
  /** Done sessions the demo seed should leave on this package, across every date. */
  seedCompleted: number;
  phone: string;
  uhid: string;
  age: number;
  gender: string;
}

export const DEMO_PHYSIO_PACKAGES: readonly DemoPhysioPackage[] = [
  {
    patientId: "physio-pat-anita",
    patientName: "Anita Desai",
    packageName: "Lumbar rehab pack",
    totalSessions: 10,
    seedCompleted: 7,
    phone: "+91 98111 31001",
    uhid: "LUM-PHY-3101",
    age: 41,
    gender: "Female",
  },
  {
    patientId: "physio-pat-rohit",
    patientName: "Rohit Khanna",
    packageName: "Shoulder mobility pack",
    totalSessions: 8,
    seedCompleted: 5,
    phone: "+91 98111 31002",
    uhid: "LUM-PHY-3102",
    age: 36,
    gender: "Male",
  },
  {
    patientId: "physio-pat-leela",
    patientName: "Leela Nair",
    packageName: "Knee strength pack",
    totalSessions: 8,
    seedCompleted: 3,
    phone: "+91 98111 31003",
    uhid: "LUM-PHY-3103",
    age: 58,
    gender: "Female",
  },
  {
    patientId: "physio-pat-imran",
    patientName: "Imran Qureshi",
    packageName: "Post-op ankle pack",
    totalSessions: 6,
    seedCompleted: 6,
    phone: "+91 98111 31004",
    uhid: "LUM-PHY-3104",
    age: 29,
    gender: "Male",
  },
];

/** Done visits linked to this patient. Older sessions count; the date is not filtered. */
export function completedSessionsForPatient(
  visits: readonly { patientId?: string; status?: string }[],
  patientId: string
): number {
  return visits.filter((row) => row.patientId === patientId && row.status === "Completed").length;
}

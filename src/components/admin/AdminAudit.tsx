import React, { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";

interface Log {
  id: string;
  timestamp: string;
  user_name: string;
  action: string;
  details: string;
}

export const AdminAudit: React.FC = () => {
  const [logs, setLogs] = useState<Log[]>([]);
  useEffect(() => {
    apiFetch<{ logs: Log[] }>("/api/audit")
      .then((d) => setLogs(d.logs))
      .catch(() => setLogs([]));
  }, []);

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-extrabold mb-4">Audit log</h1>
      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Time</th>
              <th className="text-left px-3 py-2">User</th>
              <th className="text-left px-3 py-2">Action</th>
              <th className="text-left px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap text-slate-500">{l.timestamp}</td>
                <td className="px-3 py-2 font-semibold">{l.user_name}</td>
                <td className="px-3 py-2">{l.action}</td>
                <td className="px-3 py-2">{l.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { 
  TrendingUp, 
  Calendar, 
  Activity, 
  PlayCircle, 
  QrCode, 
  CheckCircle2, 
  Award, 
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Video
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend 
} from 'recharts';
import { TherapyPackage, PrescribedExercise } from '../../types';

interface PhysioProgressTrackerProps {
  therapyPackage?: TherapyPackage;
  exercises?: PrescribedExercise[];
  patientName: string;
  uhid: string;
}

// Sample recovery data trajectory if package is empty
const SAMPLE_TRAJECTORY_DATA = [
  { date: 'Day 1 (Aug 20)', vasPain: 9, romDegree: 25, mmtGrade: 3, label: 'Initial Acute Flare' },
  { date: 'Day 4 (Aug 23)', vasPain: 8, romDegree: 35, mmtGrade: 3, label: 'DN + IFT' },
  { date: 'Day 7 (Aug 26)', vasPain: 6, romDegree: 50, mmtGrade: 4, label: 'Traction' },
  { date: 'Day 11 (Aug 30)', vasPain: 4, romDegree: 65, mmtGrade: 4, label: 'Mobilization' },
  { date: 'Current (Sep 1)', vasPain: 3, romDegree: 80, mmtGrade: 5, label: 'Strengthening' }
];

export const PhysioProgressTracker: React.FC<PhysioProgressTrackerProps> = ({
  therapyPackage,
  exercises = [],
  patientName,
  uhid,
}) => {
  const [selectedExerciseForVideo, setSelectedExerciseForVideo] = useState<PrescribedExercise | null>(
    exercises[0] || null
  );
  const [showQrModal, setShowQrModal] = useState(false);

  // Parse package session log to chart data if available
  const chartData = therapyPackage && therapyPackage.sessionsLog.length > 0
    ? therapyPackage.sessionsLog.map((s) => ({
        date: `S${s.sessionNumber} (${s.date.slice(5)})`,
        vasPain: s.vasScore,
        romDegree: s.romDegreeSnapshot || (30 + s.sessionNumber * 12),
        label: s.proceduresDone[0] || `Session ${s.sessionNumber}`
      }))
    : SAMPLE_TRAJECTORY_DATA;

  const completed = therapyPackage?.completedSessions || 4;
  const total = therapyPackage?.totalSessions || 10;
  const progressPercent = Math.round((completed / total) * 100);

  return (
    <div className="space-y-4 bg-white rounded-xl border border-blue-200/80 p-4 sm:p-5 shadow-xs">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-600 text-white shadow-xs">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <span>Longitudinal ROM & VAS Recovery Trajectory</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                AI Recovery Model
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Multi-session joint angle improvement and pain reduction analytics for {patientName} ({uhid})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowQrModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold border border-blue-200 transition-all shadow-xs"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Digital HEP QR</span>
          </button>
        </div>
      </div>

      {/* Package Session Progress Bar */}
      <div className="bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-emerald-50/70 rounded-lg p-3.5 border border-blue-100 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-800 flex items-center gap-1.5">
            <Award className="w-4 h-4 text-blue-600" />
            {therapyPackage?.packageName || '10-Session Comprehensive Musculoskeletal Rehab Bundle'}
          </span>
          <span className="font-bold text-emerald-700">
            Session {completed} of {total} Completed ({progressPercent}%)
          </span>
        </div>

        {/* Visual Progress Bar */}
        <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-600 to-emerald-500 h-full rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          ></div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium pt-1">
          <span>Started: {therapyPackage?.startDate || '2026-08-20'}</span>
          <span>Status: <strong className="text-emerald-700 uppercase">Active Therapy Protocol</strong></span>
          <span>Next Milestone: <strong>Session {completed + 1} Review</strong></span>
        </div>
      </div>

      {/* Recovery Trajectory Recharts Graph */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-50/80 rounded-xl border border-slate-200 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700">
            <span className="flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-blue-600" />
              VAS Pain Score (0-10) vs Joint ROM Degrees (°)
            </span>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1 text-rose-600 font-semibold">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span> VAS Pain (Lower is better)
              </span>
              <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span> ROM Degrees (Higher is better)
              </span>
            </div>
          </div>

          <div className="h-56 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis yAxisId="left" domain={[0, 10]} tick={{ fontSize: 11, fill: '#ef4444' }} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 120]} tick={{ fontSize: 11, fill: '#10b981' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '11px',
                    border: 'none'
                  }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="vasPain"
                  name="VAS Pain (0-10)"
                  stroke="#ef4444"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#ef4444' }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="romDegree"
                  name="ROM Range (°)"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#10b981' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Exercise Video & Demonstration Preview */}
        <div className="bg-slate-50/80 rounded-xl border border-slate-200 p-3.5 space-y-3 flex flex-col justify-between">
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Video className="w-4 h-4 text-blue-600" />
              Interactive HEP Video Demonstration
            </span>

            {exercises.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={selectedExerciseForVideo?.id || ''}
                  onChange={(e) => {
                    const ex = exercises.find((item) => item.id === e.target.value);
                    if (ex) setSelectedExerciseForVideo(ex);
                  }}
                  className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-md p-1.5 focus:outline-none"
                >
                  {exercises.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.exerciseName} ({ex.targetArea})
                    </option>
                  ))}
                </select>

                {/* Animated Exercise Visual Demonstration Simulation Box */}
                <div className="bg-slate-900 text-white rounded-lg p-3 relative overflow-hidden text-center space-y-2 shadow-inner">
                  <div className="w-10 h-10 rounded-full bg-blue-600/80 mx-auto flex items-center justify-center animate-pulse">
                    <PlayCircle className="w-6 h-6 text-white" />
                  </div>
                  <h4 className="text-xs font-bold text-blue-200 line-clamp-1">
                    {selectedExerciseForVideo?.exerciseName || 'Exercise Form Demo'}
                  </h4>
                  <p className="text-[10px] text-slate-300 line-clamp-2">
                    {selectedExerciseForVideo?.instructions || 'Maintain neutral spine and breathe continuously.'}
                  </p>
                  <div className="flex items-center justify-center gap-3 text-[10px] font-mono text-emerald-400">
                    <span>{selectedExerciseForVideo?.sets || 3} Sets</span>
                    <span>•</span>
                    <span>{selectedExerciseForVideo?.reps || 10} Reps</span>
                    <span>•</span>
                    <span>{selectedExerciseForVideo?.holdSeconds || 5}s Hold</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic text-center py-6">
                Prescribe exercises above to preview animated video instructions
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowQrModal(true)}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Generate Patient Mobile Stream QR</span>
          </button>
        </div>
      </div>

      {/* Patient Mobile Stream QR Code Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 text-center space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 mx-auto flex items-center justify-center">
              <QrCode className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-bold text-base text-slate-900">Home Exercise Mobile Streaming</h3>
              <p className="text-xs text-slate-500 mt-1">
                Scan this QR code with any smartphone camera to watch HD exercise videos and log daily repetitions
              </p>
            </div>

            {/* Generated QR Code Canvas Graphic */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl inline-block mx-auto shadow-inner">
              <div className="w-40 h-40 bg-white border-2 border-slate-800 rounded-lg flex flex-col items-center justify-center p-2">
                <div className="grid grid-cols-5 gap-1.5 w-full h-full p-2">
                  {Array.from({ length: 25 }).map((_, i) => (
                    <div
                      key={i}
                      className={`rounded-xs ${
                        (i % 2 === 0 || i === 0 || i === 4 || i === 20 || i === 24 || i === 12)
                          ? 'bg-slate-900'
                          : 'bg-slate-200'
                      }`}
                    ></div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-blue-50 p-2.5 rounded-lg text-[11px] text-blue-900 font-medium">
              🔗 <strong>lumera.health/hep/{uhid}</strong>
            </div>

            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold"
            >
              Close Window
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

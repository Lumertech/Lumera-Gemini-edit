import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  User,
  FileText,
  Upload,
  Camera,
  Calendar,
  Clock,
  ShieldCheck,
  AlertCircle,
  Plus,
  Download,
  Trash2,
  Heart,
  Activity,
  Phone,
  Mail,
  MapPin,
  Sparkles,
  CheckCircle2,
  Stethoscope,
  Eye
} from 'lucide-react';
import { Patient, Prescription, Vitals } from '../types';

export interface PatientDocument {
  id: string;
  name: string;
  type: 'Lab Report' | 'Prescription' | 'Clinical Photo' | 'Discharge Summary' | 'Scan / X-Ray' | 'Other';
  date: string;
  url: string;
  size?: string;
}

interface PatientRecordModalProps {
  patient: Patient | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdatePatient?: (updated: Patient) => void;
  pastPrescriptions?: Prescription[];
}

export const PatientRecordModal: React.FC<PatientRecordModalProps> = ({
  patient,
  isOpen,
  onClose,
  onUpdatePatient,
  pastPrescriptions = [],
}) => {
  if (!isOpen || !patient) return null;

  const [activeTab, setActiveTab] = useState<'history' | 'documents' | 'vitals' | 'demographics'>('documents');
  const [documents, setDocuments] = useState<PatientDocument[]>([
    {
      id: 'doc-1',
      name: 'Complete Blood Count (CBC) & Lipid Profile.pdf',
      type: 'Lab Report',
      date: patient.lastVisit || '2026-03-10',
      url: '#',
      size: '2.4 MB',
    },
    {
      id: 'doc-2',
      name: 'Initial Clinical Examination Photo & Lesion.jpg',
      type: 'Clinical Photo',
      date: patient.lastVisit || '2026-03-10',
      url: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?auto=format&fit=crop&w=600&q=80',
      size: '1.8 MB',
    }
  ]);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);

    setTimeout(() => {
      const newDocs: PatientDocument[] = Array.from(files).map((f, idx) => {
        const file = f as File;
        return {
          id: `doc-up-${Date.now()}-${idx}`,
          name: file.name,
          type: file.type.includes('image') ? 'Clinical Photo' : 'Lab Report',
          date: new Date().toISOString().split('T')[0],
          url: URL.createObjectURL(file),
          size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        };
      });

      setDocuments((prev) => [...newDocs, ...prev]);
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }, 600);
  };

  // Start webcam
  const startCamera = async () => {
    setShowCameraModal(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setUploadError('Unable to access camera. Please allow camera permissions or upload from file.');
      setShowCameraModal(false);
    }
  };

  // Stop webcam
  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    setShowCameraModal(false);
  };

  // Capture snapshot from webcam
  const captureSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg');
      const newDoc: PatientDocument = {
        id: `cam-${Date.now()}`,
        name: `Clinical_Snapshot_${new Date().toISOString().split('T')[0]}.jpg`,
        type: 'Clinical Photo',
        date: new Date().toISOString().split('T')[0],
        url: dataUrl,
        size: '1.2 MB',
      };
      setDocuments((prev) => [newDoc, ...prev]);
    }
    stopCamera();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-100"
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-14 h-14 rounded-full bg-indigo-600/30 border-2 border-indigo-400 flex items-center justify-center text-xl font-bold text-indigo-200">
                  {patient.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-xl font-bold tracking-tight">{patient.name}</h2>
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-500/30 text-indigo-300 border border-indigo-400/30">
                      {patient.uhid}
                    </span>
                    {patient.abhaNumber && (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> ABHA Linked
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mt-1 flex items-center space-x-3">
                    <span>{patient.age} yrs, {patient.gender}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {patient.phone}</span>
                    <span>•</span>
                    <span className="text-rose-300 font-medium">Blood: {patient.bloodGroup || 'O+'}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={startCamera}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium flex items-center space-x-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Take Photo</span>
                </button>
                <label className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>Upload Medical History</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sub-header / Tabs */}
            <div className="bg-slate-50 border-b border-slate-200 px-6 flex space-x-6 text-sm font-medium">
              <button
                onClick={() => setActiveTab('documents')}
                className={`py-3.5 border-b-2 font-semibold transition-colors flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'documents'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>Medical History & Documents ({documents.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-3.5 border-b-2 font-semibold transition-colors flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'history'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>Visit History & Prescriptions</span>
              </button>
              <button
                onClick={() => setActiveTab('vitals')}
                className={`py-3.5 border-b-2 font-semibold transition-colors flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'vitals'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Activity className="w-4 h-4" />
                <span>Vitals & Clinical Data</span>
              </button>
              <button
                onClick={() => setActiveTab('demographics')}
                className={`py-3.5 border-b-2 font-semibold transition-colors flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'demographics'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <User className="w-4 h-4" />
                <span>Demographics & Allergies</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 bg-slate-100/50 space-y-6">
              {uploadError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Documents & Medical History Tab */}
              {activeTab === 'documents' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">Uploaded Medical Records & Scan History</h3>
                      <p className="text-xs text-slate-500">Past reports, lab results, discharge summaries, and clinical photos.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={startCamera}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-indigo-200 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" /> Take Photo
                      </button>
                      <label className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm cursor-pointer">
                        <Upload className="w-3.5 h-3.5" /> Upload File
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                          className="hidden"
                          onChange={handleFileUpload}
                        />
                      </label>
                    </div>
                  </div>

                  {isUploading && (
                    <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-center text-xs text-indigo-700 animate-pulse">
                      Uploading and indexing medical document...
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {documents.map((doc) => (
                      <div key={doc.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between group hover:border-indigo-300 transition-colors">
                        <div className="flex items-start space-x-3">
                          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                            {doc.type === 'Clinical Photo' ? <Camera className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors line-clamp-1">{doc.name}</h4>
                            <div className="flex items-center space-x-2 mt-1 text-[11px] text-slate-500">
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{doc.type}</span>
                              <span>•</span>
                              <span>{doc.date}</span>
                              {doc.size && (
                                <>
                                  <span>•</span>
                                  <span>{doc.size}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1">
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors"
                            title="View Document"
                          >
                            <Eye className="w-4 h-4" />
                          </a>
                          <button
                            onClick={() => setDocuments(documents.filter((d) => d.id !== doc.id))}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Visit History Tab */}
              {activeTab === 'history' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-800">Past Consultations & Prescriptions</h3>
                  {pastPrescriptions.length === 0 ? (
                    <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-slate-500 text-xs">
                      <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                      No past prescription history recorded in this session. All clinical records are securely linked to UHID {patient.uhid}.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pastPrescriptions.map((rx, idx) => (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-slate-900">Consultation #{idx + 1}</span>
                              <span className="text-xs text-slate-500">{rx.date || 'Recent'}</span>
                            </div>
                            <p className="text-xs text-slate-600 mt-1">Diagnosis: <span className="font-semibold text-slate-800">{rx.diagnosis || 'General Evaluation'}</span></p>
                          </div>
                          <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">Completed</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Vitals Tab */}
              {activeTab === 'vitals' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-800">Recorded Vitals & Clinical Metrics</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">Blood Pressure</p>
                      <p className="text-lg font-bold text-slate-900 mt-1">{patient.vitals?.bloodPressureSystolic ? `${patient.vitals.bloodPressureSystolic}/${patient.vitals.bloodPressureDiastolic} mmHg` : '120/80 mmHg'}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">Heart Rate</p>
                      <p className="text-lg font-bold text-slate-900 mt-1">{patient.vitals?.heartRate ? `${patient.vitals.heartRate} bpm` : '78 bpm'}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">SpO2 (Oxygen)</p>
                      <p className="text-lg font-bold text-slate-900 mt-1">{patient.vitals?.spO2 ? `${patient.vitals.spO2}%` : '98%'}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">Temperature</p>
                      <p className="text-lg font-bold text-slate-900 mt-1">{patient.vitals?.temperature ? `${patient.vitals.temperature}°F` : '98.4°F'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Demographics & Allergies Tab */}
              {activeTab === 'demographics' && (
                <div className="space-y-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold text-slate-800">Patient Demographics & Clinical Profile</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 block">Full Name</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{patient.name}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">UHID</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{patient.uhid}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Phone Number</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{patient.phone}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Age / Gender</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{patient.age} years, {patient.gender}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Blood Group</span>
                        <span className="font-semibold text-rose-600 mt-0.5 block">{patient.bloodGroup || 'O+'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Emergency Contact</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{patient.emergencyContact || 'Not Provided'}</span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100">
                      <span className="text-xs text-slate-500 block mb-1">Known Allergies</span>
                      <div className="flex flex-wrap gap-1.5">
                        {patient.allergies && patient.allergies.length > 0 ? (
                          patient.allergies.map((a, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-xs font-semibold border border-rose-200">
                              {a}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-500 italic">No known drug or food allergies</span>
                        )}
                      </div>
                    </div>

                    <div className="pt-2">
                      <span className="text-xs text-slate-500 block mb-1">Chronic Conditions</span>
                      <div className="flex flex-wrap gap-1.5">
                        {patient.chronicConditions && patient.chronicConditions.length > 0 ? (
                          patient.chronicConditions.map((c, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
                              {c}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-500 italic">No chronic conditions recorded</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Webcam Snapshot Modal */}
      {showCameraModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-900 rounded-2xl p-6 max-w-xl w-full text-white space-y-4 border border-slate-700 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Camera className="w-4 h-4 text-indigo-400" /> Capture Clinical Photo / Document
              </h3>
              <button onClick={stopCamera} className="p-1 text-slate-400 hover:text-white rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={stopCamera}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={captureSnapshot}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-2 shadow-lg cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Capture Snapshot</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};

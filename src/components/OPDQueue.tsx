import React from 'react';
import { QueueBoard } from './QueueBoard';
import { Appointment, Vitals, Patient, Doctor } from '../types';

export interface OPDQueueProps {
  appointments: Appointment[];
  doctors: Doctor[];
  patients: Patient[];
  onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void;
  onUpdateVitals: (appointmentId: string, vitals: Vitals) => void;
  onStartConsultation: (appointment: Appointment) => void;
  onOpenBill: (appointment: Appointment) => void;
  onAddNewToken: (newToken: Partial<Appointment>) => void;
}

export const OPDQueue: React.FC<OPDQueueProps> = (props) => {
  return <QueueBoard {...props} />;
};

export default OPDQueue;

import React, { useState, useEffect } from 'react';
import { 
  Receipt, 
  Printer, 
  CheckCircle,
  CheckCircle2, 
  QrCode, 
  CreditCard, 
  DollarSign, 
  Plus, 
  Trash2, 
  Sparkles,
  ShieldCheck,
  PackageCheck,
  Pill,
  AlertTriangle,
  Layers,
  ArrowRight,
  Send,
  Smartphone,
  X,
  Check,
  RefreshCw,
  Wallet
} from 'lucide-react';
import { BillItem, Patient, Doctor, ClinicSettings, PharmacyBatchItem, TherapyPackage, Prescription } from '../types';
import { MOCK_PHARMACY_BATCHES, MOCK_THERAPY_PACKAGES } from '../data/clinicalData';
import { BLANK_CLINIC_SETTINGS } from '../lib/letterhead';
import { apiFetch } from '../api/http';

type PersistedInvoice = {
  id: string;
  invoiceNumber: string;
  paymentStatus: string;
  payLink?: string;
  receiptWhatsAppChannel?: string;
  receiptWhatsAppStatus?: string;
};

interface BillingManagerProps {
  currentPatient: Patient;
  currentDoctor: Doctor;
  clinicSettings?: ClinicSettings;
  activePrescription?: Prescription | null;
  appointmentId?: string;
  onPaymentSuccess?: (invoiceNumber: string, amount: number) => void;
}

export const BillingManager: React.FC<BillingManagerProps> = ({
  currentPatient,
  currentDoctor,
  clinicSettings = BLANK_CLINIC_SETTINGS,
  activePrescription,
  appointmentId,
  onPaymentSuccess,
}) => {
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-2026-${Math.floor(1000 + Math.random() * 9000)}`);
  const [activeTab, setActiveTab] = useState<'invoice' | 'pharmacy_batches' | 'rehab_packages'>('invoice');
  const [pharmacyStock, setPharmacyStock] = useState<PharmacyBatchItem[]>(MOCK_PHARMACY_BATCHES);

  // Collect Payment Modal state
  const [showCollectPaymentModal, setShowCollectPaymentModal] = useState(false);
  const [cashTendered, setCashTendered] = useState<number>(0);
  const [receiptNumber] = useState(`RCPT-2026-${Math.floor(1000 + Math.random() * 9000)}`);
  const [isReceiptIssued, setIsReceiptIssued] = useState(false);
  const [isSendingWhatsAppReceipt, setIsSendingWhatsAppReceipt] = useState(false);
  const [whatsAppReceiptSent, setWhatsAppReceiptSent] = useState(false);
  const [whatsAppReceiptSandbox, setWhatsAppReceiptSandbox] = useState(false);

  const [paymentMode, setPaymentMode] = useState<'UPI' | 'Cash' | 'Card' | 'Insurance'>('UPI');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [isPaid, setIsPaid] = useState<boolean>(false);
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemPrice, setNewItemPrice] = useState<number>(500);
  const [newItemCat, setNewItemCat] = useState<BillItem['category']>('Procedure');
  const [persistedInvoice, setPersistedInvoice] = useState<PersistedInvoice | null>(null);
  const [payLink, setPayLink] = useState('');
  const [sandboxPay, setSandboxPay] = useState(false);
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectError, setCollectError] = useState('');

  const [items, setItems] = useState<BillItem[]>([]);
  const gstinLabel = clinicSettings.gstin?.trim() || 'Not set';
  const upiLabel = clinicSettings.upiId?.trim() || 'Not set';

  useEffect(() => {
    const defaultConsultation: BillItem = {
      id: 'b-consult',
      description: `OPD Specialist Consultation - ${currentDoctor.specialty} (${currentDoctor.name})`,
      category: 'Consultation',
      hsnSacCode: '999312',
      quantity: 1,
      unitPrice: currentDoctor.consultationFee || 600,
      gstPercent: 0,
      total: currentDoctor.consultationFee || 600,
    };

    const newItems: BillItem[] = [defaultConsultation];

    if (activePrescription) {
      // Append prescribed medicines
      if (activePrescription.medicines && activePrescription.medicines.length > 0) {
        activePrescription.medicines.forEach((med, idx) => {
          const estimatedCost = 140 + (idx * 25);
          newItems.push({
            id: `b-med-${idx}`,
            description: `Rx Pharmacy: ${med.drugName} (${med.dosage}) - ${med.durationDays}d`,
            category: 'Pharmacy',
            hsnSacCode: '300490',
            quantity: 1,
            unitPrice: estimatedCost,
            gstPercent: 0,
            total: estimatedCost,
          });
        });
      }

      // Append prescribed lab tests
      if (activePrescription.labTests && activePrescription.labTests.length > 0) {
        activePrescription.labTests.forEach((lab, idx) => {
          newItems.push({
            id: `b-lab-${idx}`,
            description: `Diagnostic Lab Order: ${lab.testName}`,
            category: 'Lab',
            hsnSacCode: '999316',
            quantity: 1,
            unitPrice: lab.price || 450,
            gstPercent: 0,
            total: lab.price || 450,
          });
        });
      }

      // Append performed therapies / procedures if any
      if (activePrescription.performedTherapies && activePrescription.performedTherapies.length > 0) {
        activePrescription.performedTherapies.forEach((proc, idx) => {
          newItems.push({
            id: `b-proc-${idx}`,
            description: `Clinical Therapy: ${proc.name} (${proc.targetArea})`,
            category: 'Procedure',
            hsnSacCode: '999314',
            quantity: 1,
            unitPrice: 850,
            gstPercent: 0,
            total: 850,
          });
        });
      }
    } else {
      // Default initial procedure
      newItems.push({
        id: 'b-proc-init',
        description: 'Trigger Point Dry Needling & Class IV Laser (Session 1)',
        category: 'Procedure',
        hsnSacCode: '999314',
        quantity: 1,
        unitPrice: 850,
        gstPercent: 0,
        total: 850,
      });
    }

    setItems(newItems);
    setPersistedInvoice(null);
    setPayLink('');
    setSandboxPay(false);
    setIsPaid(false);
    setIsReceiptIssued(false);
    setWhatsAppReceiptSent(false);
    setCollectError('');
  }, [activePrescription, currentDoctor, currentPatient.id]);

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const totalAmount = Math.max(0, subtotal - discountAmount);

  const applyPaidInvoice = (invoice: PersistedInvoice) => {
    setPersistedInvoice(invoice);
    setInvoiceNumber(invoice.invoiceNumber);
    if (invoice.payLink) setPayLink(invoice.payLink);
    const paid = invoice.paymentStatus === 'Paid';
    setIsPaid(paid);
    setIsReceiptIssued(paid);
    if (paid) onPaymentSuccess?.(invoice.invoiceNumber, totalAmount);
  };

  const ensureInvoice = async (): Promise<PersistedInvoice> => {
    if (persistedInvoice?.id && persistedInvoice.paymentStatus !== 'Paid') return persistedInvoice;
    if (persistedInvoice?.paymentStatus === 'Paid') return persistedInvoice;
    const created = await apiFetch<{ invoice: PersistedInvoice & { invoiceNumber: string; paymentStatus: string; payLink?: string } }>(
      '/api/invoices',
      {
        method: 'POST',
        body: JSON.stringify({
          invoiceNumber,
          appointmentId: appointmentId || '',
          patientId: currentPatient.id,
          patientName: currentPatient.name,
          patientPhone: currentPatient.phone,
          patientUhid: currentPatient.uhid,
          items,
          subtotal,
          discountAmount,
          taxAmount: 0,
          gstPercent: 0,
          gstin: clinicSettings.gstin || '',
          upiId: clinicSettings.upiId || '',
          issuedBy: currentDoctor.name,
        }),
      }
    );
    const invoice = created.invoice;
    setPersistedInvoice(invoice);
    setInvoiceNumber(invoice.invoiceNumber);
    return invoice;
  };

  const refreshInvoice = async (id: string) => {
    const res = await apiFetch<{ invoice: PersistedInvoice }>(`/api/invoices/${id}`);
    applyPaidInvoice(res.invoice);
    return res.invoice;
  };

  const startUpiCollect = async () => {
    setCollectBusy(true);
    setCollectError('');
    try {
      const invoice = await ensureInvoice();
      const order = await apiFetch<{
        invoice: PersistedInvoice;
        payLink?: string;
        sandbox?: boolean;
        error?: string;
      }>(`/api/invoices/${invoice.id}/pay-order`, { method: 'POST' });
      setPersistedInvoice(order.invoice);
      setInvoiceNumber(order.invoice.invoiceNumber);
      setPayLink(order.payLink || order.invoice.payLink || '');
      setSandboxPay(Boolean(order.sandbox));
    } catch (err) {
      setCollectError(err instanceof Error ? err.message : 'Failed to create Razorpay pay link');
    } finally {
      setCollectBusy(false);
    }
  };

  const simulateSandboxCapture = async () => {
    if (!persistedInvoice?.id) return;
    setCollectBusy(true);
    setCollectError('');
    try {
      const res = await apiFetch<{ invoice: PersistedInvoice }>(
        `/api/invoices/${persistedInvoice.id}/sandbox-pay`,
        { method: 'POST' }
      );
      applyPaidInvoice(res.invoice);
    } catch (err) {
      setCollectError(err instanceof Error ? err.message : 'Sandbox capture failed');
    } finally {
      setCollectBusy(false);
    }
  };

  const collectDeskPayment = async () => {
    setCollectBusy(true);
    setCollectError('');
    try {
      const invoice = await ensureInvoice();
      const res = await apiFetch<{ invoice: PersistedInvoice }>(`/api/invoices/${invoice.id}/desk-collect`, {
        method: 'POST',
        body: JSON.stringify({ paymentMode }),
      });
      applyPaidInvoice(res.invoice);
    } catch (err) {
      setCollectError(err instanceof Error ? err.message : 'Desk collect failed');
    } finally {
      setCollectBusy(false);
    }
  };

  useEffect(() => {
    if (!persistedInvoice?.id || isPaid || !payLink) return;
    const timer = window.setInterval(() => {
      void refreshInvoice(persistedInvoice.id).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [persistedInvoice?.id, isPaid, payLink]);

  const handleAddItem = () => {
    if (!newItemDesc.trim()) return;
    const newItem: BillItem = {
      id: 'b-' + Date.now(),
      description: newItemDesc,
      category: newItemCat,
      hsnSacCode: '999319',
      quantity: 1,
      unitPrice: Number(newItemPrice),
      gstPercent: 0,
      total: Number(newItemPrice),
    };
    setItems([...items, newItem]);
    setNewItemDesc('');
  };

  const handleAddPharmacyDrugToBill = (drug: PharmacyBatchItem) => {
    if (drug.currentStock <= 0) return;
    const newItem: BillItem = {
      id: 'b-med-' + Date.now(),
      description: `${drug.drugName} (Batch: ${drug.batchNumber}, Exp: ${drug.expiryDate})`,
      category: 'Pharmacy',
      hsnSacCode: '300490',
      quantity: 1,
      unitPrice: drug.mrp,
      gstPercent: 0,
      total: drug.mrp
    };
    setItems([...items, newItem]);

    // Deduct 1 unit from stock
    setPharmacyStock((prev) =>
      prev.map((item) =>
        item.id === drug.id ? { ...item, currentStock: Math.max(0, item.currentStock - 1) } : item
      )
    );
    setActiveTab('invoice');
  };

  const handleAddRehabPackageToBill = (pkg: TherapyPackage) => {
    const newItem: BillItem = {
      id: 'b-pkg-' + Date.now(),
      description: `${pkg.packageName} (${pkg.totalSessions} Total Sessions)`,
      category: 'Package',
      hsnSacCode: '999315',
      quantity: 1,
      unitPrice: pkg.cost,
      gstPercent: 0,
      total: pkg.cost
    };
    setItems([...items, newItem]);
    setActiveTab('invoice');
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter((i) => i.id !== id));
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Top Banner & Sub-Navigation */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm no-print">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-teal-50 text-teal-700 border border-teal-200">
              Integrated OPD Desk & Pharmacy
            </span>
            <span className="font-mono text-xs text-slate-500 font-medium">{invoiceNumber}</span>
          </div>
          <h1 className="text-lg font-bold text-slate-900 mt-1">Multi-Specialty Billing, Therapy Packages & Batch Inventory</h1>
        </div>

        <div className="flex items-center space-x-2">
          {/* Sub Navigation */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('invoice')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'invoice' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tax Invoice
            </button>
            <button
              onClick={() => setActiveTab('pharmacy_batches')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                activeTab === 'pharmacy_batches' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Pill className="w-3.5 h-3.5 text-blue-600" />
              <span>Pharmacy Batches</span>
            </button>
            <button
              onClick={() => setActiveTab('rehab_packages')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                activeTab === 'rehab_packages' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-emerald-600" />
              <span>Rehab Packages</span>
            </button>
          </div>

          <button
            onClick={() => setShowCollectPaymentModal(true)}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>{isPaid ? 'Payment Collected (Receipt)' : 'Collect Payment'}</span>
          </button>

          <button
            onClick={() => window.print()}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* TAB 1: TAX INVOICE */}
      {activeTab === 'invoice' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-6 sm:p-8 space-y-6">
          {/* Clinic & GST Header */}
          <div className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{clinicSettings.name || 'Clinic name not set'}</h2>
              <p className="text-xs text-slate-600 mt-0.5">
                {[clinicSettings.address, clinicSettings.city].filter(Boolean).join(', ') || 'Address not set'}
              </p>
              <p className="text-xs text-slate-500 font-mono">
                {[
                  clinicSettings.gstin ? `GSTIN: ${clinicSettings.gstin}` : null,
                  clinicSettings.regId ? `Clinic Reg: ${clinicSettings.regId}` : null,
                  clinicSettings.phone ? `Tel: ${clinicSettings.phone}` : null,
                  clinicSettings.email || null,
                ].filter(Boolean).join(' • ') || 'GSTIN / clinic registration not set'}
              </p>
            </div>

            <div className="text-left sm:text-right">
              {(clinicSettings.signatureUrl || currentDoctor.signatureUrl) && (
                <img
                  src={clinicSettings.signatureUrl || currentDoctor.signatureUrl}
                  alt="Clinic signature"
                  className="max-h-10 object-contain mb-1 ml-auto"
                />
              )}
              <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-slate-900 text-white uppercase tracking-wider">
                GST Tax Invoice / Cash Receipt
              </span>
              <p className="text-xs font-mono text-slate-700 mt-1 font-bold">No: {invoiceNumber}</p>
              <p className="text-xs text-slate-500">{new Date().toLocaleDateString('en-IN')}</p>
            </div>
          </div>

          {/* Patient Details Row */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Billed To (Patient)</span>
              <strong className="text-slate-900 text-xs">{currentPatient.name}</strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">UHID / Age / Gender</span>
              <span className="text-slate-800 font-mono font-semibold text-xs">{currentPatient.uhid} • {currentPatient.age}y/{currentPatient.gender.charAt(0)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Consulting Doctor</span>
              <span className="text-slate-800 font-semibold text-xs">{currentDoctor.name}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Payment Status</span>
              <span className={`font-bold inline-block px-2 py-0.5 rounded text-[10px] ${
                isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {isPaid ? 'PAID' : 'PENDING'}
              </span>
            </div>
          </div>

          {/* Add Item Row (No-print) */}
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center gap-2 text-xs no-print">
            <input
              type="text"
              value={newItemDesc}
              onChange={(e) => setNewItemDesc(e.target.value)}
              placeholder="Item / Service description (e.g. Dry Needling, Dental RCT, Ultrasound Scan)..."
              className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-600"
            />
            <select
              value={newItemCat}
              onChange={(e) => setNewItemCat(e.target.value as any)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none"
            >
              <option value="Procedure">Procedure</option>
              <option value="Package">Therapy Package</option>
              <option value="Lab">Lab Test</option>
              <option value="Consultation">Consultation</option>
              <option value="Pharmacy">Pharmacy</option>
            </select>
            <input
              type="number"
              value={newItemPrice}
              onChange={(e) => setNewItemPrice(Number(e.target.value))}
              className="w-24 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white font-mono"
              placeholder="Price"
            />
            <button
              onClick={handleAddItem}
              className="px-4 py-1.5 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-700 shadow-xs"
            >
              Add Item
            </button>
          </div>

          {/* Invoice Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                  <th className="py-2.5 px-3 font-bold w-10">#</th>
                  <th className="py-2.5 px-3 font-bold">Service / Item Description</th>
                  <th className="py-2.5 px-3 font-bold">HSN/SAC</th>
                  <th className="py-2.5 px-3 font-bold">Qty</th>
                  <th className="py-2.5 px-3 font-bold">Rate</th>
                  <th className="py-2.5 px-3 font-bold text-right">Amount (₹)</th>
                  <th className="py-2.5 px-3 font-bold no-print w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 text-slate-400 font-bold">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <span className="font-bold text-slate-900">{item.description}</span>
                      <span className="text-[10px] text-slate-400 block">{item.category}</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{item.hsnSacCode}</td>
                    <td className="py-2.5 px-3 font-medium">{item.quantity}</td>
                    <td className="py-2.5 px-3 font-mono">₹{item.unitPrice}</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900 text-right">
                      ₹{item.total}
                    </td>
                    <td className="py-2.5 px-3 no-print text-right">
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Calculations & Summary */}
          <div className="border-t border-slate-200 pt-4 flex flex-col sm:flex-row justify-between gap-6">
            {/* Payment Mode Selector & UPI QR */}
            <div className="space-y-3 flex-1">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Payment Mode:</span>
              <div className="flex gap-2 no-print">
                {(['UPI', 'Cash', 'Card', 'Insurance'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setPaymentMode(mode)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                      paymentMode === mode
                        ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              {/* UPI QR Code box */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center space-x-3 w-fit">
                <div className="w-14 h-14 bg-white p-1 rounded-lg border border-slate-200 flex items-center justify-center">
                  <QrCode className="w-12 h-12 text-slate-900" />
                </div>
                <div className="text-xs">
                  <strong className="text-slate-900 block font-mono">UPI: {upiLabel}</strong>
                  <span className="text-slate-500 text-[11px] block">
                    {payLink ? 'Razorpay UPI / cards / netbanking pay link' : 'Scan via GPay, PhonePe, Paytm, BHIM'}
                  </span>
                  <span className="text-emerald-700 font-semibold text-[11px]">
                    Paid only after verified Razorpay webhook
                  </span>
                </div>
              </div>
            </div>

            {/* Totals */}
            <div className="w-full sm:w-64 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <strong className="font-mono">₹{subtotal}</strong>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>GST (Healthcare Exempt):</span>
                <strong className="font-mono">₹0.00</strong>
              </div>
              <div className="flex justify-between text-slate-600 items-center no-print">
                <span>Discount (₹):</span>
                <input
                  type="number"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(Number(e.target.value))}
                  className="w-20 border border-slate-200 rounded px-1.5 py-0.5 text-right font-mono"
                />
              </div>
              <div className="border-t-2 border-slate-900 pt-2 flex justify-between text-sm">
                <strong className="text-slate-900">Total Payable:</strong>
                <strong className="text-teal-800 font-mono text-base font-black">₹{totalAmount}</strong>
              </div>

              <div className="pt-2 no-print space-y-1.5">
                <button
                  onClick={() => setShowCollectPaymentModal(true)}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    isPaid
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-teal-600 text-white hover:bg-teal-700 shadow-teal-100'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>{isPaid ? '✓ Payment Received (View Receipt)' : 'Collect Payment (UPI / Cash / Card)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PHARMACY BATCH INVENTORY & FIFO DISPENSING */}
      {activeTab === 'pharmacy_batches' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Pill className="w-4 h-4 text-blue-600" />
                <span>Pharmacy Batch-Level Inventory & Expiry Sentinel</span>
              </h3>
              <p className="text-xs text-slate-500">
                FIFO batch selection, near-expiry alerts (&lt; 60 days), and real-time stock deduction
              </p>
            </div>
            <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full">
              {pharmacyStock.length} Active Formulations
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pharmacyStock.map((batch) => {
              let statusColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
              if (batch.status === 'Near Expiry') statusColor = 'bg-amber-100 text-amber-800 border-amber-300';
              if (batch.status === 'Expired') statusColor = 'bg-rose-100 text-rose-800 border-rose-300';
              if (batch.status === 'Low Stock') statusColor = 'bg-purple-100 text-purple-800 border-purple-300';

              return (
                <div
                  key={batch.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5 flex flex-col justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-slate-500 bg-white px-2 py-0.5 rounded border">
                        {batch.batchNumber}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColor}`}>
                        {batch.status}
                      </span>
                    </div>

                    <h4 className="font-bold text-xs text-slate-900 line-clamp-1">{batch.drugName}</h4>
                    <p className="text-[11px] text-slate-500 line-clamp-1">{batch.composition}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700 bg-white p-2 rounded-lg border border-slate-200/80">
                    <div>Stock: <strong className={batch.currentStock < batch.reorderLevel ? 'text-rose-600' : 'text-slate-900'}>{batch.currentStock} units</strong></div>
                    <div>MRP: <strong className="text-teal-700">₹{batch.mrp}</strong></div>
                    <div>Expiry: <strong className={batch.daysToExpiry < 60 ? 'text-amber-700' : 'text-slate-700'}>{batch.expiryDate}</strong></div>
                    <div>Reorder: <strong>{batch.reorderLevel} units</strong></div>
                  </div>

                  <button
                    onClick={() => handleAddPharmacyDrugToBill(batch)}
                    disabled={batch.currentStock <= 0}
                    className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Dispense & Add to Bill</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: MULTI-SESSION REHAB PACKAGES */}
      {activeTab === 'rehab_packages' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" />
                <span>Multi-Session Clinical Care & Rehabilitation Packages</span>
              </h3>
              <p className="text-xs text-slate-500">
                Discounted bundle billing for 8/10 session physiotherapy protocols and maternity care packages
              </p>
            </div>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
              Package Master Catalog
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {MOCK_THERAPY_PACKAGES.map((pkg) => (
              <div
                key={pkg.id}
                className="p-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/50 via-white to-slate-50 space-y-3 flex flex-col justify-between shadow-xs"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      {pkg.department}
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-700">
                      {pkg.totalSessions} Sessions
                    </span>
                  </div>

                  <h4 className="font-bold text-xs text-slate-900 leading-snug">{pkg.packageName}</h4>
                  <p className="text-sm font-black text-emerald-800">₹{pkg.cost}</p>
                </div>

                <div className="space-y-1 text-[11px] text-slate-600 border-t border-slate-200/80 pt-2">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Includes Laser, Dry Needling & Manual Therapy</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Periodic ROM Re-evaluation & Home Protocol</span>
                  </div>
                </div>

                <button
                  onClick={() => handleAddRehabPackageToBill(pkg)}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Enrol Patient & Bill ₹{pkg.cost}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COLLECT PAYMENT & GST RECEIPT MODAL */}
      {showCollectPaymentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2 text-slate-900">
                <Receipt className="w-5 h-5 text-teal-600" />
                <div>
                  <h3 className="font-bold text-base">
                    {isPaid ? 'GST Payment Receipt & Confirmation' : 'Collect Consultation & Clinical Payment'}
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">Invoice: {invoiceNumber} • UHID: {currentPatient.uhid}</p>
                </div>
              </div>
              <button
                onClick={() => setShowCollectPaymentModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Patient & Bill Summary Header */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Patient</span>
                <strong className="text-slate-900 text-xs">{currentPatient.name}</strong>
                <span className="text-slate-500 text-[11px] block">{currentPatient.phone}</span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Amount Due</span>
                <strong className="text-teal-800 font-mono text-xl font-black">₹{totalAmount}</strong>
                <span className={`text-[10px] font-bold block ${isPaid ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {isPaid ? 'PAID IN FULL' : 'PAYMENT PENDING'}
                </span>
              </div>
            </div>

            {!isPaid ? (
              <div className="space-y-4">
                {/* Method selector */}
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    Select Payment Method:
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['UPI', 'Cash', 'Card', 'Insurance'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setPaymentMode(m)}
                        className={`py-2 px-2 text-center rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          paymentMode === m
                            ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Method Specific UI */}
                {paymentMode === 'UPI' && (
                  <div className="p-4 bg-teal-50/60 rounded-xl border border-teal-200 flex items-center gap-4">
                    <div className="w-24 h-24 bg-white p-1.5 rounded-xl border border-teal-200 flex items-center justify-center shrink-0 shadow-xs">
                      <QrCode className="w-20 h-20 text-slate-900" />
                    </div>
                    <div className="text-xs space-y-1">
                      <span className="text-teal-900 font-bold block text-sm">Razorpay UPI collect</span>
                      <p className="font-mono text-[11px] text-slate-700 font-semibold">VPA: {upiLabel}</p>
                      <p className="text-[11px] text-slate-600">Amount: <strong>₹{totalAmount}</strong></p>
                      {payLink ? (
                        <a href={payLink} target="_blank" rel="noreferrer" className="text-[11px] text-teal-800 font-semibold underline break-all">
                          {payLink}
                        </a>
                      ) : (
                        <p className="text-[10px] text-slate-500">Generate a Razorpay pay link. Invoice stays Unpaid until webhook.</p>
                      )}
                    </div>
                  </div>
                )}

                {paymentMode === 'Cash' && (
                  <div className="p-4 bg-amber-50/60 rounded-xl border border-amber-200 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-700">Cash Received / Tendered:</span>
                      <div className="flex items-center space-x-1">
                        <span className="font-mono font-bold text-slate-600">₹</span>
                        <input
                          type="number"
                          value={cashTendered || ''}
                          onChange={(e) => setCashTendered(Number(e.target.value))}
                          placeholder={totalAmount.toString()}
                          className="w-28 border border-amber-300 rounded-lg px-2.5 py-1 text-right font-mono font-bold bg-white focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[10px] text-slate-500 font-bold uppercase">Quick Cash:</span>
                      {[totalAmount, 500, 1000, 2000].map((amt, i) => (
                        <button
                          key={i}
                          onClick={() => setCashTendered(amt)}
                          className="px-2 py-0.5 rounded bg-white border border-amber-200 text-amber-900 font-mono text-[11px] font-bold hover:bg-amber-100"
                        >
                          ₹{amt}
                        </button>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-amber-200 flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-700">Change to Return to Patient:</span>
                      <span className="font-mono font-black text-amber-900 text-sm">
                        ₹{Math.max(0, (cashTendered || 0) - totalAmount)}
                      </span>
                    </div>
                  </div>
                )}

                {paymentMode === 'Card' && (
                  <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-200 flex items-center gap-3 text-xs">
                    <CreditCard className="w-8 h-8 text-blue-600 shrink-0" />
                    <div>
                      <strong className="text-slate-900 block">PineLabs Plutus EDC Terminal Connected</strong>
                      <p className="text-[11px] text-slate-600">
                        Tap / Dip patient debit or credit card (RuPay, Visa, Mastercard) on the desk terminal.
                      </p>
                      <p className="text-[10px] text-blue-700 font-mono mt-1 font-semibold">
                        Terminal ID: PLUTUS-DESK-01 • Auth Ref: AUTH-{Math.floor(1000 + Math.random() * 9000)}
                      </p>
                    </div>
                  </div>
                )}

                {paymentMode === 'Insurance' && (
                  <div className="p-4 bg-purple-50/60 rounded-xl border border-purple-200 space-y-2 text-xs">
                    <strong className="text-purple-900 block font-bold">ABHA &amp; TPA Cashless Pre-Auth</strong>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="TPA / Policy ID"
                        className="bg-white border border-purple-200 rounded px-2 py-1 text-xs"
                        defaultValue="STAR-HEALTH-9912"
                      />
                      <input
                        type="text"
                        placeholder="Pre-auth Approval No."
                        className="bg-white border border-purple-200 rounded px-2 py-1 text-xs"
                        defaultValue="APPR-88219"
                      />
                    </div>
                  </div>
                )}

                {collectError && (
                  <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{collectError}</p>
                )}

                {/* Confirm Pay Button */}
                {paymentMode === 'UPI' ? (
                  <div className="space-y-2">
                    <button
                      onClick={() => void startUpiCollect()}
                      disabled={collectBusy || Boolean(payLink)}
                      className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm shadow-emerald-200 transition-all cursor-pointer"
                    >
                      {collectBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      <span>{payLink ? 'Waiting for verified Razorpay webhook…' : `Create Razorpay pay link for ₹${totalAmount}`}</span>
                    </button>
                    {sandboxPay && payLink && (
                      <button
                        onClick={() => void simulateSandboxCapture()}
                        disabled={collectBusy}
                        className="w-full py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-[11px] border border-amber-300 cursor-pointer"
                      >
                        Simulate Razorpay webhook (SANDBOX / DEV-ONLY)
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => void collectDeskPayment()}
                    disabled={collectBusy}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm shadow-emerald-200 transition-all cursor-pointer"
                  >
                    {collectBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span>Record {paymentMode} collection of ₹{totalAmount}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Receipt Card */}
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-3 text-xs">
                  <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
                    <div className="flex items-center gap-1.5 text-emerald-800 font-bold">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      <span>Payment Completed &amp; Reconciled</span>
                    </div>
                    <span className="font-mono text-[11px] font-bold text-slate-600">{receiptNumber}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-500 block">Payment Mode:</span>
                      <strong className="text-slate-800">{paymentMode}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Amount Paid:</span>
                      <strong className="text-emerald-800 font-mono text-sm">₹{totalAmount}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">GST Exempt Healthcare:</span>
                      <strong className="text-slate-800">SAC 999312 / 999314</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Doctor Signature:</span>
                      <strong className="text-slate-800">{currentDoctor.name}</strong>
                    </div>
                  </div>
                </div>

                {/* WhatsApp Receipt Dispatch */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                      Patient WhatsApp E-Receipt
                    </span>
                    <span className="text-[11px] text-slate-500">{currentPatient.phone}</span>
                  </div>

                  {whatsAppReceiptSent ? (
                    <div className="bg-emerald-100 text-emerald-800 p-2 rounded-lg text-[11px] font-medium flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      GST E-Receipt {whatsAppReceiptSandbox ? 'recorded in SANDBOX / DEV-ONLY (not Graph)' : `sent to ${currentPatient.phone} via WhatsApp`}
                    </div>
                  ) : (
                    <button
                      onClick={async () => {
                        if (!persistedInvoice?.id) return;
                        setIsSendingWhatsAppReceipt(true);
                        try {
                          const res = await apiFetch<{
                            ok?: boolean;
                            sandbox?: boolean;
                            graphDelivered?: boolean;
                            channel?: string;
                          }>(`/api/invoices/${persistedInvoice.id}/receipt`, { method: 'POST' });
                          setWhatsAppReceiptSent(true);
                          setWhatsAppReceiptSandbox(Boolean(res.sandbox) || res.channel === 'sandbox');
                        } catch (err) {
                          console.error(err);
                          setWhatsAppReceiptSent(false);
                          setCollectError(err instanceof Error ? err.message : 'WhatsApp receipt failed');
                        } finally {
                          setIsSendingWhatsAppReceipt(false);
                        }
                      }}
                      disabled={isSendingWhatsAppReceipt}
                      className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                    >
                      {isSendingWhatsAppReceipt ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>Send E-Receipt via WhatsApp</span>
                    </button>
                  )}
                </div>

                {/* Receipt Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    onClick={() => window.print()}
                    className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print GST Receipt</span>
                  </button>

                  <button
                    onClick={() => setShowCollectPaymentModal(false)}
                    className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

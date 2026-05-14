import React, { useState } from 'react';

function ShieldIcon() {
  return (
    <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', inputMode, maxLength, prefix }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {label}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-slate-400 font-medium select-none">
            {prefix}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={inputMode}
          autoComplete="off"
          className={`w-full border border-slate-200 rounded-xl py-3 text-[15px] text-slate-900
                     placeholder:text-slate-300 focus:outline-none focus:border-[#4736FE]
                     focus:ring-2 focus:ring-[#4736FE]/15 transition bg-white shadow-sm
                     ${prefix ? 'pl-14 pr-4' : 'px-4'}`}
        />
      </div>
    </div>
  );
}

export default function AppointmentForm({ onLookupSuccess }) {
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [chassisNumber,      setChassisNumber]      = useState('');
  const [engineNumber,       setEngineNumber]       = useState('');
  const [mobileNumber,       setMobileNumber]       = useState('');
  const [appointmentId,      setAppointmentId]      = useState('');
  const [error,              setError]              = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!registrationNumber.trim()) return setError('Registration Number is required');
    if (!chassisNumber.trim())      return setError('Chassis Number is required');
    if (!engineNumber.trim())       return setError('Engine Number is required');
    if (!/^\d{10}$/.test(mobileNumber)) return setError('Enter a valid 10-digit mobile number');

    onLookupSuccess({
      appointmentId: appointmentId.trim(),
      mobileNumber:  mobileNumber.trim(),
      vehicle: {
        registrationNumber: registrationNumber.trim().toUpperCase(),
        chassisNumber:      chassisNumber.trim().toUpperCase(),
        engineNumber:       engineNumber.trim().toUpperCase(),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        label="Registration Number *"
        value={registrationNumber}
        onChange={e => { setRegistrationNumber(e.target.value.toUpperCase()); setError(''); }}
        placeholder="e.g. TS08HV6071"
      />
      <Field
        label="Chassis Number *"
        value={chassisNumber}
        onChange={e => { setChassisNumber(e.target.value.toUpperCase()); setError(''); }}
        placeholder="e.g. MA3ERLF1S00123456"
      />
      <Field
        label="Engine Number *"
        value={engineNumber}
        onChange={e => { setEngineNumber(e.target.value.toUpperCase()); setError(''); }}
        placeholder="e.g. G10BN1234567"
      />
      <Field
        label="Mobile Number *"
        value={mobileNumber}
        onChange={e => { setMobileNumber(e.target.value.replace(/\D/g, '').slice(0, 10)); setError(''); }}
        placeholder="10-digit number"
        type="tel"
        inputMode="numeric"
        maxLength={10}
        prefix="+91"
      />
      <Field
        label="Appointment ID (optional)"
        value={appointmentId}
        onChange={e => { setAppointmentId(e.target.value); setError(''); }}
        placeholder="Leave blank for testing"
      />

      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" />
          </svg>
          <p className="text-red-600 text-sm leading-relaxed">{error}</p>
        </div>
      )}

      <button
        type="submit"
        className="w-full text-white rounded-xl py-3.5 text-[15px] font-semibold tracking-tight
                   shadow-sm transition-all flex items-center justify-center gap-2 mt-1
                   hover:opacity-90 active:scale-[0.99]"
        style={{ backgroundColor: '#4736FE' }}
      >
        Start Challan Lookup
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </button>

      <div className="flex items-center justify-center gap-1.5 pt-1">
        <ShieldIcon />
        <p className="text-[12px] text-slate-400">Sensitive data is masked and never stored in plain text</p>
      </div>
    </form>
  );
}

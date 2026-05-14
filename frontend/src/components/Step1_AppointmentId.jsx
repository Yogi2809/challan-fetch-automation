import React, { useState } from 'react';
import { startJob } from '../api.js';

export default function Step1_AppointmentId({ onJobStarted }) {
  const [appointmentId, setAppointmentId] = useState('');
  const [mobileNumber, setMobileNumber]   = useState('');
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!appointmentId.trim()) return setError('Appointment ID is required');
    if (!/^\d{10}$/.test(mobileNumber)) return setError('Enter a valid 10-digit mobile number');
    setLoading(true);
    setError('');
    try {
      const { sessionId } = await startJob(appointmentId.trim(), mobileNumber.trim(), '');
      onJobStarted(sessionId);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-700 mb-4">Start Challan Lookup</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Appointment ID</label>
          <input
            type="text"
            value={appointmentId}
            onChange={e => setAppointmentId(e.target.value)}
            placeholder="e.g. APT-123456"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Mobile Number</label>
          <input
            type="tel"
            value={mobileNumber}
            onChange={e => setMobileNumber(e.target.value)}
            placeholder="10-digit mobile"
            maxLength={10}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg py-2 text-sm font-medium transition"
        >
          {loading ? 'Starting…' : 'Start Automation'}
        </button>
      </form>
    </div>
  );
}

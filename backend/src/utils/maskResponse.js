import { maskRegNoForUI, maskChassisForUI, maskEngineForUI } from './vehicleMasking.js';

export function maskVehicle(v) {
  if (!v) return v;
  return {
    ...v,
    registrationNumber: maskRegNoForUI(v.registrationNumber),
    chassisNumber:      maskChassisForUI(v.chassisNumber),
    engineNumber:       maskEngineForUI(v.engineNumber),
    // mobileNumber intentionally not masked — user preference
  };
}

export function maskJobRecord(job) {
  if (!job) return job;
  const obj = typeof job.toObject === 'function' ? job.toObject() : { ...job };
  return {
    ...obj,
    appointmentId: maskAppointmentId(obj.appointmentId),
    // mobileNumber intentionally not masked — user preference
  };
}

// 10045712987 → 100XXXXX987
function maskAppointmentId(val) {
  if (!val) return val;
  if (val.length < 6) return 'X'.repeat(val.length);
  return val.slice(0, 3) + 'X'.repeat(val.length - 6) + val.slice(-3);
}

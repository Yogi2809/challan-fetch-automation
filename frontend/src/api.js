import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Authorization': `Bearer ${import.meta.env.VITE_API_TOKEN}`,
  },
});

export const lookupAppointment = (appointmentId) =>
  api.get(`/job/appointment/${appointmentId}`).then(r => r.data);

export const getScrapers = () =>
  api.get('/job/scrapers').then(r => r.data);

export const startScraper = (appointmentId, mobileNumber, scraperId, createdBy = '', vehicle = {}) =>
  api.post('/job/start', { appointmentId, mobileNumber, scraperId, createdBy, ...vehicle }).then(r => r.data);

export const submitJob = (sessionId) =>
  api.post(`/job/${sessionId}/submit`).then(r => r.data);

export const submitOtp = (sessionId, otp) =>
  api.post(`/job/${sessionId}/otp`, { otp }).then(r => r.data);

export const resendOtp = (sessionId) =>
  api.post(`/job/${sessionId}/resend-otp`).then(r => r.data);

export const submitCaptcha = (sessionId, captchaText) =>
  api.post(`/job/${sessionId}/captcha`, { captchaText }).then(r => r.data);

export const getJobStatus = (sessionId) =>
  api.get(`/job/${sessionId}`).then(r => r.data);

export const reassignJob = (sessionId, newCreatedBy) =>
  api.post(`/job/${sessionId}/reassign`, { newCreatedBy }).then(r => r.data);

export const markManual = (sessionId) =>
  api.post(`/job/${sessionId}/manual`).then(r => r.data);

export const clearQueue = () =>
  api.post('/admin/queue/clear').then(r => r.data);

import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { config } from '../config.js';

const http = axios.create({
  baseURL: config.challanServiceBaseUrl,
  headers: { 'x-api-key': config.challanServiceApiKey },
  timeout: 30000,
});

export async function postChallan(row, proofPath) {
  const form = new FormData();
  form.append('appointmentId',  row.appointmentId);
  form.append('challanName',    row.challanName);
  form.append('challanType',    row.challanType);
  form.append('noticeNumber',   row.noticeNumber);
  form.append('amount',         String(row.amount));
  form.append('createdBy',      row.createdBy);
  form.append('offenceDate',    row.offenceDate);
  form.append('challanCourt',   row.challanCourt);
  // Always use a fixed filename with .jpg extension — never derive from
  // noticeNumber (which may be empty/undefined and would produce a bare ".")
  form.append('challanProof', createReadStream(proofPath), {
    filename:    'challan-proof.jpg',
    contentType: 'image/jpeg',
  });

  const { data } = await http.post('/api/customer-challan/create', form, {
    headers: form.getHeaders(),
  });
  return data;
}

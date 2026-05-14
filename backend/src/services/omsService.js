import axios from 'axios';
import { config } from '../config.js';

const http = axios.create({
  baseURL: config.omsBaseUrl,
  headers: { 'x-api-key': config.omsApiKey },
  timeout: 15000,
});

export async function getVehicleDetails(appointmentId) {
  const { data } = await http.get(`/api/order/${appointmentId}`);
  return {
    registrationNumber: data.registrationNumber ?? data.vehicleNumber   ?? data.reg_number     ?? '',
    chassisNumber:      data.chassisNumber      ?? data.chassis_number  ?? '',
    engineNumber:       data.engineNumber       ?? data.engine_number   ?? '',
  };
}

export async function getExistingChallans(appointmentId) {
  const { data } = await http.get(`/api/order/challan/detail/${appointmentId}`);
  return Array.isArray(data) ? data : (data.data ?? []);
}

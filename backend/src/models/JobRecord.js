import mongoose from 'mongoose';

const challanRowSchema = new mongoose.Schema({
  noticeNo:        { type: String, required: true },
  vehicleNumber:   String,
  offenceDate:     String,
  offenceDetail:   String,
  offenceLocation: String,
  penaltyAmount:   String,
  status:          String,
  challanType:     { type: String, enum: ['ONLINE', 'OFFLINE'] },
  challanCourt:    String,
  postedToService: { type: Boolean, default: false },
  postError:       String,
}, { _id: false });

const jobRecordSchema = new mongoose.Schema({
  sessionId:          { type: String, required: true, unique: true, index: true },
  appointmentId:      { type: String, default: '' },
  registrationNumber: String,
  chassisNumber:      String,
  engineNumber:       String,
  mobileNumber:       String,
  createdBy:          String,
  scraperId:   String,   // e.g. 'delhi', 'surat'
  status: {
    type: String,
    enum: ['queued','running','otp_pending','captcha_pending','scraping','posting',
           'done','submitting','submitted','failed','manual'],
    default: 'queued',
  },
  progress:    { type: Number, default: 0 },
  otpSite:     String,   // which scraper is currently waiting for OTP
  logs:        [{ ts: Date, msg: String }],
  challanRows: [challanRowSchema],
  error:       String,
  retryCount:  { type: Number, default: 0 },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
});

jobRecordSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export const JobRecord = mongoose.model('JobRecord', jobRecordSchema);

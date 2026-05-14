import 'dotenv/config';

export const config = {
  port:                  parseInt(process.env.PORT || '3001'),
  nodeEnv:               process.env.NODE_ENV || 'test',
  redisUrl:              process.env.REDIS_URL || 'redis://localhost:6379',
  mongoUri:              process.env.MONGODB_URI || 'mongodb://localhost:27017/challan-test',

  omsBaseUrl:            process.env.OMS_BASE_URL || 'https://oms-purchase-stage.qac24svc.dev',
  omsApiKey:             process.env.OMS_API_KEY || '',

  challanServiceBaseUrl: process.env.CHALLAN_SERVICE_BASE_URL || 'https://challan-service-stage.qac24svc.dev',
  challanServiceApiKey:  process.env.CHALLAN_SERVICE_API_KEY || '',

  storageMode:           process.env.STORAGE_MODE || 'local',
  localUploadDir:        process.env.LOCAL_UPLOAD_DIR || './uploads',
  awsBucket:             process.env.AWS_BUCKET || '',
  awsRegion:             process.env.AWS_REGION || 'ap-south-1',

  workerConcurrency:     parseInt(process.env.WORKER_CONCURRENCY || '2'),
  otpTimeoutMs:          parseInt(process.env.OTP_TIMEOUT_MS || '600000'),
  playwrightHeadless:    process.env.PLAYWRIGHT_HEADLESS !== 'false',

  slackWebhookUrl:       process.env.SLACK_WEBHOOK_URL || '',

  uiApiToken:            process.env.UI_API_TOKEN || '',

  // Path to the offence→amount Excel lookup sheet (relative to backend/ working dir, or absolute)
  offenceXlsxPath:       process.env.OFFENCE_XLSX_PATH || './data/offences.xlsx',

  // CAPTCHA auto-solver
  captchaWebhookUrl:    process.env.CAPTCHA_WEBHOOK_URL || '',
  captchaWebhookToken:  process.env.CAPTCHA_WEBHOOK_TOKEN || '',
  captchaWebhookTeamId: process.env.CAPTCHA_WEBHOOK_TEAM_ID || '',
  captchaS3Bucket:      process.env.CAPTCHA_S3_BUCKET || '',
  awsProfile:           process.env.AWS_PROFILE || 'Cars24NonprodYogeshMishra',
};

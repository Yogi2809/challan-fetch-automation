import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromSSO } from '@aws-sdk/credential-providers';

export class SsoExpiredError extends Error {
  constructor(cause) {
    super('AWS SSO session expired. Run: aws sso login --profile Cars24NonprodYogeshMishra');
    this.name = 'SsoExpiredError';
    this.cause = cause;
  }
}

function isSsoError(err) {
  const msg = (err?.message || '') + (err?.name || '');
  return /sso|token.*(expir|invalid)|expir.*token|credential.*provider|could not load credential|profile.*not.*found|not authorized to assume/i.test(msg);
}

let _s3;
function getS3Client() {
  if (!_s3) {
    const credentials = process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
        }
      : fromSSO({ profile: process.env.AWS_PROFILE || 'Cars24NonprodYogeshMishra' });

    _s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1', credentials });
  }
  return _s3;
}

export function resetS3Client() { _s3 = null; }

/**
 * Upload CAPTCHA image to S3, call the solver webhook, return the solved text.
 * Cleans up the S3 object after a successful solve.
 *
 * @param {Buffer} imageBuffer - raw screenshot of the CAPTCHA element
 * @param {string} sessionId
 * @returns {Promise<string>} solved CAPTCHA text (e.g. "bmanm")
 */
export async function solveCaptchaWithAI(imageBuffer, sessionId) {
  const bucket = process.env.CAPTCHA_S3_BUCKET;
  const key    = `captcha/${sessionId}/${Date.now()}.jpg`;
  const s3     = getS3Client();

  // Upload — rethrow credential errors as SsoExpiredError so callers can show a clear alert
  try {
    await s3.send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        imageBuffer,
      ContentType: 'image/jpeg',
    }));
  } catch (err) {
    if (isSsoError(err)) throw new SsoExpiredError(err);
    throw err;
  }

  // Pre-signed GET URL (5 min TTL)
  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 300 }
  );

  // Call solver webhook
  const res = await fetch(process.env.CAPTCHA_WEBHOOK_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.CAPTCHA_WEBHOOK_TOKEN}`,
      'team-id':       process.env.CAPTCHA_WEBHOOK_TEAM_ID,
    },
    body: JSON.stringify({ input_data: { url: presignedUrl } }),
  });

  // Clean up S3 regardless of webhook outcome
  s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});

  if (!res.ok) {
    throw new Error(`CAPTCHA webhook returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const results = data?.final_output?.results;
  if (!results || typeof results !== 'object') {
    throw new Error('CAPTCHA webhook response missing final_output.results');
  }

  const firstKey = Object.keys(results)[0];
  const value    = results[firstKey]?.value;
  if (!value) {
    throw new Error(`CAPTCHA webhook response missing value (key: ${firstKey})`);
  }

  return String(value).trim();
}

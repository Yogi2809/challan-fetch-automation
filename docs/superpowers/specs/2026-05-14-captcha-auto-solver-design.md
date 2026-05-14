# CAPTCHA Auto-Solver Design

**Date:** 2026-05-14  
**Status:** Approved  

## Problem

Three scrapers (MP, Jharkhand, Telangana) currently block on human CAPTCHA input. An operator must read the image and type the value manually. This slows automation and requires human availability.

## Solution

Replace human input with an automated pipeline:
1. Screenshot the CAPTCHA image
2. Upload to S3 → generate a 5-minute pre-signed URL
3. POST the URL to a CAPTCHA-solver webhook
4. Read the `value` field from the response
5. Fill and submit automatically

Human fallback is preserved: if auto-solve fails 3 times in a row, the scraper falls back to showing the image in the UI and waiting for manual input exactly as it does today.

---

## Architecture

### New file: `backend/src/utils/captchaSolver.js`

Single responsibility: given an image buffer and a session key, return the CAPTCHA text string.

Steps inside:
1. Create S3 client using `fromSSO({ profile: 'Cars24NonprodYogeshMishra' })` — credentials auto-refresh, no manual rotation needed
2. Upload buffer to bucket `challan-fetch-automation` at key `captcha/{sessionId}/{timestamp}.jpg`
3. Generate pre-signed GET URL (TTL: 300 seconds / 5 minutes)
4. POST to webhook:
   ```
   POST https://weave.c24.tech/api/v1/execution/6a056713e8b0856341dbd9b1/run
   Authorization: Bearer exec_v89wR7jVRDZZqyReKx7aWN3xua-5zbjXmEXpJpwA5VE
   team-id: 699eecf287ded3d03095969f
   { "input_data": { "url": "<presignedUrl>" } }
   ```
5. Parse response: `output.results[Object.keys(results)[0]].value`
6. Return the value string (e.g. `"bmanm"`)
7. Clean up: delete the S3 object after getting the value (no residual data)

### Modified: `backend/src/worker/steps/solveCaptcha.js`

New exported function `solveCaptchaAuto(page, sessionId, captchaSelectors, onCaptchaRequired, emitStatus)`:

```
attempt = 0
loop:
  attempt++
  screenshot CAPTCHA element → buffer
  call captchaSolver(buffer, sessionId) → value
  fill captcha input with value
  submit form
  wait for result (found / wrong / no_challans)

  if found or no_challans → return result
  if wrong and attempt < 3 → continue loop (new screenshot each time)
  if wrong and attempt >= 3 → break, fall back to human flow
```

Human fallback = existing `solveCaptcha()` function, called unchanged.

The function accepts a `captchaSelectors` object so each scraper can pass its own selectors — keeping scraper-specific logic in the scrapers, not in this shared step.

### Scrapers touched

| Scraper | Change |
|---|---|
| `mp/index.js` | Replace `solveCaptcha()` call with `solveCaptchaAuto()`, passing MP selectors |
| `jharkhand/index.js` | Same — pass Jharkhand selectors |
| `telangana/index.js` | Same — pass Telangana selectors |

No changes to scraper result-parsing logic.

---

## Credential Rotation

Uses `fromSSO({ profile: 'Cars24NonprodYogeshMishra' })` from `@aws-sdk/credential-providers`.

- AWS CLI SSO is configured on the dev machine
- The SDK reads from `~/.aws/sso/cache` and silently refreshes the 6-hour IAM credentials using the cached SSO token
- No env var updates, no restarts, no manual steps during normal operation
- When the SSO session itself expires (typically 8–24h), run: `aws sso login --profile Cars24NonprodYogeshMishra` — takes 10 seconds

---

## New Environment Variables (`.env`)

```
CAPTCHA_WEBHOOK_URL=https://weave.c24.tech/api/v1/execution/6a056713e8b0856341dbd9b1/run
CAPTCHA_WEBHOOK_TOKEN=exec_v89wR7jVRDZZqyReKx7aWN3xua-5zbjXmEXpJpwA5VE
CAPTCHA_WEBHOOK_TEAM_ID=699eecf287ded3d03095969f
CAPTCHA_S3_BUCKET=challan-fetch-automation
AWS_PROFILE=Cars24NonprodYogeshMishra
AWS_REGION=ap-south-1
```

---

## New npm Packages

```
@aws-sdk/client-s3
@aws-sdk/s3-request-presigner
@aws-sdk/credential-providers
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| S3 upload fails | Throw — caught by auto-solve loop, counts as a failed attempt |
| Webhook returns non-2xx | Throw — counts as a failed attempt |
| `value` field missing in response | Throw — counts as a failed attempt |
| `confidence` below threshold | Still use the value — site will tell us if it's wrong |
| 3 consecutive failures | Fall back to human UI (existing flow) |
| SSO token expired | `aws sso login` needed — S3 upload will throw with an auth error visible in logs |

---

## Flow Diagram

```
[Playwright] screenshot CAPTCHA
      ↓
[captchaSolver] upload → S3 pre-signed URL
      ↓
[captchaSolver] POST webhook → { value }
      ↓
[Playwright] fill + submit
      ↓
  ┌── wrong? → attempt++ → if ≤ 3: retry from screenshot
  └── right / no_challans → continue scraping
        ↓ (attempt 4 — exhausted)
  [human fallback] show image in UI, wait for operator input
```

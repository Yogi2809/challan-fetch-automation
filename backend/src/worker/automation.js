import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import { getVehicleDetails } from '../services/omsService.js';
import { registerWorker, terminateSession, otpResolvers } from '../utils/sessionStore.js';
// captchaResolvers used by solveCaptcha.js — imported there directly via sessionStore
import { safeFind as safeFindFn } from './safeFind.js';
import { getScraperById } from './scrapers/registry.js';
import { JobRecord } from '../models/JobRecord.js';
import { config } from '../config.js';
import { getNextProxy, hasProxies, proxyCount } from '../utils/proxyRotator.js';
import { WafBlockError } from './scrapers/gujaratPoliceBase.js';

export const IMAGE_DIR = '/tmp/challan-proofs';

/** Persist imageBuffer to disk so the /submit endpoint can read it later.
 *  Always writes as .jpg so the extension is consistent through the whole pipeline. */
function saveImage(sessionId, noticeNo, buffer) {
  try {
    if (!existsSync(IMAGE_DIR)) mkdirSync(IMAGE_DIR, { recursive: true });
    if (buffer) writeFileSync(path.join(IMAGE_DIR, `${sessionId}-${noticeNo}.jpg`), buffer);
  } catch (_) {}
}

export async function runAutomation(job, io) {
  const { sessionId, appointmentId, mobileNumber, createdBy, scraperId } = job.data;

  function emitStatus(msg) {
    io.to(sessionId).emit('status', { msg });
    console.log(`[${sessionId}] ${msg}`);
    JobRecord.findOneAndUpdate(
      { sessionId },
      { $push: { logs: { ts: new Date(), msg } } }
    ).catch(() => {});
  }

  function emitProgress(pct) {
    io.to(sessionId).emit('progress', { percent: pct });
  }

  let browser;
  try {
    registerWorker(sessionId, async () => {
      if (browser) await browser.close().catch(() => {});
    });

    // ── Resolve scraper ───────────────────────────────────────────
    const scraper = getScraperById(scraperId);
    if (!scraper) throw new Error(`Unknown scraper id: "${scraperId}"`);

    await JobRecord.findOneAndUpdate({ sessionId }, { status: 'running', progress: 5 });
    emitProgress(5);

    let registrationNumber, chassisNumber, engineNumber;
    if (job.data.registrationNumber) {
      ({ registrationNumber, chassisNumber, engineNumber } = job.data);
      emitStatus(`[${scraper.label}] Job started — using manually entered vehicle details…`);
    } else if (appointmentId) {
      emitStatus(`[${scraper.label}] Job started — fetching vehicle details…`);
      const vehicle = await getVehicleDetails(appointmentId);
      ({ registrationNumber, chassisNumber, engineNumber } = vehicle);
    } else {
      throw new Error('No vehicle details provided. Please enter Registration No, Chassis No, and Engine No manually.');
    }
    const chassisLast4 = chassisNumber.slice(-4);
    const engineLast4  = engineNumber.slice(-4);

    await JobRecord.findOneAndUpdate({ sessionId }, {
      registrationNumber, chassisNumber, engineNumber, status: 'running', progress: 15,
    });
    emitStatus(`Vehicle: ${registrationNumber} — opening ${scraper.label}…`);
    emitProgress(15);

    const safeFind = (p, sel, opts) => safeFindFn(p, sel, { sessionId, ...opts });

    const onOtpRequired = async (site) => {
      await JobRecord.findOneAndUpdate(
        { sessionId },
        { status: 'otp_pending', progress: 40, otpSite: site || scraper.label },
      );
      io.to(sessionId).emit('otp_required', { sessionId, site: site || scraper.label });
    };

    const onCaptchaRequired = async (captchaBase64) => {
      await JobRecord.findOneAndUpdate({ sessionId }, { status: 'captcha_pending' });
      io.to(sessionId).emit('captcha_required', { sessionId, image: captchaBase64 });
    };

    // ── Launch browser + run scraper (with proxy-rotation on WAF block) ───
    async function launchAndRun(proxyServer) {
      if (browser) await browser.close().catch(() => {});
      browser = await chromium.launch({
        headless: config.playwrightHeadless,
        ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
      });
      const ctx  = await browser.newContext();
      const page = await ctx.newPage();
      return scraper.run(
        page,
        { registrationNumber, mobileNumber, chassisLast4, engineLast4,
          chassisNumber, engineNumber, sessionId, otpResolvers },
        { safeFind, emitStatus, emitProgress, onOtpRequired, onCaptchaRequired },
      );
    }

    let scrapedRows;
    try {
      scrapedRows = await launchAndRun(null);
    } catch (err) {
      if (!(err instanceof WafBlockError)) throw err;

      // ── Proxy rotation: try each proxy until one works or all exhausted ──
      if (!hasProxies()) {
        emitStatus(`[Proxy] No proxies configured (PROXY_LIST env var). Skipping ${scraper.label}.`);
        scrapedRows = [];
      } else {
        let succeeded = false;
        for (let attempt = 0; attempt < proxyCount(); attempt++) {
          const proxy = getNextProxy();
          emitStatus(`[Proxy] Attempt ${attempt + 1}/${proxyCount()} via ${proxy.replace(/:[^:@]+@/, ':***@')}…`);
          try {
            scrapedRows = await launchAndRun(proxy);
            succeeded = true;
            break;
          } catch (proxyErr) {
            if (proxyErr instanceof WafBlockError) {
              emitStatus(`[Proxy] Still blocked on attempt ${attempt + 1} — trying next…`);
            } else {
              throw proxyErr;
            }
          }
        }
        if (!succeeded) {
          emitStatus(`[Proxy] All ${proxyCount()} proxies exhausted — ${scraper.label} is blocking all IPs. Skipping.`);
          scrapedRows = [];
        }
      }
    }

    emitStatus(`Scraped ${scrapedRows.length} challan(s) from ${scraper.label}.`);
    emitProgress(90);

    // ── Persist images to disk so /submit can use them later ──────
    for (const row of scrapedRows) {
      saveImage(sessionId, row.noticeNo, row.imageBuffer);
    }

    // ── Save to DB (no imageBuffer — too large for BSON) ──────────
    await JobRecord.findOneAndUpdate({ sessionId }, {
      status: 'done',
      progress: 100,
      challanRows: scrapedRows.map(r => ({
        noticeNo:        r.noticeNo,
        vehicleNumber:   r.vehicleNumber,
        offenceDate:     r.offenceDate,
        offenceDetail:   r.offenceDetail,
        offenceLocation: r.offenceLocation,
        penaltyAmount:   r.penaltyAmount,
        status:          r.status,
        challanType:     r.challanType,
        challanCourt:    r.challanCourt || scraper.CHALLAN_COURT,
      })),
    });

    emitStatus('Scraping complete ✓');
    emitProgress(100);
    io.to(sessionId).emit('done', { scrapedRows });

  } catch (err) {
    console.error(`[Automation][${scraperId}] sessionId=${sessionId} error:`, err);
    emitStatus(`Error: ${err.message}`);
    await JobRecord.findOneAndUpdate({ sessionId }, {
      status: 'failed', error: err.message,
    }).catch(() => {});
    io.to(sessionId).emit('error', { message: err.message });
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    terminateSession(sessionId);
  }
}

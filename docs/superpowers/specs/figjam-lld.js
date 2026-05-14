// ============================================================
// CHALLAN FETCH AUTOMATION — LLD DIAGRAM
// Run in FigJam: Plugins → Development → Open Console → paste & run
// ============================================================

async function createLLD() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  const page = figma.currentPage;

  const lldSection = page.children.find(
    n => n.type === 'SECTION' && n.name.toUpperCase() === 'LLD'
  );
  if (!lldSection) { console.error('LLD section not found'); return; }

  const SX = lldSection.x + 80;
  const SY = lldSection.y + 120;

  // ── Colour palette ──────────────────────────────────────
  const C = {
    step:     { fill: { r: 0.38, g: 0.55, b: 1.0  }, stroke: { r: 0.20, g: 0.35, b: 0.85 } },
    decision: { fill: { r: 1.0,  g: 0.75, b: 0.10 }, stroke: { r: 0.78, g: 0.50, b: 0.0  } },
    success:  { fill: { r: 0.18, g: 0.72, b: 0.46 }, stroke: { r: 0.08, g: 0.52, b: 0.28 } },
    error:    { fill: { r: 0.95, g: 0.28, b: 0.28 }, stroke: { r: 0.75, g: 0.10, b: 0.10 } },
    external: { fill: { r: 0.95, g: 0.45, b: 0.45 }, stroke: { r: 0.72, g: 0.18, b: 0.18 } },
    worker:   { fill: { r: 0.58, g: 0.35, b: 0.90 }, stroke: { r: 0.38, g: 0.18, b: 0.72 } },
    storage:  { fill: { r: 0.25, g: 0.78, b: 0.95 }, stroke: { r: 0.08, g: 0.58, b: 0.78 } },
    manual:   { fill: { r: 0.55, g: 0.55, b: 0.58 }, stroke: { r: 0.35, g: 0.35, b: 0.40 } },
    note:     { yellow: { r: 1.0, g: 0.96, b: 0.60 }, blue: { r: 0.85, g: 0.95, b: 1.0 }, pink: { r: 1.0, g: 0.88, b: 0.88 }, purple: { r: 0.92, g: 0.87, b: 1.0 } },
  };

  // ── Helper: box with label ───────────────────────────────
  function box(x, y, w, h, label, sub, color, radius = 10) {
    const r = figma.createRectangle();
    r.x = SX + x; r.y = SY + y;
    r.resize(w, h);
    r.cornerRadius = radius;
    r.fills = [{ type: 'SOLID', color: color.fill, opacity: 0.18 }];
    r.strokes = [{ type: 'SOLID', color: color.stroke }];
    r.strokeWeight = 2;

    const t = figma.createText();
    t.fontName = { family: "Inter", style: "Bold" };
    t.fontSize = 13;
    t.fills = [{ type: 'SOLID', color: color.stroke }];
    t.characters = label;
    t.x = SX + x + w / 2 - t.width / 2;
    t.y = SY + y + (sub ? h / 2 - 16 : h / 2 - 8);

    const nodes = [r, t];
    if (sub) {
      const s = figma.createText();
      s.fontName = { family: "Inter", style: "Regular" };
      s.fontSize = 10;
      s.fills = [{ type: 'SOLID', color: color.stroke, opacity: 0.75 }];
      s.characters = sub;
      s.x = SX + x + w / 2 - s.width / 2;
      s.y = SY + y + h / 2 + 4;
      nodes.push(s);
    }
    figma.group(nodes, page);
    return r;
  }

  // ── Helper: diamond decision box ────────────────────────
  function diamond(x, y, size, label) {
    const d = figma.createPolygon();
    d.x = SX + x; d.y = SY + y;
    d.resize(size, size);
    d.fills = [{ type: 'SOLID', color: C.decision.fill, opacity: 0.20 }];
    d.strokes = [{ type: 'SOLID', color: C.decision.stroke }];
    d.strokeWeight = 2;
    d.pointCount = 4;
    d.rotation = 45;

    const t = figma.createText();
    t.fontName = { family: "Inter", style: "Bold" };
    t.fontSize = 11;
    t.fills = [{ type: 'SOLID', color: C.decision.stroke }];
    t.characters = label;
    t.x = SX + x + size / 2 - t.width / 2;
    t.y = SY + y + size / 2 - 8;
    figma.group([d, t], page);
    return d;
  }

  // ── Helper: arrow connector ──────────────────────────────
  function arrow(fromNode, toNode, label = '', color = { r: 0.45, g: 0.45, b: 0.45 }) {
    const c = figma.createConnector();
    c.connectorStart = { endpointNodeId: fromNode.id, magnet: 'AUTO' };
    c.connectorEnd   = { endpointNodeId: toNode.id,   magnet: 'AUTO' };
    c.strokeWeight = 2;
    c.strokes = [{ type: 'SOLID', color }];
    c.connectorEndStrokeCap = 'ARROW_FILLED';
    if (label) {
      const lbl = figma.createText();
      lbl.fontName = { family: "Inter", style: "Regular" };
      lbl.fontSize = 10;
      lbl.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.3, b: 0.3 } }];
      lbl.characters = label;
      lbl.x = (fromNode.x + fromNode.width / 2 + toNode.x + toNode.width / 2) / 2 - 30;
      lbl.y = (fromNode.y + fromNode.height / 2 + toNode.y + toNode.height / 2) / 2 - 16;
    }
    return c;
  }

  // ── Helper: text label ───────────────────────────────────
  function label(x, y, text, size = 12, bold = false, color = { r: 0.25, g: 0.25, b: 0.25 }) {
    const t = figma.createText();
    t.fontName = { family: "Inter", style: bold ? "Bold" : "Regular" };
    t.fontSize = size;
    t.fills = [{ type: 'SOLID', color }];
    t.characters = text;
    t.x = SX + x; t.y = SY + y;
    return t;
  }

  // ── Helper: sticky note ──────────────────────────────────
  function note(x, y, text, color) {
    const s = figma.createSticky();
    s.x = SX + x; s.y = SY + y;
    s.text.characters = text;
    s.fills = [{ type: 'SOLID', color }];
    return s;
  }

  // ── Helper: swimlane background ──────────────────────────
  function swimlane(x, y, w, h, title, color) {
    const bg = figma.createRectangle();
    bg.x = SX + x; bg.y = SY + y;
    bg.resize(w, h);
    bg.cornerRadius = 16;
    bg.fills = [{ type: 'SOLID', color, opacity: 0.06 }];
    bg.strokes = [{ type: 'SOLID', color, opacity: 0.25 }];
    bg.strokeWeight = 1.5;
    bg.strokeDashPattern = [6, 4];

    const t = figma.createText();
    t.fontName = { family: "Inter", style: "Semi Bold" };
    t.fontSize = 12;
    t.fills = [{ type: 'SOLID', color, opacity: 0.7 }];
    t.characters = title;
    t.x = SX + x + 16; t.y = SY + y + 12;
    figma.group([bg, t], page);
  }

  // ════════════════════════════════════════════════════════
  // TITLE
  // ════════════════════════════════════════════════════════
  const ttl = figma.createText();
  ttl.fontName = { family: "Inter", style: "Bold" };
  ttl.fontSize = 28;
  ttl.characters = "Challan Fetch Automation — Low Level Design (Phase 1)";
  ttl.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
  ttl.x = SX; ttl.y = SY - 72;

  const sub = figma.createText();
  sub.fontName = { family: "Inter", style: "Regular" };
  sub.fontSize = 14;
  sub.characters = "Detailed step-by-step automation flow  |  Error handling  |  Retry logic  |  Deduplication";
  sub.fills = [{ type: 'SOLID', color: { r: 0.45, g: 0.45, b: 0.45 } }];
  sub.x = SX; sub.y = SY - 38;

  // ════════════════════════════════════════════════════════
  // COLUMN LAYOUT
  // Col A: QC Actions (x=0)
  // Col B: System Processing (x=280)
  // Col C: Playwright Steps (x=580)
  // Col D: External / Branches (x=920)
  // ════════════════════════════════════════════════════════

  // ── Swimlane backgrounds ──────────────────────────────
  swimlane(-20,  -10, 230, 2560, "👤 QC Actions",           { r: 0.38, g: 0.55, b: 1.0 });
  swimlane(260,  -10, 280, 2560, "⚙️ Backend + Queue",       { r: 0.18, g: 0.72, b: 0.46 });
  swimlane(560,  -10, 340, 2560, "🤖 Playwright Automation", { r: 0.58, g: 0.35, b: 0.90 });
  swimlane(920,  -10, 320, 2560, "🌐 External / Branches",   { r: 0.95, g: 0.32, b: 0.32 });

  // ════════════════════════════════════════════════════════
  // STEP 1 — QC Enters AppointmentId
  // ════════════════════════════════════════════════════════
  label(-10, 0, "STEP 1", 11, true, { r: 0.38, g: 0.55, b: 1.0 });

  const s1_input = box(0, 20, 190, 70, "Enter appointmentId", "QC types in Stepper UI", C.step);
  const s1_post  = box(280, 20, 240, 70, "POST /api/job/start", "Backend receives request", C.step);
  const s1_get   = box(600, 20, 300, 70, "GET Admin Panel API", "Fetch unmasked vehicle details\nReg / Chassis / Engine numbers", C.external);

  arrow(s1_input, s1_post, "Step 1 submit");
  arrow(s1_post,  s1_get,  "Fetch vehicle details");

  const s1_resp = box(280, 120, 240, 60, "Return sessionId + vehicle", "UUID created, WS channel opened", C.success);
  arrow(s1_get,  s1_resp,  "Returns reg, chassis, engine");

  note(940, 10,
    "📦 Vehicle Details from API\n────────────────\nregistrationNumber: DL3CCL7796\nchassisNumber: MALC181CLHM222502\nengineLast4: 2502\nengineLast4: 2698",
    C.note.yellow
  );

  // ════════════════════════════════════════════════════════
  // STEP 2 — QC Enters Mobile Number
  // ════════════════════════════════════════════════════════
  label(-10, 210, "STEP 2", 11, true, { r: 0.38, g: 0.55, b: 1.0 });

  const s2_input  = box(0, 230, 190, 70, "Enter Mobile Number", "User's mobile (vehicle owner)", C.step);
  const s2_post   = box(280, 230, 240, 70, "POST /api/job/:id/mobile", "Job enqueued → BullMQ + Redis", C.step);
  const s2_worker = box(600, 230, 300, 70, "Worker Picks Up Job", "Playwright opens fresh browser\nFresh session = first visit", C.worker);

  arrow(s2_input,  s2_post,   "Mobile number submitted");
  arrow(s2_post,   s2_worker, "Queue delivers job");

  note(940, 220,
    "🗄 MongoDB Entry Created\n────────────────\nstatus: in_progress\nsessionId: uuid-v4\nassignedTo: qc@company.com\nvehicleDetails: {...}",
    C.note.blue
  );

  // ════════════════════════════════════════════════════════
  // STEP 3 — Open Delhi Police Website
  // ════════════════════════════════════════════════════════
  label(-10, 330, "STEP 3", 11, true, { r: 0.58, g: 0.35, b: 0.90 });

  const s3_open  = box(600, 350, 300, 70, "Open Delhi Police Website", "traffic.delhipolice.gov.in\n/notice/pay-notice", C.external);
  const s3_enter = box(600, 450, 300, 70, "Enter registrationNumber", "Uses unmasked reg# from API\nPress Search Details", C.worker);

  arrow(s2_worker, s3_open,  "Playwright navigates");
  arrow(s3_open,   s3_enter, "Page loaded");

  // ════════════════════════════════════════════════════════
  // STEP 4 — Mobile Change (ALWAYS)
  // ════════════════════════════════════════════════════════
  label(-10, 540, "STEP 4", 11, true, { r: 0.58, g: 0.35, b: 0.90 });

  const s4_change = box(600, 560, 300, 80, "Change Mobile Number", "ALWAYS on fresh session\nEnter new mobile + chassis last4\n+ engine last4 → Submit", C.worker);
  arrow(s3_enter, s4_change, "ALWAYS execute\n(fresh session = first visit)");

  // Decision: success or fail?
  const s4_dec = box(600, 670, 300, 60, "Mobile Change Success?", "", C.decision);
  arrow(s4_change, s4_dec, "");

  // Success path
  const s4_ok = box(600, 760, 300, 60, "✅ Verified", "Last 4 digits confirmed", C.success);
  arrow(s4_dec, s4_ok, "YES");

  // Fail path → retry
  const s4_retry = box(940, 670, 260, 60, "Retry (max 3×)", "Backoff: 2s → 4s → 8s", C.error);
  arrow(s4_dec, s4_retry, "NO (fail)");

  // All retries exhausted
  const s4_fail = box(940, 760, 260, 80, "❌ All 3 Attempts Failed", "Emit MANUAL_INTERVENTION\nJob status → FAILED", C.error);
  arrow(s4_retry, s4_fail, "After 3 failures");

  // QC sees error UI
  const s4_ui_err = box(0, 760, 190, 80, "⚠️ Error Screen", "QC sees message:\n'Automation failed.\nCheck manually.'", C.error);
  arrow(s4_fail, s4_ui_err, "WS event → error");

  // Try again / Manual buttons
  const s4_tryagain = box(0, 870, 88, 60, "Try Again", "Re-queue job", C.step);
  const s4_manual   = box(100, 870, 88, 60, "Mark Manual", "Job closed", C.manual);
  arrow(s4_ui_err, s4_tryagain, "");
  arrow(s4_ui_err, s4_manual, "");

  note(940, 860,
    "🔄 Reassignment Handling\n────────────────\nIf job reassigned mid-run:\n• Detect new MongoDB entry\n• Kill active Playwright session\n• Emit 'reassigned' to QC-A\n• QC-B starts fresh from Step 1",
    C.note.pink
  );

  // ════════════════════════════════════════════════════════
  // STEP 5 — OTP
  // ════════════════════════════════════════════════════════
  label(-10, 870, "STEP 5", 11, true, { r: 0.38, g: 0.55, b: 1.0 });

  const s5_wait   = box(600, 880, 300, 70, "⏳ waitForOTP()", "Playwright pauses here\nEmits: 'otp_needed' via WS\nTimeout: 10 minutes", C.worker);
  const s5_prompt = box(0, 960, 190, 70, "OTP Input Shown", "Step 3 of Stepper UI\nWS event unlocks input field", C.step);
  const s5_submit = box(0, 1060, 190, 60, "QC Enters OTP", "POST /api/job/:id/otp", C.step);
  const s5_route  = box(280, 1060, 240, 60, "Route Resolves Promise", "otpResolvers.get(sessionId)\n→ resolve(otp)", C.step);
  const s5_pw     = box(600, 980, 300, 60, "submitOTP(otp)", "Playwright types + submits OTP", C.worker);

  arrow(s4_ok,    s5_wait,   "Continue");
  arrow(s5_wait,  s5_prompt, "WS: otp_needed");
  arrow(s5_prompt, s5_submit, "QC sees input");
  arrow(s5_submit, s5_route, "POST with OTP");
  arrow(s5_route,  s5_pw,    "Promise resolved");
  arrow(s5_wait,   s5_pw,    "OTP received");

  note(940, 970,
    "🔑 Session Isolation\n────────────────\nEach QC has unique sessionId.\notpResolvers Map:\n  sessionId → resolve fn\nOTP only goes to correct\nPlaywright instance.",
    C.note.blue
  );

  // ════════════════════════════════════════════════════════
  // STEP 6 — Scrape Challan Data
  // ════════════════════════════════════════════════════════
  label(-10, 1080, "STEP 6", 11, true, { r: 0.58, g: 0.35, b: 0.90 });

  const s6_scrape = box(600, 1100, 300, 80, "scrapeChallanRows()", "Scrape ALL visible table rows\nFor each: noticeNo, vehicle,\noffence, amount, status…", C.worker);
  const s6_img    = box(600, 1210, 300, 70, "downloadOffenceImage()", "Click 'View Image' per row\nDownload → upload to S3\nStore public URL", C.storage);
  const s6_screen = box(600, 1310, 300, 70, "takePageScreenshot()", "Full page screenshot\nUpload to S3 → public URL\npasss as pageScreenshotUrl", C.storage);

  arrow(s5_pw,    s6_scrape, "OTP accepted");
  arrow(s6_scrape, s6_img,   "Per challan row");
  arrow(s6_img,   s6_screen, "All images done");

  // ════════════════════════════════════════════════════════
  // STEP 7 — Blank Penalty Lookup
  // ════════════════════════════════════════════════════════
  label(-10, 1310, "STEP 7", 11, true, { r: 0.18, g: 0.72, b: 0.46 });

  const s7_dec   = box(280, 1320, 240, 70, "penaltyAmount blank?\nAND printNotice blank?", "", C.decision);
  const s7_lookup = box(600, 1420, 300, 80, "XLSX Lookup", "Case-insensitive match vs\noffence-amounts.xlsx (198 entries)\nloaded at startup in memory", C.success);
  const s7_match  = box(940, 1420, 260, 60, "Match Found?", "", C.decision);
  const s7_set    = box(940, 1510, 260, 60, "Set amount + source\n= 'xlsx_lookup'", "", C.success);
  const s7_null   = box(940, 1600, 260, 60, "amount = null\nsource = 'manual_lookup_needed'", "", C.manual);
  const s7_skip   = box(280, 1440, 240, 60, "Use scraped amount\nsource = 'scraped'", "", C.success);

  arrow(s6_screen, s7_dec,   "Per row check");
  arrow(s7_dec,    s7_lookup, "YES (blank)");
  arrow(s7_dec,    s7_skip,   "NO (has amount)");
  arrow(s7_lookup, s7_match,  "Lookup complete");
  arrow(s7_match,  s7_set,    "YES");
  arrow(s7_match,  s7_null,   "NO");

  note(0, 1310,
    "📖 XLSX Lookup Strategy\n────────────────\n1. Exact match (case-insensitive)\n2. Partial/contains match\n3. No match → flag manual\n\nFile: backend/data/\noffence-amounts.xlsx\nSheet: IDFY (198 rows)",
    C.note.yellow
  );

  // ════════════════════════════════════════════════════════
  // STEP 8 — Deduplication
  // ════════════════════════════════════════════════════════
  label(-10, 1640, "STEP 8", 11, true, { r: 0.18, g: 0.72, b: 0.46 });

  const s8_get  = box(600, 1660, 300, 70, "GET Admin Panel", "/challan?appointmentId=X\nFetch existing noticeNos", C.external);
  const s8_diff = box(600, 1760, 300, 80, "Deduplicate by noticeNo", "existingSet = Set(noticeNos)\nnewChallans = scraped.filter(\n  c => !existingSet.has(c.noticeNo))", C.worker);
  const s8_dec  = box(600, 1870, 300, 60, "Any new challans?", "", C.decision);
  const s8_post = box(600, 1960, 300, 80, "POST Admin Panel", "/challan\nPayload: appointmentId,\nfetchedBy, pageScreenshotUrl,\nchallans[] (new only)", C.external);
  const s8_skip = box(940, 1870, 260, 60, "Skip POST\n(all already exist)", "", C.manual);

  arrow(s7_set,  s8_get,  "Continue");
  arrow(s7_null, s8_get,  "");
  arrow(s7_skip, s8_get,  "");
  arrow(s8_get,  s8_diff, "Existing data received");
  arrow(s8_diff, s8_dec,  "Diff computed");
  arrow(s8_dec,  s8_post, "YES → POST only new");
  arrow(s8_dec,  s8_skip, "NO → nothing to add");

  note(0, 1660,
    "🔁 Dedup Logic\n────────────────\nKey: noticeNo (unique)\n\nIf existing challan status\nchanged → SKIP (QC handles)\n\nIf GET returns empty\n→ POST all scraped rows\n\nIf all exist → POST nothing",
    C.note.blue
  );

  // ════════════════════════════════════════════════════════
  // STEP 9 — Complete
  // ════════════════════════════════════════════════════════
  label(-10, 2030, "STEP 9", 11, true, { r: 0.18, g: 0.72, b: 0.46 });

  const s9_emit    = box(600, 2060, 300, 70, "Emit 'complete' via WS", "{ challans: finalRows }", C.success);
  const s9_mongo   = box(280, 2060, 240, 70, "MongoDB → COMPLETED", "status: completed\ncompletedAt: timestamp", C.success);
  const s9_display = box(0, 2060, 190, 70, "Step 4: Results", "QC sees challan table\n+ page screenshot link", C.step);

  arrow(s8_post, s9_emit,    "POST succeeded");
  arrow(s8_skip, s9_emit,    "");
  arrow(s9_emit, s9_mongo,   "Update record");
  arrow(s9_emit, s9_display, "WS: complete");

  note(940, 2060,
    "📤 POST Payload\n────────────────\n{\n  appointmentId,\n  fetchedBy,\n  fetchedAt,\n  pageScreenshotUrl,  ← S3\n  challans: [{\n    noticeNo,\n    vehicleNumber,\n    offenceDetail,\n    penaltyAmount,\n    amountSource,   ← scraped/xlsx/manual\n    status,\n    challanCourt,\n    offenceImageUrl ← S3\n  }]\n}",
    C.note.yellow
  );

  // ════════════════════════════════════════════════════════
  // SITE DOWN / SELECTOR BROKEN flow
  // ════════════════════════════════════════════════════════
  label(1300, 0, "⚠️ Error Handling", 14, true, { r: 0.75, g: 0.15, b: 0.15 });

  const e_sitedown  = box(1320, 30, 260, 70, "Site Temporarily Down", "HTTP timeout / conn refused", C.error);
  const e_retry     = box(1320, 130, 260, 80, "Auto Retry with Backoff", "Attempt 1: wait 2 min\nAttempt 2: wait 5 min\nAttempt 3: wait 10 min", C.error);
  const e_notify    = box(1320, 240, 260, 70, "Alert QC", "'Site unavailable.\nWe will retry automatically.'", C.manual);
  arrow(e_sitedown, e_retry,  "");
  arrow(e_retry,    e_notify, "Still down after 3×");

  const e_broken    = box(1320, 360, 260, 70, "Selector Broken", "waitForSelector() timeout\nSite changed its HTML", C.error);
  const e_failfast  = box(1320, 460, 260, 70, "Fail Fast", "Do NOT retry\nDev fix needed", C.error);
  const e_screenshot = box(1320, 560, 260, 70, "Take Screenshot", "Capture broken page state\nUpload to S3", C.storage);
  const e_slack     = box(1320, 660, 260, 80, "🔔 Slack Alert", "Step name + failed selector\n+ screenshot URL\n+ appointmentId", C.error);
  const e_pause     = box(1320, 770, 260, 70, "Pause ALL Pending Jobs", "No retries on queued jobs\nDev must fix selector", C.error);

  arrow(e_broken,    e_failfast,   "");
  arrow(e_failfast,  e_screenshot, "");
  arrow(e_screenshot, e_slack,     "");
  arrow(e_slack,     e_pause,      "");

  note(1320, 870,
    "🔍 How system detects\nselector broken vs site down:\n────────────────\nSite down → connection error\nbefore page loads\n\nSelector broken → page loads OK\nbut expected element missing\nafter 10s waitForSelector()",
    C.note.pink
  );

  console.log("✅ LLD diagram created successfully");
}

createLLD().catch(console.error);

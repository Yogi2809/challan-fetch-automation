// ============================================================
// CHALLAN FETCH AUTOMATION — HLD DIAGRAM
// Run in FigJam: Plugins → Development → Open Console → paste & run
// ============================================================

async function createHLD() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  const page = figma.currentPage;

  // Find the HLD section
  const hldSection = page.children.find(
    n => n.type === 'SECTION' && n.name.toUpperCase() === 'HLD'
  );
  if (!hldSection) { console.error('HLD section not found'); return; }

  const SX = hldSection.x + 80;   // section start X with padding
  const SY = hldSection.y + 120;  // section start Y with padding

  // ── Colour palette ──────────────────────────────────────
  const C = {
    frontend:   { fill: { r: 0.38, g: 0.55, b: 1.0  }, stroke: { r: 0.20, g: 0.35, b: 0.85 } },
    backend:    { fill: { r: 0.18, g: 0.72, b: 0.56 }, stroke: { r: 0.08, g: 0.52, b: 0.38 } },
    queue:      { fill: { r: 1.0,  g: 0.65, b: 0.10 }, stroke: { r: 0.80, g: 0.45, b: 0.00 } },
    worker:     { fill: { r: 0.58, g: 0.35, b: 0.90 }, stroke: { r: 0.38, g: 0.18, b: 0.72 } },
    external:   { fill: { r: 0.95, g: 0.32, b: 0.32 }, stroke: { r: 0.75, g: 0.15, b: 0.15 } },
    storage:    { fill: { r: 0.25, g: 0.78, b: 0.95 }, stroke: { r: 0.08, g: 0.58, b: 0.78 } },
    database:   { fill: { r: 0.55, g: 0.55, b: 0.60 }, stroke: { r: 0.35, g: 0.35, b: 0.40 } },
    white:      { r: 1, g: 1, b: 1 },
  };

  // ── Helper: create a rounded box ────────────────────────
  function makeBox(x, y, w, h, label, sublabel, color, radius = 12) {
    const rect = figma.createRectangle();
    rect.x = SX + x; rect.y = SY + y;
    rect.resize(w, h);
    rect.cornerRadius = radius;
    rect.fills = [{ type: 'SOLID', color: color.fill, opacity: 0.15 }];
    rect.strokes = [{ type: 'SOLID', color: color.stroke }];
    rect.strokeWeight = 2;

    const txt = figma.createText();
    txt.fontName = { family: "Inter", style: "Bold" };
    txt.fontSize = 14;
    txt.fills = [{ type: 'SOLID', color: color.stroke }];
    txt.characters = label;
    txt.x = SX + x + w / 2 - txt.width / 2;
    txt.y = SY + y + (sublabel ? h / 2 - 18 : h / 2 - 10);

    let sub = null;
    if (sublabel) {
      sub = figma.createText();
      sub.fontName = { family: "Inter", style: "Regular" };
      sub.fontSize = 11;
      sub.fills = [{ type: 'SOLID', color: color.stroke, opacity: 0.8 }];
      sub.characters = sublabel;
      sub.x = SX + x + w / 2 - sub.width / 2;
      sub.y = SY + y + h / 2 + 4;
    }

    const group = figma.group([rect, txt, ...(sub ? [sub] : [])], page);
    return { group, rect, cx: SX + x + w / 2, cy: SY + y + h / 2 };
  }

  // ── Helper: create connector arrow ──────────────────────
  function connect(fromNode, toNode, label = '', color = { r: 0.4, g: 0.4, b: 0.4 }) {
    const conn = figma.createConnector();
    conn.connectorStart = { endpointNodeId: fromNode.id, magnet: 'AUTO' };
    conn.connectorEnd   = { endpointNodeId: toNode.id,   magnet: 'AUTO' };
    conn.strokeWeight = 2;
    conn.strokes = [{ type: 'SOLID', color }];
    conn.connectorEndStrokeCap = 'ARROW_FILLED';

    if (label) {
      const lbl = figma.createText();
      lbl.fontName = { family: "Inter", style: "Regular" };
      lbl.fontSize = 10;
      lbl.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.3, b: 0.3 } }];
      lbl.characters = label;
      const fx = (fromNode.x + fromNode.width / 2 + toNode.x + toNode.width / 2) / 2;
      const fy = (fromNode.y + fromNode.height / 2 + toNode.y + toNode.height / 2) / 2 - 14;
      lbl.x = fx - lbl.width / 2;
      lbl.y = fy;
    }
    return conn;
  }

  // ── Helper: sticky note ──────────────────────────────────
  function makeNote(x, y, text, color = { r: 1, g: 0.96, b: 0.60 }) {
    const sticky = figma.createSticky();
    sticky.x = SX + x;
    sticky.y = SY + y;
    sticky.text.characters = text;
    sticky.fills = [{ type: 'SOLID', color }];
    return sticky;
  }

  // ── Helper: section label ────────────────────────────────
  function makeLabel(x, y, text, size = 13, bold = false) {
    const t = figma.createText();
    t.fontName = { family: "Inter", style: bold ? "Bold" : "Regular" };
    t.fontSize = size;
    t.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.3, b: 0.3 } }];
    t.characters = text;
    t.x = SX + x; t.y = SY + y;
    return t;
  }

  // ════════════════════════════════════════════════════════
  // TITLE
  // ════════════════════════════════════════════════════════
  const title = figma.createText();
  title.fontName = { family: "Inter", style: "Bold" };
  title.fontSize = 28;
  title.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
  title.characters = "Challan Fetch Automation — High Level Design (Phase 1)";
  title.x = SX; title.y = SY - 70;

  const subtitle = figma.createText();
  subtitle.fontName = { family: "Inter", style: "Regular" };
  subtitle.fontSize = 14;
  subtitle.fills = [{ type: 'SOLID', color: { r: 0.45, g: 0.45, b: 0.45 } }];
  subtitle.characters = "React + Node.js + BullMQ + Playwright  |  Multi-QC parallel sessions  |  Manual trigger via Stepper UI";
  subtitle.x = SX; subtitle.y = SY - 36;

  // ════════════════════════════════════════════════════════
  // ROW 1 — QC User → Frontend → Backend
  // ════════════════════════════════════════════════════════

  // QC User (actor)
  const qc = makeBox(0, 60, 160, 80, "👤 QC Associate", "Manual trigger", C.external, 40);

  // React Stepper UI
  const ui = makeBox(240, 40, 220, 120, "React Stepper UI", "Vite + TailwindCSS", C.frontend);

  // Node.js Backend
  const backend = makeBox(560, 40, 240, 120, "Node.js + Express", "Session mgmt · Routes · WS", C.backend);

  // MongoDB
  const mongo = makeBox(560, 240, 240, 100, "MongoDB", "Job records · Audit trail", C.database);

  // BullMQ + Redis Queue
  const queue = makeBox(920, 40, 220, 120, "BullMQ + Redis", "Job queue · Retry logic", C.queue);

  // Playwright Worker Pool
  const worker = makeBox(920, 240, 220, 120, "Playwright Workers", "Browser automation pool\nConcurrency: 5–25", C.worker);

  // ════════════════════════════════════════════════════════
  // ROW 2 — External Systems
  // ════════════════════════════════════════════════════════

  // Delhi Police Website
  const police = makeBox(920, 460, 220, 100, "Delhi Traffic Police", "traffic.delhipolice.gov.in", C.external);

  // Admin Panel
  const admin = makeBox(560, 460, 240, 100, "Admin Panel API", "adminstaging.c24svc.app", C.external);

  // S3 Storage
  const s3 = makeBox(240, 460, 200, 100, "AWS S3", "Images · Screenshots\nPublic URLs", C.storage);

  // ════════════════════════════════════════════════════════
  // CONNECTORS
  // ════════════════════════════════════════════════════════
  connect(qc.rect, ui.rect, "Opens browser tab");
  connect(ui.rect, backend.rect, "REST API calls");
  connect(backend.rect, queue.rect, "Enqueue job");
  connect(queue.rect, worker.rect, "Pick up job");
  connect(backend.rect, mongo.rect, "Read/write\njob records");
  connect(worker.rect, police.rect, "Playwright\nautomation");
  connect(worker.rect, admin.rect, "GET vehicle details\nPOST challan results");
  connect(worker.rect, s3.rect, "Upload images\n& screenshots");

  // WebSocket bidirectional
  const wsConn = figma.createConnector();
  wsConn.connectorStart = { endpointNodeId: backend.rect.id, magnet: 'AUTO' };
  wsConn.connectorEnd   = { endpointNodeId: ui.rect.id,      magnet: 'AUTO' };
  wsConn.strokeWeight = 2;
  wsConn.strokes = [{ type: 'SOLID', color: C.frontend.stroke }];
  wsConn.connectorStartStrokeCap = 'ARROW_FILLED';
  wsConn.connectorEndStrokeCap   = 'ARROW_FILLED';

  // ════════════════════════════════════════════════════════
  // LAYER LABELS (swimlane headings)
  // ════════════════════════════════════════════════════════
  makeLabel(-80, 40,  "👤 Actor",          12, true);
  makeLabel(-80, 100, "🖥 Frontend",        12, true);
  makeLabel(-80, 200, "⚙️ Backend",          12, true);
  makeLabel(-80, 460, "🌐 External",        12, true);

  // ════════════════════════════════════════════════════════
  // LEGEND BOX
  // ════════════════════════════════════════════════════════
  const legendBg = figma.createRectangle();
  legendBg.x = SX + 1280; legendBg.y = SY + 40;
  legendBg.resize(300, 320);
  legendBg.cornerRadius = 12;
  legendBg.fills = [{ type: 'SOLID', color: { r: 0.97, g: 0.97, b: 0.97 } }];
  legendBg.strokes = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
  legendBg.strokeWeight = 1.5;

  const legendTitle = figma.createText();
  legendTitle.fontName = { family: "Inter", style: "Bold" };
  legendTitle.fontSize = 13;
  legendTitle.characters = "Legend";
  legendTitle.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
  legendTitle.x = SX + 1300; legendTitle.y = SY + 58;

  const legendItems = [
    { label: "React Frontend",          color: C.frontend.fill  },
    { label: "Node.js Backend",         color: C.backend.fill   },
    { label: "BullMQ + Redis Queue",    color: C.queue.fill     },
    { label: "Playwright Worker Pool",  color: C.worker.fill    },
    { label: "External Systems",        color: C.external.fill  },
    { label: "Storage (S3)",            color: C.storage.fill   },
    { label: "Database (MongoDB)",      color: C.database.fill  },
  ];
  legendItems.forEach((item, i) => {
    const dot = figma.createEllipse();
    dot.x = SX + 1300; dot.y = SY + 92 + i * 34;
    dot.resize(16, 16);
    dot.fills = [{ type: 'SOLID', color: item.color }];

    const lbl = figma.createText();
    lbl.fontName = { family: "Inter", style: "Regular" };
    lbl.fontSize = 12;
    lbl.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2 } }];
    lbl.characters = item.label;
    lbl.x = SX + 1326; lbl.y = SY + 90 + i * 34;
  });

  // ════════════════════════════════════════════════════════
  // STICKY NOTES — Key Design Decisions
  // ════════════════════════════════════════════════════════
  makeNote(0, 480,
    "⚡ Phase 2 Upgrade\nReplace ManualInputProvider\nwith WebhookInputProvider.\nOnly the trigger layer changes.",
    { r: 0.85, g: 0.95, b: 1.0 }
  );

  makeNote(240, 340,
    "🔑 Session Isolation\nEach QC gets a UUID sessionId.\nWebSocket + OTP both scoped\nto this ID — no cross-talk.",
    { r: 1.0, g: 0.95, b: 0.75 }
  );

  makeNote(560, 340,
    "♻️ Retry Strategy\n• Site down → auto retry\n  2min / 5min / 10min\n• Selector broken → fail fast\n  + Slack alert + screenshot",
    { r: 1.0, g: 0.88, b: 0.88 }
  );

  makeNote(920, 380,
    "🔢 Concurrency\nTesting:    5 workers\nStaging:   10 workers\nProduction: 25 workers",
    { r: 0.90, g: 0.85, b: 1.0 }
  );

  // ════════════════════════════════════════════════════════
  // WEBSOCKET LABEL
  // ════════════════════════════════════════════════════════
  const wsLabel = figma.createText();
  wsLabel.fontName = { family: "Inter", style: "Regular" };
  wsLabel.fontSize = 11;
  wsLabel.fills = [{ type: 'SOLID', color: C.frontend.stroke }];
  wsLabel.characters = "↕ WebSocket\n(real-time step updates\n+ OTP prompt)";
  wsLabel.x = SX + 380; wsLabel.y = SY + 170;

  console.log("✅ HLD diagram created successfully");
}

createHLD().catch(console.error);

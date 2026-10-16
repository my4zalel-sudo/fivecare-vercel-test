// api/interop.js
// OPSI B: gateway interoperabilitas antar-SIMRS.
// Jalur ini TERPISAH dari SATUSEHAT.
// SATUSEHAT pada masing-masing RS tetap berjalan dengan credential masing-masing.

function send(res, code, data) {
  res.status(code).json(data);
}

function header(req, name) {
  const value = req.headers[String(name).toLowerCase()];
  return Array.isArray(value) ? (value[0] || "") : (value || "");
}

function constantTimeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function supabaseRest(path, options = {}) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");

  if (!base || !serviceRole) {
    throw new Error(
      "SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diisi di Vercel."
    );
  }

  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(
      `Storage HTTP ${response.status}: ${
        typeof body === "string" ? body : JSON.stringify(body)
      }`
    );
  }

  return body;
}

function validatePayload(p) {
  const errors = [];

  if (!p || typeof p !== "object") return ["Body JSON tidak valid."];
  if (p.version !== "1.0") errors.push("version harus 1.0");
  if (p.event_type !== "clinical_visit") {
    errors.push("event_type harus clinical_visit");
  }
  if (!p.source_org) errors.push("source_org wajib");
  if (!p.destination_org) errors.push("destination_org wajib");
  if (!p.source_record_id) errors.push("source_record_id wajib");

  const nik = String(p?.patient?.nik || "");
  if (!/^\d{16}$/.test(nik)) {
    errors.push("patient.nik harus 16 digit");
  }

  if (p?.consent?.status !== "approved") {
    errors.push("consent.status harus approved");
  }

  if (String(p?.consent?.requester_org || "") !== String(p.destination_org || "")) {
    errors.push("consent.requester_org harus sama dengan destination_org");
  }

  return errors;
}

export default async function handler(req, res) {
  // Untuk demo. Nanti CORS bisa dipersempit.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Interop-Key, X-Requester-Org"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  const action = String(req.query.action || "health").toLowerCase();

  if (action === "health") {
    return send(res, 200, {
      status: "success",
      service: "FiveCare Interop Gateway",
      version: "1.0",
      message: "Gateway aktif.",
      time: new Date().toISOString(),
    });
  }

  try {
    // ---------------------------------------------------------
    // FiveCare -> Gateway
    // ---------------------------------------------------------
    if (action === "push") {
      if (req.method !== "POST") {
        return send(res, 405, {
          status: "error",
          message: "Action push harus POST.",
        });
      }

      const suppliedKey = header(req, "X-Interop-Key");
      const serverKey = process.env.INTEROP_PUSH_KEY || "";

      if (!constantTimeEqual(suppliedKey, serverKey)) {
        return send(res, 401, {
          status: "error",
          message: "INTEROP push key tidak valid.",
        });
      }

      const payload =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const errors = validatePayload(payload);
      if (errors.length > 0) {
        return send(res, 400, {
          status: "error",
          message: "Payload INTEROP v1 tidak valid.",
          errors,
        });
      }

      const row = {
        version: payload.version,
        source_org: String(payload.source_org),
        destination_org: String(payload.destination_org),
        patient_nik: String(payload.patient.nik),
        source_record_id: String(payload.source_record_id),
        event_type: String(payload.event_type),
        consent: payload.consent,
        payload,
        updated_at: new Date().toISOString(),
      };

      const saved = await supabaseRest(
        "interop_records?on_conflict=source_org,destination_org,source_record_id",
        {
          method: "POST",
          headers: {
            Prefer: "resolution=merge-duplicates,return=representation",
          },
          body: JSON.stringify([row]),
        }
      );

      return send(res, 200, {
        status: "success",
        message: "Data INTEROP v1 berhasil diterima.",
        record_id: Array.isArray(saved) && saved[0] ? saved[0].id : null,
        source_record_id: row.source_record_id,
      });
    }

    // ---------------------------------------------------------
    // RS penerima -> Gateway
    // ---------------------------------------------------------
    if (action === "patient_history") {
      if (req.method !== "GET") {
        return send(res, 405, {
          status: "error",
          message: "Action patient_history harus GET.",
        });
      }

      const suppliedKey = header(req, "X-Interop-Key");
      const serverKey = process.env.INTEROP_READ_KEY || "";

      if (!constantTimeEqual(suppliedKey, serverKey)) {
        return send(res, 401, {
          status: "error",
          message: "INTEROP read key tidak valid.",
        });
      }

      const requesterOrg = String(header(req, "X-Requester-Org") || "").trim();
      const nik = String(req.query.nik || "").trim();

      if (!requesterOrg) {
        return send(res, 400, {
          status: "error",
          message: "Header X-Requester-Org wajib diisi.",
        });
      }

      if (!/^\d{16}$/.test(nik)) {
        return send(res, 400, {
          status: "error",
          message: "NIK harus 16 digit.",
        });
      }

      const q = new URLSearchParams({
        select:
          "id,version,source_org,destination_org,patient_nik,source_record_id,event_type,consent,payload,created_at,updated_at",
        patient_nik: `eq.${nik}`,
        destination_org: `eq.${requesterOrg}`,
        order: "created_at.desc",
      });

      const rows = await supabaseRest(`interop_records?${q.toString()}`, {
        method: "GET",
      });

      return send(res, 200, {
        status: "success",
        message: "Riwayat interop berhasil diambil.",
        requester_org: requesterOrg,
        nik,
        total: Array.isArray(rows) ? rows.length : 0,
        records: Array.isArray(rows) ? rows : [],
      });
    }

    return send(res, 400, {
      status: "error",
      message: `Action '${action}' tidak dikenal.`,
      available_actions: ["health", "push", "patient_history"],
    });
  } catch (err) {
    console.error("INTEROP ERROR", err);

    return send(res, 500, {
      status: "error",
      message: "Gateway interop gagal memproses request.",
      detail: String(err?.message || err),
    });
  }
}

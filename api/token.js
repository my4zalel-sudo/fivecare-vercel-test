async function getToken() {
  const clientId = process.env.SATUSEHAT_CLIENT_ID;
  const clientSecret = process.env.SATUSEHAT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Credential SATUSEHAT belum diatur di Vercel");
  }

  const url =
    "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1/accesstoken?grant_type=client_credentials";

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(`Gagal mendapatkan token. HTTP ${response.status}`);
  }

  return {
    accessToken: data.access_token,
    info: data,
  };
}

async function fhirGet(path, accessToken) {
  const url =
    "https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1/" + path;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/fhir+json",
    },
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Respons SATUSEHAT bukan JSON. HTTP ${response.status}`
    );
  }

  return {
    response,
    data,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const action = String(req.query.action || "token").toLowerCase();

  try {

    // ==========================================
    // TOKEN
    // ==========================================
    if (action === "token") {
      const { accessToken, info } = await getToken();

      return res.status(200).json({
        status: "success",
        message: "Koneksi SATUSEHAT berhasil",
        http_code: 200,
        token_status: info.status ?? null,
        token_type: info.token_type ?? null,
        expires_in: info.expires_in ?? null,
        token_length: accessToken.length,
      });
    }

    // ==========================================
    // PATIENT
    // ==========================================
    if (action === "patient") {
      const nik = String(req.query.nik || "").trim();

      if (!/^\d{16}$/.test(nik)) {
        return res.status(400).json({
          status: "error",
          message: "NIK harus 16 digit",
        });
      }

      const { accessToken } = await getToken();

      const identifier =
        `https://fhir.kemkes.go.id/id/nik|${nik}`;

      const { response, data } = await fhirGet(
        "Patient?identifier=" + encodeURIComponent(identifier),
        accessToken
      );

      if (!response.ok) {
        return res.status(response.status).json({
          status: "error",
          http_code: response.status,
          response: data,
        });
      }

      const patient = data.entry?.[0]?.resource;

      if (!patient) {
        return res.status(404).json({
          status: "not_found",
          message: "Patient tidak ditemukan di SATUSEHAT",
          nik,
        });
      }

      let nama = null;

      if (patient.name?.[0]?.text) {
        nama = patient.name[0].text;
      } else if (patient.name?.[0]) {
        nama = [
          ...(patient.name[0].prefix || []),
          ...(patient.name[0].given || []),
          patient.name[0].family || "",
        ]
          .filter(Boolean)
          .join(" ");
      }

      return res.status(200).json({
        status: "success",
        message: "Patient ditemukan di SATUSEHAT",
        patient: {
          ihs: patient.id ?? null,
          nik,
          name: nama,
          gender: patient.gender ?? null,
          birthDate: patient.birthDate ?? null,
          active: patient.active ?? null,
        },
      });
    }

    // ==========================================
    // ENCOUNTER
    // ==========================================
    if (action === "encounter") {
      const patientId =
        String(req.query.patient_id || "").trim();

      if (!patientId) {
        return res.status(400).json({
          status: "error",
          message: "patient_id wajib diisi",
        });
      }

      const { accessToken } = await getToken();

      const { response, data } = await fhirGet(
        "Encounter?subject=" + encodeURIComponent(patientId),
        accessToken
      );

      if (!response.ok) {
        return res.status(response.status).json({
          status: "error",
          http_code: response.status,
          message: "Gagal mengambil Encounter",
          response: data,
        });
      }

      const entries = Array.isArray(data.entry)
        ? data.entry
        : [];

      if (entries.length === 0) {
        return res.status(200).json({
          status: "not_found",
          message: "Belum ada Encounter untuk Patient ini",
          patient_ihs: patientId,
          total: 0,
          encounters: [],
        });
      }

      const encounters = entries.map((entry) => {
        const e = entry.resource || {};

        return {
          id: e.id ?? null,
          status: e.status ?? null,

          class_code:
            e.class?.code ?? null,

          class_display:
            e.class?.display ?? null,

          period_start:
            e.period?.start ?? null,

          period_end:
            e.period?.end ?? null,

          service_provider:
            e.serviceProvider?.display ??
            e.serviceProvider?.reference ??
            null,

          location:
            e.location?.[0]?.location?.display ??
            e.location?.[0]?.location?.reference ??
            null,
        };
      });

      return res.status(200).json({
        status: "success",
        message: "Encounter berhasil ditemukan",
        patient_ihs: patientId,
        total: encounters.length,
        encounters,
      });
    }

    return res.status(400).json({
      status: "error",
      message: `Action '${action}' tidak dikenal`,
      available_actions: [
        "token",
        "patient",
        "encounter",
      ],
    });

  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
}

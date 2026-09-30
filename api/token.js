async function getToken() {
  const clientId = process.env.SATUSEHAT_CLIENT_ID;
  const clientSecret = process.env.SATUSEHAT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Credential SATUSEHAT belum diatur di Vercel");
  }

  const tokenUrl =
    "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1/accesstoken?grant_type=client_credentials";

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Respons token bukan JSON. HTTP ${response.status}: ${text.substring(0, 200)}`
    );
  }

  if (!response.ok || !data.access_token) {
    throw new Error(
      `Gagal mendapatkan token SATUSEHAT. HTTP ${response.status}`
    );
  }

  return {
    accessToken: data.access_token,
    tokenInfo: data,
  };
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const action = String(req.query.action || "token").toLowerCase();

  try {
    // =====================================================
    // ACTION: TOKEN
    // =====================================================
    if (action === "token") {
      const { accessToken, tokenInfo } = await getToken();

      return res.status(200).json({
        status: "success",
        http_code: 200,
        message: "Koneksi SATUSEHAT berhasil",
        token_status: tokenInfo.status ?? null,
        token_type: tokenInfo.token_type ?? null,
        expires_in: tokenInfo.expires_in ?? null,
        token_length: accessToken.length,
      });
    }

    // =====================================================
    // ACTION: PATIENT
    // =====================================================
    if (action === "patient") {
      const nik = String(req.query.nik || "").trim();

      if (!/^\d{16}$/.test(nik)) {
        return res.status(400).json({
          status: "error",
          message: "NIK harus terdiri dari 16 digit angka",
        });
      }

      const { accessToken } = await getToken();

      const identifier =
        `https://fhir.kemkes.go.id/id/nik|${nik}`;

      const patientUrl =
        "https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1/Patient" +
        "?identifier=" +
        encodeURIComponent(identifier);

      const response = await fetch(patientUrl, {
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
        return res.status(502).json({
          status: "error",
          message: "Respons Patient dari SATUSEHAT bukan JSON",
          http_code: response.status,
          response_preview: text.substring(0, 200),
        });
      }

      if (!response.ok) {
        return res.status(response.status).json({
          status: "error",
          http_code: response.status,
          message: "Gagal mencari Patient di SATUSEHAT",
          response: data,
        });
      }

      const entries = Array.isArray(data.entry) ? data.entry : [];

      if (entries.length === 0) {
        return res.status(404).json({
          status: "not_found",
          message: "Patient tidak ditemukan di SATUSEHAT",
          nik,
        });
      }

      const patient = entries[0]?.resource;

      if (!patient) {
        return res.status(404).json({
          status: "not_found",
          message: "Resource Patient tidak ditemukan",
          nik,
        });
      }

      let nama = null;

      if (patient.name?.[0]?.text) {
        nama = patient.name[0].text;
      } else if (patient.name?.[0]) {
        const name = patient.name[0];

        nama = [
          ...(name.prefix || []),
          ...(name.given || []),
          name.family || "",
        ]
          .filter(Boolean)
          .join(" ");
      }

      return res.status(200).json({
        status: "success",
        message: "Patient ditemukan di SATUSEHAT",
        patient: {
          ihs: patient.id ?? null,
          nik: nik,
          name: nama,
          gender: patient.gender ?? null,
          birthDate: patient.birthDate ?? null,
          active: patient.active ?? null,
        },
      });
    }

    // =====================================================
    // ACTION TIDAK DIKENAL
    // =====================================================
    return res.status(400).json({
      status: "error",
      message: `Action '${action}' tidak dikenal`,
      available_actions: [
        "token",
        "patient",
      ],
    });

  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
}

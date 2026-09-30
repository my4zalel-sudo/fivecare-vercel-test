async function getToken() {
  const clientId = process.env.SATUSEHAT_CLIENT_ID;
  const clientSecret = process.env.SATUSEHAT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Credential SATUSEHAT belum diatur");
  }

  const tokenUrl =
    "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1/accesstoken?grant_type=client_credentials";

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: body.toString()
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error("Gagal mendapatkan token SATUSEHAT");
  }

  return {
    token: data.access_token,
    info: data
  };
}


export default async function handler(req, res) {

  const action = req.query.action || "token";

  try {

    // =============================
    // TEST TOKEN
    // =============================
    if (action === "token") {

      const result = await getToken();

      return res.status(200).json({
        status: "success",
        http_code: 200,
        token_status: result.info.status ?? null,
        token_type: result.info.token_type ?? null,
        expires_in: result.info.expires_in ?? null,
        token_length: result.token.length
      });
    }


    // =============================
    // SEARCH PATIENT
    // =============================
    if (action === "patient") {

      const nik = String(req.query.nik || "").trim();

      if (!/^\d{16}$/.test(nik)) {
        return res.status(400).json({
          status: "error",
          message: "NIK harus 16 digit"
        });
      }

      const result = await getToken();

      const identifier =
        `https://fhir.kemkes.go.id/id/nik|${nik}`;

      const patientUrl =
        "https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1/Patient" +
        "?identifier=" +
        encodeURIComponent(identifier);

      const response = await fetch(patientUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${result.token}`,
          Accept: "application/fhir+json"
        }
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          status: "error",
          http_code: response.status,
          response: data
        });
      }

      const patient = data.entry?.[0]?.resource;

      if (!patient) {
        return res.status(404).json({
          status: "not_found",
          message: "Patient tidak ditemukan di SATUSEHAT",
          nik
        });
      }

      return res.status(200).json({
        status: "success",
        patient: {
          ihs: patient.id ?? null,
          nik,
          name:
            patient.name?.[0]?.text ||
            patient.name?.[0]?.given?.join(" ") ||
            null,
          gender: patient.gender ?? null,
          birthDate: patient.birthDate ?? null
        }
      });
    }


    return res.status(400).json({
      status: "error",
      message: "Action tidak dikenal"
    });

  } catch (error) {

    return res.status(500).json({
      status: "error",
      message: error.message
    });
  }
}

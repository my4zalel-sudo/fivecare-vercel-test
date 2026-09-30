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
      `Respons token SATUSEHAT bukan JSON. HTTP ${response.status}`
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


// ======================================================
// HELPER GET FHIR
// ======================================================

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
      `Respons SATUSEHAT bukan JSON. HTTP ${response.status}: ${text.substring(
        0,
        200
      )}`
    );
  }

  return {
    response,
    data,
  };
}


// ======================================================
// VERCEL FUNCTION
// ======================================================

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const action = String(
    req.query.action || "token"
  ).toLowerCase();

  try {

    // ==================================================
    // TOKEN
    // ==================================================

    if (action === "token") {
      const { accessToken, tokenInfo } =
        await getToken();

      return res.status(200).json({
        status: "success",
        message: "Koneksi SATUSEHAT berhasil",
        http_code: 200,

        token_status:
          tokenInfo.status ?? null,

        token_type:
          tokenInfo.token_type ?? null,

        expires_in:
          tokenInfo.expires_in ?? null,

        token_length:
          accessToken.length,
      });
    }


    // ==================================================
    // PATIENT BERDASARKAN NIK
    // ==================================================

    if (action === "patient") {
      const nik = String(
        req.query.nik || ""
      ).trim();

      if (!/^\d{16}$/.test(nik)) {
        return res.status(400).json({
          status: "error",
          message:
            "NIK harus terdiri dari 16 digit angka",
        });
      }

      const { accessToken } =
        await getToken();

      const identifier =
        `https://fhir.kemkes.go.id/id/nik|${nik}`;

      const path =
        "Patient?identifier=" +
        encodeURIComponent(identifier);

      const { response, data } =
        await fhirGet(
          path,
          accessToken
        );

      if (!response.ok) {
        return res
          .status(response.status)
          .json({
            status: "error",
            http_code:
              response.status,
            message:
              "Gagal mencari Patient di SATUSEHAT",
            response: data,
          });
      }

      const entries =
        Array.isArray(data.entry)
          ? data.entry
          : [];

      if (entries.length === 0) {
        return res.status(404).json({
          status: "not_found",
          message:
            "Patient tidak ditemukan di SATUSEHAT",
          nik,
        });
      }

      const patient =
        entries[0]?.resource;

      if (!patient) {
        return res.status(404).json({
          status: "not_found",
          message:
            "Resource Patient tidak ditemukan",
          nik,
        });
      }

      let nama = null;

      if (
        patient.name?.[0]?.text
      ) {
        nama =
          patient.name[0].text;
      } else if (
        patient.name?.[0]
      ) {
        const name =
          patient.name[0];

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
        message:
          "Patient ditemukan di SATUSEHAT",

        patient: {
          ihs:
            patient.id ?? null,

          nik,

          name:
            nama,

          gender:
            patient.gender ?? null,

          birthDate:
            patient.birthDate ?? null,

          active:
            patient.active ?? null,
        },
      });
    }


    // ==================================================
    // ENCOUNTER BERDASARKAN PATIENT IHS
    // ==================================================

    if (action === "encounter") {
      const patientId = String(
        req.query.patient_id || ""
      ).trim();

      if (!patientId) {
        return res.status(400).json({
          status: "error",
          message:
            "patient_id wajib diisi",
        });
      }

      const { accessToken } =
        await getToken();

      const path =
        "Encounter?subject=" +
        encodeURIComponent(
          patientId
        );

      const { response, data } =
        await fhirGet(
          path,
          accessToken
        );

      if (!response.ok) {
        return res
          .status(response.status)
          .json({
            status: "error",
            http_code:
              response.status,

            message:
              "Gagal mengambil Encounter",

            response: data,
          });
      }

      const entries =
        Array.isArray(data.entry)
          ? data.entry
          : [];

      if (entries.length === 0) {
        return res.status(200).json({
          status: "not_found",

          message:
            "Belum ada Encounter untuk Patient ini",

          patient_ihs:
            patientId,

          total: 0,

          encounters: [],
        });
      }

      const encounters =
        entries.map((entry) => {
          const e =
            entry.resource || {};

          return {
            id:
              e.id ?? null,

            status:
              e.status ?? null,

            class_code:
              e.class?.code ??
              null,

            class_display:
              e.class?.display ??
              null,

            period_start:
              e.period?.start ??
              null,

            period_end:
              e.period?.end ??
              null,

            service_provider:
              e.serviceProvider
                ?.display ??
              e.serviceProvider
                ?.reference ??
              null,

            location:
              e.location?.[0]
                ?.location
                ?.display ??
              e.location?.[0]
                ?.location
                ?.reference ??
              null,
          };
        });

      return res.status(200).json({
        status: "success",

        message:
          "Encounter berhasil ditemukan",

        patient_ihs:
          patientId,

        total:
          encounters.length,

        encounters,
      });
    }


    // ==================================================
    // OBSERVATION
    // berdasarkan Patient + Encounter
    // ==================================================

    if (action === "observation") {
      const patientId = String(
        req.query.patient_id || ""
      ).trim();

      const encounterId = String(
        req.query.encounter_id || ""
      ).trim();

      if (!patientId) {
        return res.status(400).json({
          status: "error",
          message:
            "patient_id wajib diisi",
        });
      }

      if (!encounterId) {
        return res.status(400).json({
          status: "error",
          message:
            "encounter_id wajib diisi",
        });
      }

      const { accessToken } =
        await getToken();

      const path =
        "Observation" +
        "?subject=" +
        encodeURIComponent(
          patientId
        ) +
        "&encounter=" +
        encodeURIComponent(
          encounterId
        );

      const { response, data } =
        await fhirGet(
          path,
          accessToken
        );

      if (!response.ok) {
        return res
          .status(response.status)
          .json({
            status: "error",

            http_code:
              response.status,

            message:
              "Gagal mengambil Observation",

            response: data,
          });
      }

      const entries =
        Array.isArray(data.entry)
          ? data.entry
          : [];

      if (entries.length === 0) {
        return res.status(200).json({
          status: "not_found",

          message:
            "Tidak ada Observation untuk Encounter ini",

          patient_ihs:
            patientId,

          encounter_id:
            encounterId,

          total: 0,

          observations: [],
        });
      }

      const observations =
        entries.map((entry) => {
          const observation =
            entry.resource || {};

          const coding =
            observation.code
              ?.coding?.[0] || {};

          let value = null;
          let unit = null;

          // --------------------------
          // valueQuantity
          // --------------------------

          if (
            observation.valueQuantity
          ) {
            value =
              observation
                .valueQuantity
                .value ?? null;

            unit =
              observation
                .valueQuantity
                .unit ??
              observation
                .valueQuantity
                .code ??
              null;
          }

          // --------------------------
          // valueString
          // --------------------------

          else if (
            observation.valueString !==
            undefined
          ) {
            value =
              observation.valueString;
          }

          // --------------------------
          // valueCodeableConcept
          // --------------------------

          else if (
            observation
              .valueCodeableConcept
          ) {
            value =
              observation
                .valueCodeableConcept
                .text ??
              observation
                .valueCodeableConcept
                .coding?.[0]
                ?.display ??
              null;
          }

          // --------------------------
          // valueInteger
          // --------------------------

          else if (
            observation.valueInteger !==
            undefined
          ) {
            value =
              observation.valueInteger;
          }

          // --------------------------
          // valueBoolean
          // --------------------------

          else if (
            observation.valueBoolean !==
            undefined
          ) {
            value =
              observation.valueBoolean;
          }

          // --------------------------
          // COMPONENT
          // contoh tekanan darah
          // --------------------------

          const components =
            Array.isArray(
              observation.component
            )
              ? observation.component.map(
                  (component) => {
                    const cCoding =
                      component.code
                        ?.coding?.[0] ||
                      {};

                    let componentValue =
                      null;

                    let componentUnit =
                      null;

                    if (
                      component
                        .valueQuantity
                    ) {
                      componentValue =
                        component
                          .valueQuantity
                          .value ??
                        null;

                      componentUnit =
                        component
                          .valueQuantity
                          .unit ??
                        component
                          .valueQuantity
                          .code ??
                        null;
                    } else if (
                      component.valueString !==
                      undefined
                    ) {
                      componentValue =
                        component
                          .valueString;
                    }

                    return {
                      code:
                        cCoding.code ??
                        null,

                      display:
                        cCoding.display ??
                        component.code
                          ?.text ??
                        null,

                      value:
                        componentValue,

                      unit:
                        componentUnit,
                    };
                  }
                )
              : [];

          return {
            id:
              observation.id ??
              null,

            status:
              observation.status ??
              null,

            code:
              coding.code ??
              null,

            display:
              coding.display ??
              observation.code
                ?.text ??
              null,

            value,

            unit,

            effective:
              observation
                .effectiveDateTime ??
              observation
                .effectiveInstant ??
              null,

            issued:
              observation.issued ??
              null,

            components,
          };
        });

      return res.status(200).json({
        status: "success",

        message:
          "Observation berhasil ditemukan",

        patient_ihs:
          patientId,

        encounter_id:
          encounterId,

        total:
          observations.length,

        observations,
      });
    }


    // ==================================================
    // ACTION TIDAK DIKENAL
    // ==================================================

    return res.status(400).json({
      status: "error",

      message:
        `Action '${action}' tidak dikenal`,

      available_actions: [
        "token",
        "patient",
        "encounter",
        "observation",
      ],
    });

  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
}

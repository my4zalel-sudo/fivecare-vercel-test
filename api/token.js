const SATUSEHAT_BASE =
  "https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1";

const SATUSEHAT_TOKEN_URL =
  "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1/accesstoken?grant_type=client_credentials";

// ID sandbox yang sudah terbukti ada pada Encounter kamu.
// Nanti bisa dipindahkan ke Environment Variables.
const DEFAULT_ORGANIZATION_ID =
  "06ff9913-88d6-4480-82da-d6631a80448e";

const DEFAULT_PRACTITIONER_ID =
  "10018452434";

const DEFAULT_LOCATION_ID =
  "1e997571-dd1f-4afe-8a00-90b903270ae6";


// ======================================================
// TOKEN
// ======================================================

async function getToken() {
  const clientId =
    process.env.SATUSEHAT_CLIENT_ID;

  const clientSecret =
    process.env.SATUSEHAT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Credential SATUSEHAT belum diatur di Vercel"
    );
  }

  const body =
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    });

  const response =
    await fetch(
      SATUSEHAT_TOKEN_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",

          Accept:
            "application/json",
        },

        body:
          body.toString(),
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    throw new Error(
      `Respons token bukan JSON. HTTP ${response.status}`
    );
  }

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      `Gagal mendapatkan token SATUSEHAT. HTTP ${response.status}`
    );
  }

  return {
    accessToken:
      data.access_token,

    tokenInfo:
      data,
  };
}


// ======================================================
// FHIR REQUEST
// ======================================================

async function fhirRequest(
  path,
  accessToken,
  options = {}
) {
  const method =
    options.method || "GET";

  const url =
    path.startsWith("http")
      ? path
      : `${SATUSEHAT_BASE}/${path}`;

  const headers = {
    Authorization:
      `Bearer ${accessToken}`,

    Accept:
      "application/fhir+json",
  };

  if (
    method !== "GET" &&
    method !== "HEAD"
  ) {
    headers["Content-Type"] =
      "application/json";
  }

  const fetchOptions = {
    method,
    headers,
  };

  if (
    options.body !== undefined
  ) {
    fetchOptions.body =
      JSON.stringify(
        options.body
      );
  }

  const response =
    await fetch(
      url,
      fetchOptions
    );

  const text =
    await response.text();

  let data = null;

  if (text) {
    try {
      data =
        JSON.parse(text);
    } catch {
      data = {
        raw:
          text.substring(
            0,
            1000
          ),
      };
    }
  }

  return {
    response,
    data,
  };
}


async function fhirGet(
  path,
  accessToken
) {
  return fhirRequest(
    path,
    accessToken,
    {
      method: "GET",
    }
  );
}


async function fhirPost(
  path,
  accessToken,
  body
) {
  return fhirRequest(
    path,
    accessToken,
    {
      method: "POST",
      body,
    }
  );
}


// ======================================================
// HELPER
// ======================================================

function bundleEntries(
  data
) {
  return Array.isArray(
    data?.entry
  )
    ? data.entry
    : [];
}


function firstCoding(
  concept
) {
  return (
    concept?.coding?.[0] ||
    {}
  );
}


function getPatientName(
  patient
) {
  if (
    patient?.name?.[0]?.text
  ) {
    return patient.name[0].text;
  }

  const name =
    patient?.name?.[0];

  if (!name) {
    return null;
  }

  return [
    ...(name.prefix || []),
    ...(name.given || []),
    name.family || "",
  ]
    .filter(Boolean)
    .join(" ");
}


function getJsonBody(req) {
  if (!req.body) {
    return {};
  }

  if (
    typeof req.body ===
    "object"
  ) {
    return req.body;
  }

  if (
    typeof req.body ===
    "string"
  ) {
    try {
      return JSON.parse(
        req.body
      );
    } catch {
      return {};
    }
  }

  return {};
}


function utcNow() {
  return new Date()
    .toISOString()
    .replace(
      "Z",
      "+00:00"
    );
}


// ======================================================
// MAP ENCOUNTER
// ======================================================

function mapEncounter(
  resource
) {
  const e =
    resource || {};

  return {
    id:
      e.id ?? null,

    identifier:
      e.identifier?.[0]
        ?.value ??
      null,

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

    subject:
      e.subject?.reference ??
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

    participant:
      Array.isArray(
        e.participant
      )
        ? e.participant.map(
            p => ({
              practitioner:
                p.individual
                  ?.display ??
                p.individual
                  ?.reference ??
                null,

              period_start:
                p.period
                  ?.start ??
                null,

              period_end:
                p.period
                  ?.end ??
                null,
            })
          )
        : [],

    diagnosis:
      Array.isArray(
        e.diagnosis
      )
        ? e.diagnosis.map(
            d => ({
              condition:
                d.condition
                  ?.reference ??
                null,

              display:
                d.condition
                  ?.display ??
                null,

              rank:
                d.rank ??
                null,
            })
          )
        : [],
  };
}


// ======================================================
// MAP OBSERVATION
// ======================================================

function mapObservation(
  resource
) {
  const o =
    resource || {};

  const coding =
    firstCoding(
      o.code
    );

  let value = null;
  let unit = null;

  if (
    o.valueQuantity
  ) {
    value =
      o.valueQuantity.value ??
      null;

    unit =
      o.valueQuantity.unit ??
      o.valueQuantity.code ??
      null;
  }

  else if (
    o.valueString !==
    undefined
  ) {
    value =
      o.valueString;
  }

  else if (
    o.valueInteger !==
    undefined
  ) {
    value =
      o.valueInteger;
  }

  else if (
    o.valueBoolean !==
    undefined
  ) {
    value =
      o.valueBoolean;
  }

  else if (
    o.valueCodeableConcept
  ) {
    const c =
      firstCoding(
        o.valueCodeableConcept
      );

    value =
      o.valueCodeableConcept
        .text ??
      c.display ??
      c.code ??
      null;
  }

  const components =
    Array.isArray(
      o.component
    )
      ? o.component.map(
          component => {

            const c =
              firstCoding(
                component.code
              );

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
            }

            else if (
              component
                .valueString !==
              undefined
            ) {
              componentValue =
                component
                  .valueString;
            }

            else if (
              component
                .valueInteger !==
              undefined
            ) {
              componentValue =
                component
                  .valueInteger;
            }

            return {
              code:
                c.code ??
                null,

              display:
                c.display ??
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
      o.id ?? null,

    status:
      o.status ?? null,

    code:
      coding.code ??
      null,

    display:
      coding.display ??
      o.code?.text ??
      null,

    value,

    unit,

    effective:
      o.effectiveDateTime ??
      o.effectiveInstant ??
      null,

    issued:
      o.issued ?? null,

    performer:
      Array.isArray(
        o.performer
      )
        ? o.performer.map(
            p =>
              p.display ??
              p.reference ??
              null
          )
        : [],

    components,
  };
}


// ======================================================
// MAP CONDITION
// ======================================================

function mapCondition(
  resource
) {
  const c =
    resource || {};

  const coding =
    firstCoding(
      c.code
    );

  const clinical =
    firstCoding(
      c.clinicalStatus
    );

  const verification =
    firstCoding(
      c.verificationStatus
    );

  const category =
    firstCoding(
      c.category?.[0]
    );

  return {
    id:
      c.id ?? null,

    code:
      coding.code ??
      null,

    display:
      coding.display ??
      c.code?.text ??
      null,

    system:
      coding.system ??
      null,

    clinical_status:
      clinical.code ??
      null,

    verification_status:
      verification.code ??
      null,

    category:
      category.code ??
      null,

    category_display:
      category.display ??
      c.category?.[0]
        ?.text ??
      null,

    onset:
      c.onsetDateTime ??
      null,

    recorded_date:
      c.recordedDate ??
      null,

    subject:
      c.subject?.reference ??
      null,

    encounter:
      c.encounter?.reference ??
      null,
  };
}


// ======================================================
// MAP PROCEDURE
// ======================================================

function mapProcedure(
  resource
) {
  const p =
    resource || {};

  const coding =
    firstCoding(
      p.code
    );

  return {
    id:
      p.id ?? null,

    status:
      p.status ?? null,

    code:
      coding.code ??
      null,

    display:
      coding.display ??
      p.code?.text ??
      null,

    system:
      coding.system ??
      null,

    subject:
      p.subject?.reference ??
      null,

    encounter:
      p.encounter?.reference ??
      null,

    performed_start:
      p.performedDateTime ??
      p.performedPeriod
        ?.start ??
      null,

    performed_end:
      p.performedPeriod
        ?.end ??
      null,
  };
}


// ======================================================
// MAIN HANDLER
// ======================================================

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (
    req.method ===
    "OPTIONS"
  ) {
    return res
      .status(204)
      .end();
  }

  const action =
    String(
      req.query.action ||
      "token"
    )
      .trim()
      .toLowerCase();

  try {

    // ==================================================
    // CREATE ENCOUNTER
    // ==================================================

    if (
      action ===
      "create_encounter"
    ) {

      if (
        req.method !==
        "POST"
      ) {
        return res
          .status(405)
          .json({
            status: "error",

            message:
              "create_encounter harus menggunakan POST",
          });
      }

      const body =
        getJsonBody(req);

      const patientId =
        String(
          body.patient_id ||
          ""
        ).trim();

      if (!patientId) {
        return res
          .status(400)
          .json({
            status:
              "error",

            message:
              "patient_id wajib diisi",
          });
      }

      const organizationId =
        String(
          body.organization_id ||
          process.env
            .SATUSEHAT_ORGANIZATION_ID ||
          DEFAULT_ORGANIZATION_ID
        ).trim();

      const practitionerId =
        String(
          body.practitioner_id ||
          process.env
            .SATUSEHAT_PRACTITIONER_ID ||
          DEFAULT_PRACTITIONER_ID
        ).trim();

      const locationId =
        String(
          body.location_id ||
          process.env
            .SATUSEHAT_LOCATION_ID ||
          DEFAULT_LOCATION_ID
        ).trim();

      const encounterNumber =
        String(
          body.encounter_number ||
          `FIVECARE-${Date.now()}`
        ).trim();

      const startTime =
        String(
          body.start_time ||
          utcNow()
        ).trim();

      const {
        accessToken,
      } =
        await getToken();

      const encounterPayload = {
        resourceType:
          "Encounter",

        identifier: [
          {
            system:
              `http://sys-ids.kemkes.go.id/encounter/${organizationId}`,

            value:
              encounterNumber,
          },
        ],

        status:
          "arrived",

        statusHistory: [
          {
            status:
              "arrived",

            period: {
              start:
                startTime,
            },
          },
        ],

        class: {
          system:
            "http://terminology.hl7.org/CodeSystem/v3-ActCode",

          code:
            "AMB",

          display:
            "ambulatory",
        },

        classHistory: [
          {
            class: {
              system:
                "http://terminology.hl7.org/CodeSystem/v3-ActCode",

              code:
                "AMB",

              display:
                "ambulatory",
            },

            period: {
              start:
                startTime,
            },
          },
        ],

        subject: {
          reference:
            `Patient/${patientId}`,
        },

        participant: [
          {
            type: [
              {
                coding: [
                  {
                    system:
                      "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",

                    code:
                      "ATND",

                    display:
                      "attender",
                  },
                ],
              },
            ],

            individual: {
              reference:
                `Practitioner/${practitionerId}`,
            },
          },
        ],

        period: {
          start:
            startTime,
        },

        location: [
          {
            location: {
              reference:
                `Location/${locationId}`,
            },

            period: {
              start:
                startTime,
            },
          },
        ],

        serviceProvider: {
          reference:
            `Organization/${organizationId}`,
        },
      };

      const {
        response,
        data,
      } =
        await fhirPost(
          "Encounter",
          accessToken,
          encounterPayload
        );

      if (
        !response.ok
      ) {
        return res
          .status(
            response.status
          )
          .json({
            status:
              "error",

            http_code:
              response.status,

            message:
              "Gagal membuat Encounter di SATUSEHAT",

            response:
              data,

            sent_identifier:
              encounterNumber,
          });
      }

      return res
        .status(201)
        .json({
          status:
            "success",

          message:
            "Encounter berhasil dibuat di SATUSEHAT",

          patient_ihs:
            patientId,

          encounter_id:
            data?.id ??
            null,

          encounter_number:
            encounterNumber,

          organization_id:
            organizationId,

          practitioner_id:
            practitionerId,

          location_id:
            locationId,

          start_time:
            startTime,

          encounter:
            mapEncounter(
              data
            ),
        });
    }

    // ==================================================
// CREATE OBSERVATION
// ==================================================

if (action === "create_observation") {

  if (req.method !== "POST") {
    return res.status(405).json({
      status: "error",
      message: "create_observation harus menggunakan POST",
    });
  }

  const body = getJsonBody(req);

  const patientId =
    String(body.patient_id || "").trim();

  const encounterId =
    String(body.encounter_id || "").trim();

  const practitionerId =
    String(
      body.practitioner_id ||
      process.env.SATUSEHAT_PRACTITIONER_ID ||
      DEFAULT_PRACTITIONER_ID
    ).trim();

  const organizationId =
    String(
      body.organization_id ||
      process.env.SATUSEHAT_ORGANIZATION_ID ||
      DEFAULT_ORGANIZATION_ID
    ).trim();

  const value =
    Number(body.value ?? 80);

  if (!patientId || !encounterId) {
    return res.status(400).json({
      status: "error",
      message: "patient_id dan encounter_id wajib diisi",
    });
  }

  if (!Number.isFinite(value)) {
    return res.status(400).json({
      status: "error",
      message: "value harus berupa angka",
    });
  }

  const observationNumber =
    String(
      body.observation_number ||
      `FIVECARE-OBS-${Date.now()}`
    );

  const observationTime =
    String(
      body.observation_time ||
      utcNow()
    );

  const { accessToken } =
    await getToken();

  const payload = {
    resourceType: "Observation",

    identifier: [
      {
        use: "official",

        system:
          `http://sys-ids.kemkes.go.id/observation/${organizationId}`,

        value:
          observationNumber,
      },
    ],

    status: "final",

    category: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/observation-category",

            code:
              "vital-signs",

            display:
              "Vital Signs",
          },
        ],
      },
    ],

    code: {
      coding: [
        {
          system:
            "http://loinc.org",

          code:
            "8867-4",

          display:
            "Heart rate",
        },
      ],
    },

    subject: {
      reference:
        `Patient/${patientId}`,
    },

    encounter: {
      reference:
        `Encounter/${encounterId}`,
    },

    effectiveDateTime:
      observationTime,

    issued:
      observationTime,

    performer: [
      {
        reference:
          `Practitioner/${practitionerId}`,
      },
    ],

    valueQuantity: {
      value,
      unit:
        "beats/minute",

      system:
        "http://unitsofmeasure.org",

      code:
        "/min",
    },
  };

  const {
    response,
    data,
  } = await fhirPost(
    "Observation",
    accessToken,
    payload
  );

  if (!response.ok) {
    return res.status(response.status).json({
      status: "error",
      http_code: response.status,

      message:
        "Gagal membuat Observation di SATUSEHAT",

      response: data,
    });
  }

  return res.status(201).json({
    status: "success",

    message:
      "Observation berhasil dibuat di SATUSEHAT",

    patient_ihs:
      patientId,

    encounter_id:
      encounterId,

    observation_id:
      data?.id ?? null,

    observation_number:
      observationNumber,

    observation:
      mapObservation(data),
  });
}

    // Semua action berikut adalah GET

    if (
      req.method !==
      "GET"
    ) {
      return res
        .status(405)
        .json({
          status:
            "error",

          message:
            "Method tidak diizinkan",
        });
    }


    // ==================================================
    // TOKEN
    // ==================================================

    if (
      action === "token"
    ) {

      const {
        accessToken,
        tokenInfo,
      } =
        await getToken();

      return res
        .status(200)
        .json({
          status:
            "success",

          message:
            "Koneksi SATUSEHAT berhasil",

          token_status:
            tokenInfo.status ??
            null,

          token_type:
            tokenInfo.token_type ??
            null,

          expires_in:
            tokenInfo.expires_in ??
            null,

          token_length:
            accessToken.length,
        });
    }


    // ==================================================
    // PATIENT
    // ==================================================

    if (
      action ===
      "patient"
    ) {

      const nik =
        String(
          req.query.nik ||
          ""
        ).trim();

      if (
        !/^\d{16}$/.test(
          nik
        )
      ) {
        return res
          .status(400)
          .json({
            status:
              "error",

            message:
              "NIK harus 16 digit",
          });
      }

      const {
        accessToken,
      } =
        await getToken();

      const identifier =
        `https://fhir.kemkes.go.id/id/nik|${nik}`;

      const {
        response,
        data,
      } =
        await fhirGet(
          "Patient?identifier=" +
            encodeURIComponent(
              identifier
            ),
          accessToken
        );

      if (
        !response.ok
      ) {
        return res
          .status(
            response.status
          )
          .json({
            status:
              "error",

            message:
              "Gagal mencari Patient",

            response:
              data,
          });
      }

      const entries =
        bundleEntries(
          data
        );

      if (
        !entries.length
      ) {
        return res
          .status(404)
          .json({
            status:
              "not_found",

            message:
              "Patient tidak ditemukan",

            nik,
          });
      }

      const patient =
        entries[0]
          .resource;

      return res
        .status(200)
        .json({
          status:
            "success",

          message:
            "Patient ditemukan di SATUSEHAT",

          patient: {
            ihs:
              patient.id ??
              null,

            nik,

            name:
              getPatientName(
                patient
              ),

            gender:
              patient.gender ??
              null,

            birthDate:
              patient.birthDate ??
              null,

            active:
              patient.active ??
              null,
          },
        });
    }


    // ==================================================
    // ENCOUNTER
    // ==================================================

    if (
      action ===
      "encounter"
    ) {

      const patientId =
        String(
          req.query
            .patient_id ||
          ""
        ).trim();

      if (!patientId) {
        return res
          .status(400)
          .json({
            status:
              "error",

            message:
              "patient_id wajib diisi",
          });
      }

      const {
        accessToken,
      } =
        await getToken();

      const {
        response,
        data,
      } =
        await fhirGet(
          "Encounter?subject=" +
            encodeURIComponent(
              patientId
            ),
          accessToken
        );

      if (
        !response.ok
      ) {
        return res
          .status(
            response.status
          )
          .json({
            status:
              "error",

            message:
              "Gagal mengambil Encounter",

            response:
              data,
          });
      }

      const encounters =
        bundleEntries(
          data
        ).map(
          entry =>
            mapEncounter(
              entry.resource
            )
        );

      return res
        .status(200)
        .json({
          status:
            encounters.length
              ? "success"
              : "not_found",

          patient_ihs:
            patientId,

          total:
            encounters.length,

          encounters,
        });
    }


    // ==================================================
    // ENCOUNTER DETAIL
    // ==================================================

    if (
      action ===
      "encounter_detail"
    ) {

      const encounterId =
        String(
          req.query
            .encounter_id ||
          ""
        ).trim();

      if (!encounterId) {
        return res
          .status(400)
          .json({
            status:
              "error",

            message:
              "encounter_id wajib diisi",
          });
      }

      const {
        accessToken,
      } =
        await getToken();

      const {
        response,
        data,
      } =
        await fhirGet(
          "Encounter/" +
            encodeURIComponent(
              encounterId
            ),
          accessToken
        );

      if (
        !response.ok
      ) {
        return res
          .status(
            response.status
          )
          .json({
            status:
              "error",

            message:
              "Encounter tidak ditemukan",

            response:
              data,
          });
      }

      return res
        .status(200)
        .json({
          status:
            "success",

          encounter:
            mapEncounter(
              data
            ),
        });
    }


    // ==================================================
    // OBSERVATION
    // ==================================================

    if (
      action ===
      "observation"
    ) {

      const patientId =
        String(
          req.query
            .patient_id ||
          ""
        ).trim();

      const encounterId =
        String(
          req.query
            .encounter_id ||
          ""
        ).trim();

      if (
        !patientId ||
        !encounterId
      ) {
        return res
          .status(400)
          .json({
            status:
              "error",

            message:
              "patient_id dan encounter_id wajib diisi",
          });
      }

      const {
        accessToken,
      } =
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

      const {
        response,
        data,
      } =
        await fhirGet(
          path,
          accessToken
        );

      if (
        !response.ok
      ) {
        return res
          .status(
            response.status
          )
          .json({
            status:
              "error",

            message:
              "Gagal mengambil Observation",

            response:
              data,
          });
      }

      const observations =
        bundleEntries(
          data
        ).map(
          entry =>
            mapObservation(
              entry.resource
            )
        );

      return res
        .status(200)
        .json({
          status:
            observations.length
              ? "success"
              : "not_found",

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
    // CONDITION
    // ==================================================

    if (
      action ===
      "condition"
    ) {

      const patientId =
        String(
          req.query
            .patient_id ||
          ""
        ).trim();

      const encounterId =
        String(
          req.query
            .encounter_id ||
          ""
        ).trim();

      if (
        !patientId ||
        !encounterId
      ) {
        return res
          .status(400)
          .json({
            status:
              "error",

            message:
              "patient_id dan encounter_id wajib diisi",
          });
      }

      const {
        accessToken,
      } =
        await getToken();

      const path =
        "Condition" +
        "?subject=" +
        encodeURIComponent(
          patientId
        ) +
        "&encounter=" +
        encodeURIComponent(
          encounterId
        );

      const {
        response,
        data,
      } =
        await fhirGet(
          path,
          accessToken
        );

      if (
        !response.ok
      ) {
        return res
          .status(
            response.status
          )
          .json({
            status:
              "error",

            message:
              "Gagal mengambil Condition",

            response:
              data,
          });
      }

      const conditions =
        bundleEntries(
          data
        ).map(
          entry =>
            mapCondition(
              entry.resource
            )
        );

      return res
        .status(200)
        .json({
          status:
            conditions.length
              ? "success"
              : "not_found",

          patient_ihs:
            patientId,

          encounter_id:
            encounterId,

          total:
            conditions.length,

          conditions,
        });
    }


    // ==================================================
    // PROCEDURE
    // ==================================================

    if (
      action ===
      "procedure"
    ) {

      const patientId =
        String(
          req.query
            .patient_id ||
          ""
        ).trim();

      const encounterId =
        String(
          req.query
            .encounter_id ||
          ""
        ).trim();

      if (
        !patientId ||
        !encounterId
      ) {
        return res
          .status(400)
          .json({
            status:
              "error",

            message:
              "patient_id dan encounter_id wajib diisi",
          });
      }

      const {
        accessToken,
      } =
        await getToken();

      const path =
        "Procedure" +
        "?subject=" +
        encodeURIComponent(
          patientId
        ) +
        "&encounter=" +
        encodeURIComponent(
          encounterId
        );

      const {
        response,
        data,
      } =
        await fhirGet(
          path,
          accessToken
        );

      if (
        !response.ok
      ) {
        return res
          .status(
            response.status
          )
          .json({
            status:
              "error",

            message:
              "Gagal mengambil Procedure",

            response:
              data,
          });
      }

      const procedures =
        bundleEntries(
          data
        ).map(
          entry =>
            mapProcedure(
              entry.resource
            )
        );

      return res
        .status(200)
        .json({
          status:
            procedures.length
              ? "success"
              : "not_found",

          patient_ihs:
            patientId,

          encounter_id:
            encounterId,

          total:
            procedures.length,

          procedures,
        });
    }


    // ==================================================
    // VISIT
    // ==================================================

    if (
      action ===
      "visit"
    ) {

      const patientId =
        String(
          req.query
            .patient_id ||
          ""
        ).trim();

      const encounterId =
        String(
          req.query
            .encounter_id ||
          ""
        ).trim();

      if (
        !patientId ||
        !encounterId
      ) {
        return res
          .status(400)
          .json({
            status:
              "error",

            message:
              "patient_id dan encounter_id wajib diisi",
          });
      }

      const {
        accessToken,
      } =
        await getToken();

      const observationPath =
        "Observation" +
        "?subject=" +
        encodeURIComponent(
          patientId
        ) +
        "&encounter=" +
        encodeURIComponent(
          encounterId
        );

      const conditionPath =
        "Condition" +
        "?subject=" +
        encodeURIComponent(
          patientId
        ) +
        "&encounter=" +
        encodeURIComponent(
          encounterId
        );

      const procedurePath =
        "Procedure" +
        "?subject=" +
        encodeURIComponent(
          patientId
        ) +
        "&encounter=" +
        encodeURIComponent(
          encounterId
        );

      const [
        encounterResult,
        observationResult,
        conditionResult,
        procedureResult,
      ] =
        await Promise.all([
          fhirGet(
            "Encounter/" +
              encodeURIComponent(
                encounterId
              ),
            accessToken
          ),

          fhirGet(
            observationPath,
            accessToken
          ),

          fhirGet(
            conditionPath,
            accessToken
          ),

          fhirGet(
            procedurePath,
            accessToken
          ),
        ]);

      if (
        !encounterResult
          .response.ok
      ) {
        return res
          .status(
            encounterResult
              .response
              .status
          )
          .json({
            status:
              "error",

            message:
              "Encounter tidak dapat diambil",

            response:
              encounterResult
                .data,
          });
      }

      const observations =
        observationResult
          .response.ok
          ? bundleEntries(
              observationResult
                .data
            ).map(
              entry =>
                mapObservation(
                  entry.resource
                )
            )
          : [];

      const conditions =
        conditionResult
          .response.ok
          ? bundleEntries(
              conditionResult
                .data
            ).map(
              entry =>
                mapCondition(
                  entry.resource
                )
            )
          : [];

      const procedures =
        procedureResult
          .response.ok
          ? bundleEntries(
              procedureResult
                .data
            ).map(
              entry =>
                mapProcedure(
                  entry.resource
                )
            )
          : [];

      return res
        .status(200)
        .json({
          status:
            "success",

          message:
            "Data kunjungan berhasil diambil",

          patient_ihs:
            patientId,

          encounter_id:
            encounterId,

          encounter:
            mapEncounter(
              encounterResult
                .data
            ),

          observation_total:
            observations.length,

          observations,

          condition_total:
            conditions.length,

          conditions,

          procedure_total:
            procedures.length,

          procedures,
        });
    }


    // ==================================================
    // ACTION TIDAK DIKENAL
    // ==================================================

    return res
      .status(400)
      .json({
        status:
          "error",

        message:
          `Action '${action}' tidak dikenal`,

        available_actions: [
          "token",
          "patient",
          "encounter",
          "encounter_detail",
          "observation",
          "condition",
          "procedure",
          "visit",
          "create_encounter",
        ],
      });

  } catch (error) {

    console.error(
      error
    );

    return res
      .status(500)
      .json({
        status:
          "error",

        message:
          error.message ||
          "Internal server error",
      });
  }
}

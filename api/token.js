const SATUSEHAT_BASE =
  "https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1";

const SATUSEHAT_TOKEN_URL =
  "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1/accesstoken?grant_type=client_credentials";


// ======================================================
// TOKEN
// ======================================================

async function getToken() {
  const clientId = process.env.SATUSEHAT_CLIENT_ID;
  const clientSecret = process.env.SATUSEHAT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "SATUSEHAT_CLIENT_ID / SATUSEHAT_CLIENT_SECRET belum diatur di Vercel"
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(SATUSEHAT_TOKEN_URL, {
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
      `Respons token bukan JSON. HTTP ${response.status}: ${text.substring(
        0,
        200
      )}`
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
// FHIR GET
// ======================================================

async function fhirGet(path, accessToken) {
  const url = path.startsWith("http")
    ? path
    : `${SATUSEHAT_BASE}/${path}`;

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
      `Respons FHIR bukan JSON. HTTP ${response.status}: ${text.substring(
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
// HELPER
// ======================================================

function bundleEntries(data) {
  return Array.isArray(data?.entry)
    ? data.entry
    : [];
}


function firstCoding(codeableConcept) {
  return codeableConcept?.coding?.[0] || {};
}


function getPatientName(patient) {
  if (patient?.name?.[0]?.text) {
    return patient.name[0].text;
  }

  const name = patient?.name?.[0];

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


// ======================================================
// MAP ENCOUNTER
// ======================================================

function mapEncounter(resource) {
  const encounter = resource || {};

  return {
    id: encounter.id ?? null,

    status:
      encounter.status ?? null,

    class_code:
      encounter.class?.code ?? null,

    class_display:
      encounter.class?.display ?? null,

    period_start:
      encounter.period?.start ?? null,

    period_end:
      encounter.period?.end ?? null,

    subject:
      encounter.subject?.reference ?? null,

    service_provider:
      encounter.serviceProvider?.display ??
      encounter.serviceProvider?.reference ??
      null,

    location:
      encounter.location?.[0]?.location?.display ??
      encounter.location?.[0]?.location?.reference ??
      null,

    participant:
      Array.isArray(encounter.participant)
        ? encounter.participant.map((p) => ({
            practitioner:
              p.individual?.display ??
              p.individual?.reference ??
              null,

            period_start:
              p.period?.start ?? null,

            period_end:
              p.period?.end ?? null,
          }))
        : [],

    diagnosis:
      Array.isArray(encounter.diagnosis)
        ? encounter.diagnosis.map((d) => ({
            condition:
              d.condition?.reference ??
              null,

            display:
              d.condition?.display ??
              null,

            rank:
              d.rank ?? null,
          }))
        : [],
  };
}


// ======================================================
// MAP OBSERVATION
// ======================================================

function mapObservation(resource) {
  const observation = resource || {};

  const coding =
    firstCoding(observation.code);

  let value = null;
  let unit = null;

  if (observation.valueQuantity) {
    value =
      observation.valueQuantity.value ??
      null;

    unit =
      observation.valueQuantity.unit ??
      observation.valueQuantity.code ??
      null;
  }

  else if (
    observation.valueString !== undefined
  ) {
    value =
      observation.valueString;
  }

  else if (
    observation.valueInteger !== undefined
  ) {
    value =
      observation.valueInteger;
  }

  else if (
    observation.valueBoolean !== undefined
  ) {
    value =
      observation.valueBoolean;
  }

  else if (
    observation.valueCodeableConcept
  ) {
    const valueCoding =
      firstCoding(
        observation.valueCodeableConcept
      );

    value =
      observation
        .valueCodeableConcept
        .text ??
      valueCoding.display ??
      valueCoding.code ??
      null;
  }


  const components =
    Array.isArray(observation.component)
      ? observation.component.map(
          (component) => {

            const componentCoding =
              firstCoding(
                component.code
              );

            let componentValue = null;
            let componentUnit = null;

            if (
              component.valueQuantity
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
              component.valueString !==
              undefined
            ) {
              componentValue =
                component.valueString;
            }

            else if (
              component.valueInteger !==
              undefined
            ) {
              componentValue =
                component.valueInteger;
            }

            return {
              code:
                componentCoding.code ??
                null,

              display:
                componentCoding.display ??
                component.code?.text ??
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
      observation.id ?? null,

    status:
      observation.status ?? null,

    code:
      coding.code ?? null,

    display:
      coding.display ??
      observation.code?.text ??
      null,

    value,

    unit,

    effective:
      observation.effectiveDateTime ??
      observation.effectiveInstant ??
      observation.effectivePeriod?.start ??
      null,

    issued:
      observation.issued ?? null,

    performer:
      Array.isArray(
        observation.performer
      )
        ? observation.performer.map(
            (p) =>
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

function mapCondition(resource) {
  const condition = resource || {};

  const coding =
    firstCoding(condition.code);

  const clinicalCoding =
    firstCoding(
      condition.clinicalStatus
    );

  const verificationCoding =
    firstCoding(
      condition.verificationStatus
    );

  const categoryCoding =
    firstCoding(
      condition.category?.[0]
    );

  return {
    id:
      condition.id ?? null,

    code:
      coding.code ?? null,

    display:
      coding.display ??
      condition.code?.text ??
      null,

    system:
      coding.system ?? null,

    clinical_status:
      clinicalCoding.code ?? null,

    verification_status:
      verificationCoding.code ??
      null,

    category:
      categoryCoding.code ?? null,

    category_display:
      categoryCoding.display ??
      condition.category?.[0]?.text ??
      null,

    onset:
      condition.onsetDateTime ??
      condition.onsetPeriod?.start ??
      null,

    recorded_date:
      condition.recordedDate ?? null,

    subject:
      condition.subject?.reference ??
      null,

    encounter:
      condition.encounter?.reference ??
      null,
  };
}


// ======================================================
// MAP PROCEDURE
// ======================================================

function mapProcedure(resource) {
  const procedure = resource || {};

  const coding =
    firstCoding(procedure.code);

  let performedStart = null;
  let performedEnd = null;

  if (procedure.performedDateTime) {
    performedStart =
      procedure.performedDateTime;
  }

  else if (procedure.performedPeriod) {
    performedStart =
      procedure.performedPeriod.start ??
      null;

    performedEnd =
      procedure.performedPeriod.end ??
      null;
  }

  else if (procedure.performedString) {
    performedStart =
      procedure.performedString;
  }


  return {
    id:
      procedure.id ?? null,

    status:
      procedure.status ?? null,

    code:
      coding.code ?? null,

    display:
      coding.display ??
      procedure.code?.text ??
      null,

    system:
      coding.system ?? null,

    subject:
      procedure.subject?.reference ??
      null,

    encounter:
      procedure.encounter?.reference ??
      null,

    performed_start:
      performedStart,

    performed_end:
      performedEnd,

    performer:
      Array.isArray(procedure.performer)
        ? procedure.performer.map(
            (p) => ({
              actor:
                p.actor?.display ??
                p.actor?.reference ??
                null,

              function:
                firstCoding(
                  p.function
                ).display ??
                p.function?.text ??
                null,
            })
          )
        : [],

    reason:
      Array.isArray(
        procedure.reasonCode
      )
        ? procedure.reasonCode.map(
            (reason) => {

              const rc =
                firstCoding(reason);

              return {
                code:
                  rc.code ?? null,

                display:
                  rc.display ??
                  reason.text ??
                  null,
              };
            }
          )
        : [],
  };
}


// ======================================================
// MAIN
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
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  if (req.method === "OPTIONS") {
    return res
      .status(204)
      .end();
  }


  if (req.method !== "GET") {
    return res.status(405).json({
      status: "error",
      message:
        "Method tidak diizinkan",
    });
  }


  const action =
    String(
      req.query.action || "token"
    )
      .trim()
      .toLowerCase();


  try {

    // ==================================================
    // TOKEN
    // ==================================================

    if (action === "token") {

      const {
        accessToken,
        tokenInfo,
      } = await getToken();


      return res.status(200).json({
        status: "success",

        message:
          "Koneksi SATUSEHAT berhasil",

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
    // PATIENT
    // ==================================================

    if (action === "patient") {

      const nik =
        String(
          req.query.nik || ""
        ).trim();


      if (!/^\d{16}$/.test(nik)) {

        return res
          .status(400)
          .json({
            status: "error",

            message:
              "NIK harus 16 digit angka",
          });
      }


      const {
        accessToken,
      } = await getToken();


      const identifier =
        `https://fhir.kemkes.go.id/id/nik|${nik}`;


      const {
        response,
        data,
      } = await fhirGet(
        "Patient?identifier=" +
          encodeURIComponent(
            identifier
          ),
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
              "Gagal mencari Patient",

            response: data,
          });
      }


      const entries =
        bundleEntries(data);


      if (!entries.length) {

        return res
          .status(404)
          .json({
            status:
              "not_found",

            message:
              "Patient tidak ditemukan di SATUSEHAT",

            nik,
          });
      }


      const patient =
        entries[0].resource;


      return res
        .status(200)
        .json({
          status: "success",

          message:
            "Patient ditemukan di SATUSEHAT",

          patient: {
            ihs:
              patient.id ?? null,

            nik,

            name:
              getPatientName(
                patient
              ),

            gender:
              patient.gender ?? null,

            birthDate:
              patient.birthDate ??
              null,

            active:
              patient.active ?? null,
          },
        });
    }


    // ==================================================
    // ENCOUNTER LIST
    // ==================================================

    if (action === "encounter") {

      const patientId =
        String(
          req.query.patient_id || ""
        ).trim();


      if (!patientId) {

        return res
          .status(400)
          .json({
            status: "error",
            message:
              "patient_id wajib diisi",
          });
      }


      const {
        accessToken,
      } = await getToken();


      const {
        response,
        data,
      } = await fhirGet(
        "Encounter?subject=" +
          encodeURIComponent(
            patientId
          ),
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
        bundleEntries(data);


      const encounters =
        entries.map(
          (entry) =>
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

          message:
            encounters.length
              ? "Encounter berhasil ditemukan"
              : "Belum ada Encounter untuk Patient ini",

          patient_ihs:
            patientId,

          bundle_total:
            data.total ?? null,

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
          req.query.encounter_id ||
            ""
        ).trim();


      if (!encounterId) {

        return res
          .status(400)
          .json({
            status: "error",

            message:
              "encounter_id wajib diisi",
          });
      }


      const {
        accessToken,
      } = await getToken();


      const {
        response,
        data,
      } = await fhirGet(
        "Encounter/" +
          encodeURIComponent(
            encounterId
          ),
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
              "Encounter tidak dapat diambil",

            response: data,
          });
      }


      return res
        .status(200)
        .json({
          status: "success",

          encounter:
            mapEncounter(data),
        });
    }


    // ==================================================
    // OBSERVATION
    // ==================================================

    if (
      action === "observation"
    ) {

      const patientId =
        String(
          req.query.patient_id || ""
        ).trim();

      const encounterId =
        String(
          req.query.encounter_id ||
            ""
        ).trim();


      if (
        !patientId ||
        !encounterId
      ) {

        return res
          .status(400)
          .json({
            status: "error",

            message:
              "patient_id dan encounter_id wajib diisi",
          });
      }


      const {
        accessToken,
      } = await getToken();


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
      } = await fhirGet(
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


      const observations =
        bundleEntries(data).map(
          (entry) =>
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

          message:
            observations.length
              ? "Observation berhasil ditemukan"
              : "Tidak ada Observation pada Encounter ini",

          patient_ihs:
            patientId,

          encounter_id:
            encounterId,

          bundle_total:
            data.total ?? null,

          total:
            observations.length,

          observations,
        });
    }


    // ==================================================
    // CONDITION / DIAGNOSIS
    // ==================================================

    if (
      action === "condition"
    ) {

      const patientId =
        String(
          req.query.patient_id || ""
        ).trim();

      const encounterId =
        String(
          req.query.encounter_id ||
            ""
        ).trim();


      if (
        !patientId ||
        !encounterId
      ) {

        return res
          .status(400)
          .json({
            status: "error",

            message:
              "patient_id dan encounter_id wajib diisi",
          });
      }


      const {
        accessToken,
      } = await getToken();


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
      } = await fhirGet(
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
              "Gagal mengambil Condition",

            response: data,
          });
      }


      const conditions =
        bundleEntries(data).map(
          (entry) =>
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

          message:
            conditions.length
              ? "Condition berhasil ditemukan"
              : "Diagnosis belum ditemukan pada Encounter ini",

          patient_ihs:
            patientId,

          encounter_id:
            encounterId,

          bundle_total:
            data.total ?? null,

          total:
            conditions.length,

          conditions,
        });
    }


    // ==================================================
    // PROCEDURE
    // ==================================================

    if (
      action === "procedure"
    ) {

      const patientId =
        String(
          req.query.patient_id || ""
        ).trim();

      const encounterId =
        String(
          req.query.encounter_id ||
            ""
        ).trim();


      if (
        !patientId ||
        !encounterId
      ) {

        return res
          .status(400)
          .json({
            status: "error",

            message:
              "patient_id dan encounter_id wajib diisi",
          });
      }


      const {
        accessToken,
      } = await getToken();


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
      } = await fhirGet(
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
              "Gagal mengambil Procedure",

            response: data,
          });
      }


      const procedures =
        bundleEntries(data).map(
          (entry) =>
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

          message:
            procedures.length
              ? "Procedure berhasil ditemukan"
              : "Procedure belum ditemukan pada Encounter ini",

          patient_ihs:
            patientId,

          encounter_id:
            encounterId,

          bundle_total:
            data.total ?? null,

          total:
            procedures.length,

          procedures,
        });
    }


    // ==================================================
    // VISIT
    //
    // Mengambil:
    // Encounter
    // Observation
    // Condition
    // Procedure
    //
    // SEKALIGUS
    // ==================================================

    if (action === "visit") {

      const patientId =
        String(
          req.query.patient_id || ""
        ).trim();

      const encounterId =
        String(
          req.query.encounter_id ||
            ""
        ).trim();


      if (
        !patientId ||
        !encounterId
      ) {

        return res
          .status(400)
          .json({
            status: "error",

            message:
              "patient_id dan encounter_id wajib diisi",
          });
      }


      const {
        accessToken,
      } = await getToken();


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
      ] = await Promise.all([
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
              .response.status
          )
          .json({
            status: "error",

            message:
              "Encounter tidak dapat diambil",

            response:
              encounterResult.data,
          });
      }


      const observations =
        observationResult
          .response.ok
          ? bundleEntries(
              observationResult.data
            ).map(
              (entry) =>
                mapObservation(
                  entry.resource
                )
            )
          : [];


      const conditions =
        conditionResult
          .response.ok
          ? bundleEntries(
              conditionResult.data
            ).map(
              (entry) =>
                mapCondition(
                  entry.resource
                )
            )
          : [];


      const procedures =
        procedureResult
          .response.ok
          ? bundleEntries(
              procedureResult.data
            ).map(
              (entry) =>
                mapProcedure(
                  entry.resource
                )
            )
          : [];


      return res
        .status(200)
        .json({
          status: "success",

          message:
            "Data kunjungan berhasil diambil",

          patient_ihs:
            patientId,

          encounter_id:
            encounterId,

          encounter:
            mapEncounter(
              encounterResult.data
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
        status: "error",

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
        ],
      });


  } catch (error) {

    console.error(error);

    return res
      .status(500)
      .json({
        status: "error",

        message:
          error.message ||
          "Internal server error",
      });
  }
}

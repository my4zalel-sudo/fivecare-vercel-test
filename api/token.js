export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const clientId = process.env.SATUSEHAT_CLIENT_ID;
  const clientSecret = process.env.SATUSEHAT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      status: "error",
      message: "Credential SATUSEHAT belum diatur"
    });
  }

  const tokenUrl =
    "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1/accesstoken?grant_type=client_credentials";

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret
  });

  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: body.toString()
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        status: "error",
        http_code: response.status
      });
    }

    return res.status(200).json({
      status: "success",
      http_code: 200,
      token_status: data.status ?? null
    });

  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message
    });
  }
}

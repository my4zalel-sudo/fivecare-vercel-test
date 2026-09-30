export default async function handler(req, res) {
  const clientId = process.env.SATUSEHAT_CLIENT_ID;
  const clientSecret = process.env.SATUSEHAT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      status: "error",
      message: "Credential SATUSEHAT belum diatur"
    });
  }

  const url =
    "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1/accesstoken?grant_type=client_credentials";

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: body.toString()
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = { raw_response: text };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        status: "error",
        http_code: response.status,
        response: data
      });
    }

    return res.status(200).json({
      status: "success",
      http_code: response.status,
      token_status: data.status ?? null,
      token_type: data.token_type ?? null,
      expires_in: data.expires_in ?? null,
      token_length: data.access_token?.length ?? 0
    });

  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message
    });
  }
}

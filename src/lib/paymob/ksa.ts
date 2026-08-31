export type PaymobPackId = "handful" | "chest" | "vault" | "empire";

export const PAYMOB_PACKS: Record<
  PaymobPackId,
  { packId: PaymobPackId; coins: number; amountSar: number; amountHalalas: number; labelAr: string }
> = {
  handful: { packId: "handful", coins: 100, amountSar: 3.99, amountHalalas: 399, labelAr: "حفنة" },
  chest: { packId: "chest", coins: 550, amountSar: 19.99, amountHalalas: 1999, labelAr: "صندوق" },
  vault: { packId: "vault", coins: 1500, amountSar: 49.99, amountHalalas: 4999, labelAr: "خزينة" },
  empire: { packId: "empire", coins: 4000, amountSar: 119.99, amountHalalas: 11999, labelAr: "إمبراطورية" },
};

export function isPaymobPackId(v: string): v is PaymobPackId {
  return v === "handful" || v === "chest" || v === "vault" || v === "empire";
}

export function paymobConfig() {
  const apiKey = String(process.env.PAYMOB_API_KEY || "").trim();
  const secretKey = String(process.env.PAYMOB_SECRET_KEY || "").trim();
  const publicKey = String(process.env.PAYMOB_PUBLIC_KEY || "").trim();
  const intentionAuth = secretKey || apiKey;
  const integrationId = Number(String(process.env.PAYMOB_INTEGRATION_ID || "").trim() || "0");
  const webhookSecret = String(process.env.PAYMOB_WEBHOOK_SECRET || "").trim();
  const merchantName = String(process.env.PAYMOB_MERCHANT_NAME || "layalikashtat").trim();
  const merchantId = String(process.env.PAYMOB_MERCHANT_ID || "17751").trim();
  return { apiKey, secretKey, publicKey, intentionAuth, integrationId, webhookSecret, merchantName, merchantId };
}

export function checkoutUrl(clientSecret: string) {
  const { publicKey } = paymobConfig();
  const secret = encodeURIComponent(clientSecret);
  // Official Unified Checkout requires publicKey + clientSecret.
  if (publicKey) {
    return `https://ksa.paymob.com/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${secret}`;
  }
  return `https://ksa.paymob.com/unifiedcheckout/?client_secret=${secret}`;
}

export function isPaidStatus(status: string) {
  const s = String(status || "").toLowerCase();
  return ["succeeded", "success", "completed", "paid"].includes(s);
}

function providerErrorMessage(data: Record<string, unknown>) {
  const detail = data.detail ?? data.message ?? data.title ?? data.errors ?? data.non_field_errors;
  if (typeof detail === "string" && detail.trim()) return detail.trim().slice(0, 240);
  if (detail != null) {
    try {
      return JSON.stringify(detail).slice(0, 240);
    } catch {
      return "";
    }
  }
  return "";
}

type IntentionBilling = {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
};

export async function createIntention(input: {
  amountHalalas: number;
  currency?: string;
  description: string;
  billing: IntentionBilling;
  specialReference?: string;
}) {
  const { intentionAuth, integrationId } = paymobConfig();
  if (!intentionAuth) return { ok: false as const, error: "missing_api_key" as const };
  if (!Number.isFinite(integrationId) || integrationId <= 0) {
    return { ok: false as const, error: "missing_integration_id" as const };
  }

  const amount = Math.max(1, Math.round(Number(input.amountHalalas) || 0));
  const description = String(input.description || "لحظاتك").trim() || "لحظاتك";
  const body = {
    amount,
    currency: String(input.currency || "SAR").toUpperCase(),
    payment_methods: [integrationId],
    billing_data: {
      first_name: input.billing.first_name || "Lahza",
      last_name: input.billing.last_name || "User",
      email: input.billing.email || "customer@lahzha.com",
      phone_number: input.billing.phone_number || "966500000000",
      street: "Customer Street",
      building: "1",
      floor: "1",
      apartment: "1",
      city: "Riyadh",
      country: "SAU",
      postal_code: "11564",
      state: "Riyadh",
      shipping_method: "PICKUP",
    },
    items: [
      {
        name: description.slice(0, 50),
        amount,
        description: description.slice(0, 120),
        quantity: 1,
      },
    ],
    description,
    ...(input.specialReference ? { special_reference: input.specialReference } : {}),
  };

  async function post(authHeader: string) {
    return fetch("https://ksa.paymob.com/v1/intention/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });
  }

  let res = await post(`Token ${intentionAuth}`);
  if (res.status === 401 || res.status === 403) {
    res = await post(`Bearer ${intentionAuth}`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false as const,
      error: "provider_error" as const,
      message: providerErrorMessage(data) || `Paymob HTTP ${res.status}`,
      details: data,
      status: res.status,
    };
  }

  const clientSecret = String(data.client_secret || data.clientSecret || "").trim();
  const intentionId = String(data.id || "").trim();
  if (!clientSecret || !intentionId) {
    return {
      ok: false as const,
      error: "no_client_secret" as const,
      message: "بايموب ما رجّع رابط دفع.",
      details: data,
    };
  }

  return {
    ok: true as const,
    clientSecret,
    intentionId,
    status: String(data.status || ""),
    raw: data,
  };
}

export async function getIntention(intentionId: string) {
  const { intentionAuth } = paymobConfig();
  if (!intentionAuth) return { ok: false as const, error: "missing_api_key" as const };

  async function get(authHeader: string) {
    return fetch(`https://ksa.paymob.com/v1/intention/${encodeURIComponent(intentionId)}/`, {
      headers: { Authorization: authHeader },
    });
  }

  let res = await get(`Token ${intentionAuth}`);
  if (res.status === 401 || res.status === 403) {
    res = await get(`Bearer ${intentionAuth}`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false as const,
      error: "provider_error" as const,
      message: providerErrorMessage(data) || `Paymob HTTP ${res.status}`,
      details: data,
      status: res.status,
    };
  }
  return {
    ok: true as const,
    status: String(data.status || ""),
    amount: Number(data.amount ?? NaN),
    currency: String(data.currency || ""),
    raw: data,
  };
}

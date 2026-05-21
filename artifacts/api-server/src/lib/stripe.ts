// Stripe integration via Replit Connectors
import Stripe from "stripe";

async function getCredentials() {
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? "repl " + process.env["REPL_IDENTITY"]
    : process.env["WEB_REPL_RENEWAL"]
      ? "depl " + process.env["WEB_REPL_RENEWAL"]
      : null;

  if (!hostname || !xReplitToken) return null;

  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    });
    const data = (await response.json()) as { items?: Array<{ settings: { publishable: string; secret: string } }> };
    const settings = data.items?.[0]?.settings;
    if (!settings?.secret) return null;
    return { publishableKey: settings.publishable, secretKey: settings.secret };
  } catch {
    return null;
  }
}

// WARNING: Never cache this client — tokens expire.
export async function getUncachableStripeClient(): Promise<Stripe | null> {
  const creds = await getCredentials();
  if (!creds) return null;
  return new Stripe(creds.secretKey, { apiVersion: "2025-11-17.clover" });
}

export async function getStripePublishableKey(): Promise<string | null> {
  const creds = await getCredentials();
  return creds?.publishableKey ?? null;
}

import type { Request } from "express";

import { isIP } from "node:net";

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (isIP(host) === 4) return host.split(".")[0] === "127";
  return false;
}

export function getLicenseHost(req: Request): string | null {
  const configuredHost = process.env.LICENSE_HOST?.trim();
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.FORCE_HTTPS === "true";

  if (!configuredHost) {
    return isProduction ? null : req.hostname.toLowerCase();
  }

  try {
    const url = new URL(`http://${configuredHost}`);
    if (
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }
    if (isProduction && isLoopbackHostname(url.hostname)) return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

import { LicenseConfig, LicenseErrorCode } from "@shared/api";
import crypto from "node:crypto";
import { getLicenseByKeyDb, getPrimaryLicenseDb, updateLicenseHostDb } from "../store/db";
import {
  getDeploymentId,
  getInstallationId,
  getInstalledLicenseId,
  getPendingMigrationAt,
  loadOnlineLicenseStatus,
  saveOnlineLicenseStatus,
  clearPendingMigration,
  hasInstalledSignedLicense,
  loadInstalledCertificate,
  loadLegacyActivation,
  saveLegacyActivation,
  verifyLicenseCertificate,
} from "./signed-license";

export interface LicenseValidationResult {
  valid: boolean;
  message: string;
  errorCode?: LicenseErrorCode;
  licensee?: string;
  mode?: "active" | "grace" | "restricted";
  warning?: string;
  licenseId?: string;
  installationId?: string;
  expiresAt?: number | null;
  host?: string;
}

const recentValidationEvents = new Map<string, number>();

export function recordLicenseValidationEvent(result: LicenseValidationResult): void {
  if (result.valid && result.mode !== "grace") return;
  const code = result.errorCode || result.mode || "invalid";
  const now = Date.now();
  if (now - (recentValidationEvents.get(code) || 0) < 60 * 60 * 1000) return;
  recentValidationEvents.set(code, now);
  console.warn(`[License] Validation event ${code}: ${result.message}`);
}

function gracePeriodDays(): number {
  const configuredDays = Number.parseInt(process.env.LICENSE_GRACE_PERIOD_DAYS || "30", 10);
  return Number.isSafeInteger(configuredDays) && configuredDays >= 0 ? configuredDays : 30;
}

async function migrationResult(message: string, licensee: string): Promise<LicenseValidationResult | null> {
  const pendingAt = await getPendingMigrationAt();
  if (!pendingAt) return null;
  const graceDays = gracePeriodDays();
  const warning = `Issuer approval is required within ${graceDays} days. Existing case and queue operations remain available.`;
  return Date.now() < pendingAt + graceDays * 24 * 60 * 60 * 1000
    ? { valid: true, mode: "grace", message, warning, licensee }
    : { valid: false, mode: "restricted", message, warning, errorCode: "LICENSE_GRACE_RESTRICTED", licensee };
}

function expirationResult(expiresAt: number | null, licensee: string): LicenseValidationResult | null {
  if (!expiresAt || Date.now() < expiresAt) return null;
  const graceDays = gracePeriodDays();
  const warning = "Existing case and queue operations remain available while the license is renewed.";
  if (Date.now() < expiresAt + graceDays * 24 * 60 * 60 * 1000) {
    return {
      valid: true,
      mode: "grace",
      message: `License expired on ${new Date(expiresAt).toLocaleDateString()}.`,
      warning: `Renewal or migration approval is required within ${graceDays} days.`,
      licensee,
    };
  }
  return {
    valid: false,
    mode: "restricted",
    message: "The license has expired. Existing case and queue operations remain available while the license is renewed.",
    warning,
    errorCode: "LICENSE_EXPIRED",
    licensee,
  };
}

/**
 * Validates a license key
 *
 * Checks against the database first, then falls back to environment variables.
 * Returns validation result with:
 * - valid: whether the license is valid
 * - message: human-readable message
 * - licensee: name of the licensee (if valid)
 */
/**
 * Validates a license key
 *
 * Checks all three must match to bypass: Entered Key == Environment Key == Database Key
 * Once activated and bound to the host, it bypasses permanently.
 *
 * @param host - The current server host/domain
 * @param licenseKey - The key entered by the user (if any)
 */
const ONLINE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function onlineCheckUrl(): string | null {
  const configured = process.env.LICENSE_ISSUER_URL?.trim();
  if (!configured) return null;
  const url = new URL(configured);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username || url.password || url.search || url.hash ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  ) throw new Error("LICENSE_ISSUER_URL must be a valid HTTPS base URL in production.");
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/api/license/check`;
  return url.toString();
}

function onlineOutageResult(payload: NonNullable<ReturnType<typeof verifyLicenseCertificate>>, failureStartedAt: number, checkedAt: number, now = Date.now()): LicenseValidationResult {
  const graceMs = gracePeriodDays() * 24 * 60 * 60 * 1000;
  const expiryGraceEnd = payload.expiresAt === null ? Number.POSITIVE_INFINITY : payload.expiresAt + graceMs;
  const graceEndsAt = Math.min(failureStartedAt + graceMs, expiryGraceEnd);
  if (now < graceEndsAt) {
    return {
      valid: true,
      mode: "grace",
      message: `Unable to reach the license issuer. Last verified ${new Date(checkedAt).toLocaleDateString()}.`,
      warning: `Reconnect to the license issuer within ${Math.max(0, Math.ceil((graceEndsAt - now) / (24 * 60 * 60 * 1000)))} days. Existing case and queue operations remain available.`,
      licensee: payload.licensee,
      licenseId: payload.licenseId,
      installationId: payload.installationId,
      expiresAt: payload.expiresAt,
      host: payload.host,
    };
  }
  return {
    valid: false,
    mode: "restricted",
    message: "The license issuer has been unreachable beyond the allowed offline period.",
    warning: "Reconnect to the license issuer to restore full access. Existing case and queue operations remain available.",
    errorCode: "LICENSE_ONLINE_CHECK_REQUIRED",
    licensee: payload.licensee,
    licenseId: payload.licenseId,
  };
}

function onlineStatusResult(status: string, licensee: string, licenseId: string): LicenseValidationResult | null {
  if (status === "active") return null;
  if (status === "expired") return null;
  if (status === "revoked") return {
    valid: false,
    mode: "restricted",
    message: "This license has been revoked. Contact the license issuer.",
    errorCode: "LICENSE_REVOKED",
    licensee,
    licenseId,
  };
  if (status === "superseded") return {
    valid: false,
    mode: "restricted",
    message: "This license has been replaced. Install the latest approved license.",
    errorCode: "LICENSE_SUPERSEDED",
    licensee,
    licenseId,
  };
  return {
    valid: false,
    mode: "restricted",
    message: "The issuer could not find this license. Contact the license issuer.",
    errorCode: "LICENSE_NOT_FOUND",
    licensee,
    licenseId,
  };
}

async function validateOnlineLicense(certificate: { payload: string; signature: string }, payload: NonNullable<ReturnType<typeof verifyLicenseCertificate>>): Promise<LicenseValidationResult | null> {
  let url: string | null;
  try {
    url = onlineCheckUrl();
  } catch (error) {
    return {
      valid: false,
      mode: "restricted",
      message: error instanceof Error ? error.message : "Online license configuration is invalid.",
      errorCode: "LICENSE_ONLINE_CHECK_REQUIRED",
      licensee: payload.licensee,
      licenseId: payload.licenseId,
    };
  }
  if (!url) return null;

  const cached = await loadOnlineLicenseStatus();
  if (cached?.licenseId === payload.licenseId && Date.now() - cached.lastAttemptAt < ONLINE_CHECK_INTERVAL_MS) {
    return cached.status === "unavailable"
      ? onlineOutageResult(payload, cached.failureStartedAt ?? cached.lastAttemptAt, cached.checkedAt)
      : onlineStatusResult(cached.status, payload.licensee, payload.licenseId);
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ certificate }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Issuer returned HTTP ${response.status}`);
    const result = await response.json() as { status?: string; licenseId?: string; expiresAt?: number | null };
    if (
      !["active", "revoked", "superseded", "expired", "not_found"].includes(result.status ?? "") ||
      result.licenseId !== payload.licenseId ||
      !(result.expiresAt === null || (typeof result.expiresAt === "number" && Number.isFinite(result.expiresAt))) ||
      (result.expiresAt === null ? payload.expiresAt !== null : payload.expiresAt === null || Math.abs(result.expiresAt - payload.expiresAt) > 1)
    ) throw new Error("Issuer returned an invalid license status.");
    const status = result.status as "active" | "revoked" | "superseded" | "expired" | "not_found";
    const now = Date.now();
    await saveOnlineLicenseStatus({ licenseId: payload.licenseId, status, checkedAt: now, lastAttemptAt: now, failureStartedAt: null, expiresAt: result.expiresAt ?? null });
    return onlineStatusResult(status, payload.licensee, payload.licenseId);
  } catch (error) {
    console.warn("[License] Online status check failed:", error instanceof Error ? error.message : error);
    if (cached?.licenseId === payload.licenseId && cached.status !== "active" && cached.status !== "unavailable") {
      return onlineStatusResult(cached.status, payload.licensee, payload.licenseId);
    }
    const now = Date.now();
    const failureStartedAt = cached?.licenseId === payload.licenseId
      ? cached.status === "unavailable" && cached.failureStartedAt !== null
        ? cached.failureStartedAt
        : cached.status === "active"
          ? cached.checkedAt
          : payload.issuedAt
      : payload.issuedAt;
    const unavailable = {
      licenseId: payload.licenseId,
      status: "unavailable" as const,
      checkedAt: cached?.licenseId === payload.licenseId ? cached.checkedAt : payload.issuedAt,
      lastAttemptAt: now,
      failureStartedAt,
      expiresAt: payload.expiresAt,
    };
    await saveOnlineLicenseStatus(unavailable).catch((cacheError) => {
      console.warn("[License] Could not persist online outage state:", cacheError);
    });
    return onlineOutageResult(payload, failureStartedAt, unavailable.checkedAt, now);
  }
}

export async function validateLicense(host: string, licenseKey?: string): Promise<LicenseValidationResult> {
  let certificate;
  try {
    certificate = await loadInstalledCertificate();
  } catch {
    return { valid: false, mode: "restricted", message: "The local license file could not be read. Contact the system administrator for recovery.", warning: "Existing case and queue operations remain available during recovery.", errorCode: "LICENSE_STORAGE_ERROR" };
  }
  if (certificate) {
    const payload = verifyLicenseCertificate(certificate);
    if (!payload) {
      return { valid: false, mode: "restricted", message: "The installed license file is invalid or not trusted.", warning: "Contact the license issuer for a verified replacement.", errorCode: "LICENSE_CERTIFICATE_INVALID" };
    }
    let installationId: string;
    let deploymentId: string;
    let installedLicenseId: string | null;
    try {
      [installationId, deploymentId, installedLicenseId] = await Promise.all([getInstallationId(), getDeploymentId(), getInstalledLicenseId()]);
    } catch {
      return { valid: false, mode: "restricted", message: "The installation identity could not be read. Contact the system administrator for recovery.", warning: "Existing case and queue operations remain available during recovery.", errorCode: "LICENSE_STORAGE_ERROR" };
    }
    if (installedLicenseId && payload.licenseId !== installedLicenseId) {
      return { valid: false, mode: "restricted", message: "The installed license file is older than the latest approved license.", warning: "Upload the latest approved license file. Existing case and queue operations remain available.", errorCode: "LICENSE_CERTIFICATE_ROLLBACK" };
    }
    if (payload.installationId !== installationId || payload.deploymentId !== deploymentId) {
      const message = "This license belongs to a different installation. Request reactivation.";
      return await migrationResult(message, payload.licensee) ?? { valid: false, mode: "restricted", message, warning: "Existing case and queue operations remain available while this installation is reactivated.", errorCode: "LICENSE_IDENTITY_MISMATCH" };
    }
    if (payload.host !== host) {
      const message = "This license is registered to a different domain. Request reactivation.";
      return await migrationResult(message, payload.licensee) ?? { valid: false, mode: "restricted", message, warning: "Existing case and queue operations remain available while this installation is reactivated.", errorCode: "LICENSE_HOST_MISMATCH" };
    }
    await clearPendingMigration().catch((error) => {
      console.warn("[License] Could not clear completed migration state:", error);
    });
    const licenseInfo = { licenseId: payload.licenseId, installationId, expiresAt: payload.expiresAt, host };
    const onlineResult = await validateOnlineLicense(certificate, payload);
    if (onlineResult) return { ...onlineResult, ...licenseInfo };
    const expired = expirationResult(payload.expiresAt, payload.licensee);
    if (expired) return { ...expired, ...licenseInfo };
    return { valid: true, mode: "active", message: `Licensed to ${payload.licensee}`, licensee: payload.licensee, ...licenseInfo };
  }

  try {
    if (await hasInstalledSignedLicense()) {
      return { valid: false, mode: "restricted", message: "The installed signed license file is missing. Restore it from backup or request a replacement.", warning: "Existing case and queue operations remain available during recovery.", errorCode: "LICENSE_STORAGE_ERROR" };
    }
  } catch {
    const legacyKey = (process.env.LICENSE_KEY || "").trim();
    const legacyActivation = legacyKey ? await loadLegacyActivation(legacyKey, host) : null;
    if (legacyActivation) {
      return expirationResult(legacyActivation.expiresAt, legacyActivation.licensee) ?? {
        valid: true,
        mode: "active",
        message: `Licensed to ${legacyActivation.licensee}`,
        licensee: legacyActivation.licensee,
        licenseId: legacyActivation.licenseId,
        expiresAt: legacyActivation.expiresAt,
        host,
      };
    }
    return { valid: false, message: "The installation identity could not be read, and no recoverable activation record was found.", errorCode: "LICENSE_STORAGE_ERROR" };
  }

  const envLicenseKey = (process.env.LICENSE_KEY || "").trim();
  if (!envLicenseKey) {
    return { valid: false, message: "Enter an approved license file or legacy license key to activate STC.", errorCode: "LICENSE_NOT_PROVIDED" };
  }

  if (!licenseKey) {
    const persisted = await loadLegacyActivation(envLicenseKey, host);
    if (persisted) {
      return expirationResult(persisted.expiresAt, persisted.licensee) ?? { valid: true, mode: "active", message: `Licensed to ${persisted.licensee}`, licensee: persisted.licensee, licenseId: persisted.licenseId, expiresAt: persisted.expiresAt, host };
    }
    const priorActivation = await loadLegacyActivation(envLicenseKey);
    if (priorActivation && priorActivation.host !== host) {
      const message = "This legacy license is bound to a different server installation. Request issuer-approved reactivation.";
      return await migrationResult(message, priorActivation.licensee) ?? { valid: false, mode: "restricted", message, warning: "Existing case and queue operations remain available while this installation is reactivated.", errorCode: "LICENSE_HOST_MISMATCH" };
    }
  } else if (licenseKey.trim() !== envLicenseKey) {
    return { valid: false, message: "Invalid license key provided.", errorCode: "LICENSE_MISMATCH" };
  }

  try {
    const dbLicense = await getLicenseByKeyDb(envLicenseKey);
    if (!dbLicense) {
      return { valid: false, message: "This legacy license was not found in the database.", errorCode: "LICENSE_NOT_FOUND" };
    }
    if (dbLicense.status !== "active") {
      return { valid: false, message: "This legacy license is not active.", errorCode: "LICENSE_INVALID_STATUS" };
    }
    const expired = expirationResult(dbLicense.expiresAt, dbLicense.licensee || "STC");
    if (expired) {
      if (expired.mode === "restricted") return expired;
    }
    const persistedLegacy = await loadLegacyActivation(envLicenseKey);
    const boundHost = dbLicense.activatedHost || persistedLegacy?.host;
    if (boundHost && boundHost !== host) {
      const message = "This license is bound to a different server installation. Request issuer-approved reactivation.";
      return await migrationResult(message, dbLicense.licensee || "STC") ?? { valid: false, mode: "restricted", message, warning: "Existing case and queue operations remain available while this installation is reactivated.", errorCode: "LICENSE_HOST_MISMATCH" };
    }
    if (!dbLicense.activatedHost) {
      const claimed = await updateLicenseHostDb(dbLicense.id, host);
      if (!claimed) {
        const current = await getLicenseByKeyDb(envLicenseKey);
        if (current?.activatedHost !== host) {
          return { valid: false, message: "This license is bound to a different server installation.", errorCode: "LICENSE_HOST_MISMATCH" };
        }
      }
    }
    const licenseKeyHash = crypto.createHash("sha256").update(envLicenseKey).digest("hex");
    await saveLegacyActivation({ licenseKeyHash, licenseId: dbLicense.id, host, licensee: dbLicense.licensee || "STC", expiresAt: dbLicense.expiresAt }).catch((error) => {
      console.warn("[License] Could not persist the legacy activation outside the database:", error);
    });
    return expired
      ? { ...expired, licenseId: dbLicense.id, expiresAt: dbLicense.expiresAt, installationId: await getInstallationId(), host }
      : { valid: true, mode: "active", message: `Licensed to ${dbLicense.licensee || "STC"}`, licensee: dbLicense.licensee || "STC", licenseId: dbLicense.id, expiresAt: dbLicense.expiresAt, installationId: await getInstallationId(), host };
  } catch (error) {
    const persisted = await loadLegacyActivation(envLicenseKey, host);
    if (persisted) {
      return expirationResult(persisted.expiresAt, persisted.licensee) ?? { valid: true, mode: "active", message: `Licensed to ${persisted.licensee}`, licensee: persisted.licensee, licenseId: persisted.licenseId, expiresAt: persisted.expiresAt, host };
    }
    console.error("[License] Legacy activation verification failed:", error);
    return { valid: false, message: "Unable to verify this legacy license. Restore its database record or import a signed license.", errorCode: "LICENSE_DB_ERROR" };
  }
}

/**
 * Gets the currently configured license info (for admin purposes)
 * Returns the license record from database
 */
export async function getLicenseInfo(): Promise<LicenseConfig | null> {
  // Try database first to get the primary active license
  try {
    const dbLicense = await getPrimaryLicenseDb();
    if (dbLicense) {
      return {
        licenseKey: dbLicense.licenseKey,
        licensee: dbLicense.licensee,
        expiresAt: dbLicense.expiresAt || undefined,
      };
    }
  } catch (error) {
    console.warn("[License] Failed to get primary license from DB:", error);
  }

  return null;
}

import { LicenseConfig, LicenseErrorCode } from "@shared/api";
import crypto from "node:crypto";
import { getLicenseByKeyDb, getPrimaryLicenseDb, updateLicenseHostDb } from "../store/db";
import {
  getDeploymentId,
  getInstallationId,
  getPendingMigrationAt,
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
    const [installationId, deploymentId] = await Promise.all([getInstallationId(), getDeploymentId()]);
    if (payload.installationId !== installationId || payload.deploymentId !== deploymentId) {
      const message = "This license belongs to a different installation. Request reactivation.";
      return await migrationResult(message, payload.licensee) ?? { valid: false, mode: "restricted", message, warning: "Existing case and queue operations remain available while this installation is reactivated.", errorCode: "LICENSE_IDENTITY_MISMATCH" };
    }
    if (payload.host !== host) {
      const message = "This license is registered to a different domain. Request reactivation.";
      return await migrationResult(message, payload.licensee) ?? { valid: false, mode: "restricted", message, warning: "Existing case and queue operations remain available while this installation is reactivated.", errorCode: "LICENSE_HOST_MISMATCH" };
    }
    const licenseInfo = { licenseId: payload.licenseId, installationId, expiresAt: payload.expiresAt, host };
    const expired = expirationResult(payload.expiresAt, payload.licensee);
    if (expired) return { ...expired, ...licenseInfo };
    return { valid: true, mode: "active", message: `Licensed to ${payload.licensee}`, licensee: payload.licensee, ...licenseInfo };
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
    if (dbLicense.activatedHost && dbLicense.activatedHost !== host) {
      return { valid: false, message: "This license is bound to a different server installation.", errorCode: "LICENSE_HOST_MISMATCH" };
    }
    if (!dbLicense.activatedHost) await updateLicenseHostDb(dbLicense.id, host);
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

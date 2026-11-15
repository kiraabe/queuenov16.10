import { LicenseErrorCode } from "@shared/api";

/**
 * User-friendly error messages for license error codes
 * Keeps sensitive information server-side while providing clear feedback
 */
const LICENSE_ERROR_MESSAGES: Record<LicenseErrorCode, string> = {
  LICENSE_CONFIG_MISSING: "Server configuration error. Please contact support.",
  LICENSE_NOT_PROVIDED: "Enter your license key to activate the application.",
  LICENSE_MISMATCH: "This license key is not valid. Please check and try again.",
  LICENSE_NOT_FOUND: "This license key was not found. Please check and try again.",
  LICENSE_INVALID_STATUS: "This license is not active. Please contact support.",
  LICENSE_EXPIRED: "This license has expired. Please renew to continue using the application.",
  LICENSE_HOST_MISMATCH: "This license is bound to a different server. Please contact support.",
  LICENSE_DB_ERROR: "Unable to verify this legacy license. Restore its database record or import a signed license.",
  LICENSE_CERTIFICATE_INVALID: "The license file is invalid or signed by an untrusted key. Contact the license issuer.",
  LICENSE_IDENTITY_MISMATCH: "This license belongs to a different installation. Request an approved reactivation.",
  LICENSE_STORAGE_ERROR: "The license could not be saved. Contact your system administrator.",
  LICENSE_GRACE_RESTRICTED: "The license recovery period has ended. Existing records and queue operations remain available; contact the license issuer.",
  LICENSE_CERTIFICATE_ROLLBACK: "This file is older than the current license and cannot replace it. Request the latest approved license file.",
};

/**
 * Get a user-friendly error message for a license error code
 * Falls back to generic message if code is unknown
 */
export function getLicenseErrorMessage(
  errorCode?: LicenseErrorCode,
  fallbackMessage?: string
): string {
  if (!errorCode) {
    return fallbackMessage || "License verification failed. Please try again.";
  }

  return LICENSE_ERROR_MESSAGES[errorCode] || fallbackMessage || "An error occurred during license verification.";
}

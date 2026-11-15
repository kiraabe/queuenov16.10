import crypto from "crypto";
import { RequestHandler } from "express";
import { ValidateLicenseResponse } from "@shared/api";
import { createLicenseCertificate, isActivationRequest, isLicenseIssuerEnabled } from "../services/signed-license";
import { createLicenseIssuanceDb, listLicenseIssuancesDb, updateLicenseIssuanceStatusDb } from "../store/db";
import {
  createLicenseDb,
  getLicenseKeyDb,
  listLicensesDb,
  updateLicenseStatusDb,
  deleteLicenseDb,
  LicenseRecord,
} from "../store/db";

const LICENSE_UNLOCK_TTL_MS = 15 * 60 * 1000;
const LICENSE_UNLOCK_HEADER = "x-licenses-unlock";

export const licenseCapabilitiesHandler: RequestHandler = (_req, res) => {
  res.json({
    issuerEnabled: isLicenseIssuerEnabled(),
    legacyIssuanceEnabled: isLicenseIssuerEnabled() && process.env.LICENSE_LEGACY_ISSUANCE_ENABLED === "true",
  });
};

function unlockSigningSecret(): string {
  const secret = process.env.APP_SECRET || process.env.AUTH_SECRET;
  if (!secret) throw new Error("APP_SECRET or AUTH_SECRET must be configured");
  return secret;
}

function signLicenseUnlock(userId: string, expiresAt: number): string {
  const payload = `${userId}.${expiresAt}`;
  const signature = crypto
    .createHmac("sha256", unlockSigningSecret())
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

function isValidLicenseUnlock(token: string, userId: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokenUserId, expiresAtRaw, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (tokenUserId !== userId || !Number.isFinite(expiresAt)) return false;
  if (expiresAt < Date.now()) return false;

  const expected = signLicenseUnlock(userId, expiresAt).split(".")[2];
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const verifyLicensesPinHandler: RequestHandler = (req, res) => {
  const configuredPin = process.env.LICENSES_PIN;
  if (!configuredPin) {
    return res.status(503).json({
      success: false,
      message: "Licenses PIN is not configured on the server",
    });
  }

  const submittedPin = typeof req.body?.pin === "string" ? req.body.pin : "";
  const pinHash = crypto.createHash("sha256").update(submittedPin).digest();
  const expectedHash = crypto.createHash("sha256").update(configuredPin).digest();

  if (!crypto.timingSafeEqual(pinHash, expectedHash)) {
    return res.status(401).json({
      success: false,
      message: "Incorrect PIN. Please try again.",
    });
  }

  const userId = (req as any).auth?.id as string;
  const expiresAt = Date.now() + LICENSE_UNLOCK_TTL_MS;
  res.json({
    success: true,
    token: signLicenseUnlock(userId, expiresAt),
    expiresAt,
  });
};

export const requireLicensesUnlock: RequestHandler = (req, res, next) => {
  const token = req.get(LICENSE_UNLOCK_HEADER);
  const userId = (req as any).auth?.id as string | undefined;

  if (!token || !userId || !isValidLicenseUnlock(token, userId)) {
    return res.status(403).json({
      success: false,
      message: "Licenses are locked. Enter the PIN to continue.",
    });
  }
  next();
};

interface CreateLicenseRequest {
  licensee?: unknown;
  expiresAt?: unknown;
  notes?: unknown;
}

export const createSignedLicenseHandler: RequestHandler = async (req, res) => {
  try {
    const { activationRequest, licensee: rawLicensee, expiresAt: rawExpiresAt, notes: rawNotes, supersedesLicenseId: rawSupersedes, migrationReason: rawReason } = req.body ?? {};
    if (!isActivationRequest(activationRequest)) {
      return res.status(400).json({ success: false, message: "Upload a valid STC activation request." });
    }
    const licensee = typeof rawLicensee === "string" ? rawLicensee.trim() : "";
    const notes = typeof rawNotes === "string" ? rawNotes.trim() : "";
    const migrationReason = typeof rawReason === "string" ? rawReason.trim() : "";
    const supersedesLicenseId = typeof rawSupersedes === "string" && rawSupersedes.trim() ? rawSupersedes.trim() : null;
    const expiresAt = rawExpiresAt === null || rawExpiresAt === undefined || rawExpiresAt === "" ? null : rawExpiresAt;
    if (!licensee || licensee.length > 200 || notes.length > 1000 || migrationReason.length > 500) {
      return res.status(400).json({ success: false, message: "Enter a valid licensee and keep notes within the allowed length." });
    }
    if (supersedesLicenseId && !migrationReason) {
      return res.status(400).json({ success: false, message: "Enter the reason for replacing or reissuing this license." });
    }
    if (expiresAt !== null && (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) {
      return res.status(400).json({ success: false, message: "Expiration must be a future date." });
    }
    const certificate = createLicenseCertificate({
      installationId: activationRequest.installationId,
      deploymentId: activationRequest.deploymentId,
      host: activationRequest.host,
      licensee,
      expiresAt: expiresAt as number | null,
      supersedesLicenseId,
    });
    const payload = JSON.parse(Buffer.from(certificate.payload, "base64url").toString("utf8"));
    await createLicenseIssuanceDb({
      licenseId: payload.licenseId,
      installationId: activationRequest.installationId,
      deploymentId: activationRequest.deploymentId,
      licensee,
      certificate,
      expiresAt: payload.expiresAt,
      createdByUserId: (req as any).auth?.id ?? null,
      notes: notes || null,
      supersedesLicenseId,
      migrationReason: migrationReason || null,
    });
    res.status(201).json({ success: true, certificate, license: payload });
  } catch (error) {
    console.error("[License Management] Signed license issue error:", error);
    const message = error instanceof Error && error.message.includes("active license")
      ? error.message
      : "Failed to issue signed license.";
    res.status(400).json({ success: false, message });
  }
};

export const listSignedLicensesHandler: RequestHandler = async (_req, res) => {
  try {
    res.json({ licenses: await listLicenseIssuancesDb() });
  } catch (error) {
    console.error("[License Management] Signed license list error:", error);
    res.status(500).json({ success: false, message: "Failed to load issued licenses." });
  }
};

export const revokeSignedLicenseHandler: RequestHandler = async (req, res) => {
  try {
    const revoked = await updateLicenseIssuanceStatusDb(req.params.licenseId, "revoked");
    if (!revoked) return res.status(404).json({ success: false, message: "Issued license not found." });
    res.json({ success: true, message: "License marked revoked in issuer records. Offline installations require a replacement or update to receive revocation." });
  } catch (error) {
    console.error("[License Management] Signed license revocation error:", error);
    res.status(500).json({ success: false, message: "Failed to revoke issued license." });
  }
};

interface CreateLicenseResponse {
  success: boolean;
  message: string;
  license?: LicenseRecord;
}

interface ListLicensesResponse {
  licenses: LicenseRecord[];
}

interface UpdateLicenseStatusRequest {
  status: "active" | "inactive" | "expired" | "revoked";
}

interface UpdateLicenseStatusResponse {
  success: boolean;
  message: string;
  license?: LicenseRecord;
}

interface DeleteLicenseResponse {
  success: boolean;
  message: string;
}

/**
 * Create a new license
 */
export const createLicenseHandler: RequestHandler = async (req, res) => {
  if (process.env.LICENSE_LEGACY_ISSUANCE_ENABLED !== "true") {
    return res.status(404).json({ success: false, message: "Unsigned legacy license generation is disabled." });
  }
  try {
    const body = (req.body ?? {}) as CreateLicenseRequest;
    const licensee = typeof body.licensee === "string" ? body.licensee.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const expiresAt = body.expiresAt;

    if (!licensee || licensee.length > 200) {
      return res.status(400).json({
        success: false,
        message: "Enter a licensee name of 1 to 200 characters.",
      });
    }

    if (notes.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Notes must be 1000 characters or fewer.",
      });
    }

    if (
      expiresAt !== undefined &&
      expiresAt !== null &&
      (typeof expiresAt !== "number" ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= Date.now())
    ) {
      return res.status(400).json({
        success: false,
        message: "Expiration must be a future date.",
      });
    }

    const licenseKey = crypto.randomBytes(16).toString("hex").toUpperCase().match(/.{4}/gu)!.join("-");
    const userId = (req as any).userId || null;

    const license = await createLicenseDb(
      licenseKey,
      licensee,
      userId,
      (expiresAt as number | null | undefined) ?? null,
      notes || null,
    );

    const response: CreateLicenseResponse = {
      success: true,
      message: `License created for ${licensee}`,
      license,
    };

    res.status(201).json(response);
  } catch (error) {
    console.error("[License Management] Create error:", error);

    // Check for duplicate key error
    if (error instanceof Error && error.message.includes("duplicate")) {
      return res.status(409).json({
        success: false,
        message: "License key already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create license",
    });
  }
};

/**
 * List all licenses
 */
export const getLicenseKeyHandler: RequestHandler = async (req, res) => {
  try {
    const licenseKey = await getLicenseKeyDb(req.params.licenseId);
    if (!licenseKey) {
      return res.status(404).json({
        success: false,
        message: "License not found",
      });
    }
    res.json({ licenseKey });
  } catch (error) {
    console.error("[License Management] Key retrieval error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve license key",
    });
  }
};

export const listLicensesHandler: RequestHandler = async (req, res) => {
  try {
    const licenses = await listLicensesDb();

    const response: ListLicensesResponse = {
      licenses,
    };

    res.json(response);
  } catch (error) {
    console.error("[License Management] List error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to list licenses",
    });
  }
};

/**
 * Update license status
 */
export const updateLicenseStatusHandler: RequestHandler = async (req, res) => {
  try {
    const { licenseId } = req.params;
    const { status } = req.body as UpdateLicenseStatusRequest;

    // Validation
    const validStatuses = ["active", "inactive", "expired", "revoked"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const license = await updateLicenseStatusDb(
      licenseId,
      status as "active" | "inactive" | "expired" | "revoked",
    );

    if (!license) {
      return res.status(404).json({
        success: false,
        message: "License not found",
      });
    }

    const response: UpdateLicenseStatusResponse = {
      success: true,
      message: `License status updated to ${status}`,
      license,
    };

    res.json(response);
  } catch (error) {
    console.error("[License Management] Update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update license",
    });
  }
};

/**
 * Delete a license
 */
export const deleteLicenseHandler: RequestHandler = async (req, res) => {
  try {
    const { licenseId } = req.params;

    const deleted = await deleteLicenseDb(licenseId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "License not found",
      });
    }

    const response: DeleteLicenseResponse = {
      success: true,
      message: "License deleted successfully",
    };

    res.json(response);
  } catch (error) {
    console.error("[License Management] Delete error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete license",
    });
  }
};

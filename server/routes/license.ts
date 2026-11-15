import { RequestHandler } from "express";
import { ValidateLicenseRequest, ValidateLicenseResponse } from "@shared/api";
import { recordLicenseValidationEvent, validateLicense } from "../services/license-service";
import { createActivationRequest, getDeploymentId, getInstallationId, isLicenseIssuerEnabled, loadInstalledCertificate, saveInstalledCertificate, verifyLicenseCertificate } from "../services/signed-license";
import { getLicenseIssuanceForCheckDb } from "../store/db";
import { getLicenseHost } from "../utils/license-host";

export const onlineLicenseCheckHandler: RequestHandler = async (req, res) => {
  if (!isLicenseIssuerEnabled()) {
    return res.status(404).json({ status: "unavailable" });
  }

  const certificate = req.body?.certificate;
  const payload = verifyLicenseCertificate(certificate);
  if (!payload) return res.status(400).json({ status: "invalid" });

  try {
    const issuance = await getLicenseIssuanceForCheckDb(payload.licenseId);
    if (
      !issuance ||
      issuance.installationId !== payload.installationId ||
      issuance.deploymentId !== payload.deploymentId ||
      issuance.licensee !== payload.licensee ||
      (issuance.expiresAt === null ? payload.expiresAt !== null : payload.expiresAt === null || Math.abs(issuance.expiresAt - payload.expiresAt) > 1) ||
      issuance.certificate?.payload !== certificate.payload ||
      issuance.certificate?.signature !== certificate.signature
    ) {
      return res.json({ status: "not_found" });
    }

    const status = issuance.status === "active" && issuance.expiresAt !== null && Date.now() >= issuance.expiresAt
      ? "expired"
      : issuance.status;
    res.json({ status, licenseId: payload.licenseId, licensee: payload.licensee, expiresAt: issuance.expiresAt });
  } catch (error) {
    console.error("[License] Online status lookup failed:", error);
    res.status(503).json({ status: "unavailable" });
  }
};

export const validateLicenseHandler: RequestHandler = async (req, res) => {
  try {
    const { licenseKey } = req.body as ValidateLicenseRequest;

    const host = getLicenseHost(req);
    if (!host) {
      return res.status(503).json({
        valid: false,
        message: "The licensed server hostname is not configured.",
        errorCode: "LICENSE_HOST_CONFIG_MISSING",
      });
    }

    if (!licenseKey || typeof licenseKey !== "string") {
      return res.status(400).json({
        valid: false,
        message: "Enter your license key to activate the application.",
        errorCode: "LICENSE_NOT_PROVIDED",
      });
    }

    const result = await validateLicense(host, licenseKey);
    recordLicenseValidationEvent(result);
    const response: ValidateLicenseResponse = {
      valid: result.valid,
      message: result.message,
      errorCode: result.errorCode,
      licensee: result.valid && result.mode === "active" ? result.licensee : undefined,
      mode: result.mode,
      warning: result.warning,
    };

    res.json(response);
  } catch (error) {
    console.error("[License] Validation error:", error);
    res.status(500).json({
      valid: false,
      message: "License validation failed",
    });
  }
};

export const createActivationRequestHandler: RequestHandler = async (req, res) => {
  try {
    const host = getLicenseHost(req);
    if (!host) return res.status(503).json({ success: false, message: "The licensed server hostname is not configured." });
    const activationRequest = await createActivationRequest(host);
    res.json({ success: true, activationRequest });
  } catch (error) {
    console.error("[License] Activation request creation failed:", error);
    res.status(500).json({ success: false, message: "Unable to create an activation request. Check persistent license storage." });
  }
};

export const importLicenseCertificateHandler: RequestHandler = async (req, res) => {
  try {
    const certificate = req.body?.certificate;
    const payload = verifyLicenseCertificate(certificate);
    if (!payload) return res.status(400).json({ valid: false, message: "The license file is invalid or signed by an untrusted key.", errorCode: "LICENSE_CERTIFICATE_INVALID" });
    const host = getLicenseHost(req);
    if (!host) return res.status(503).json({ valid: false, message: "The licensed server hostname is not configured.", errorCode: "LICENSE_HOST_CONFIG_MISSING" });
    const installationId = await getInstallationId();
    if (payload.installationId !== installationId || payload.deploymentId !== (await getDeploymentId())) {
      return res.status(400).json({ valid: false, message: "This license was issued for a different STC installation.", errorCode: "LICENSE_IDENTITY_MISMATCH" });
    }
    if (payload.host !== host) return res.status(400).json({ valid: false, message: "This license was issued for a different domain. Request an approved replacement.", errorCode: "LICENSE_HOST_MISMATCH" });
    if (payload.expiresAt && Date.now() >= payload.expiresAt) return res.status(400).json({ valid: false, message: "This license has expired. Request a renewed license.", errorCode: "LICENSE_EXPIRED" });
    await saveInstalledCertificate(certificate);
    res.json({ valid: true, message: `Licensed to ${payload.licensee}`, licensee: payload.licensee, mode: "active" });
  } catch (error) {
    console.error("[License] License file import failed:", error);
    if (error instanceof Error && error.message.includes("installed license")) {
      return res.status(409).json({ valid: false, message: error.message, errorCode: "LICENSE_CERTIFICATE_ROLLBACK" });
    }
    res.status(500).json({ valid: false, message: "Unable to save the license file. Check persistent license storage.", errorCode: "LICENSE_STORAGE_ERROR" });
  }
};

export const getLocalLicenseInfoHandler: RequestHandler = async (req, res) => {
  try {
    const host = getLicenseHost(req);
    if (!host) return res.status(503).json({ success: false, message: "The licensed server hostname is not configured." });
    const [result, installationId, certificate] = await Promise.all([
      validateLicense(host),
      getInstallationId(),
      loadInstalledCertificate(),
    ]);
    const payload = certificate ? verifyLicenseCertificate(certificate) : null;
    res.json({
      ...result,
      host,
      installationId,
      licenseId: payload?.licenseId ?? result.licenseId,
      expiresAt: payload?.expiresAt ?? result.expiresAt ?? null,
    });
  } catch (error) {
    console.error("[License] Admin license information check failed:", error);
    res.status(500).json({ success: false, message: "License information is unavailable." });
  }
};

export const checkLicenseStatusHandler: RequestHandler = async (req, res) => {
  try {
    const host = getLicenseHost(req);
    if (!host) {
      return res.status(503).json({
        valid: false,
        message: "The licensed server hostname is not configured.",
        errorCode: "LICENSE_HOST_CONFIG_MISSING",
      });
    }

    const result = await validateLicense(host);
    recordLicenseValidationEvent(result);
    const response: ValidateLicenseResponse = {
      valid: result.valid,
      message: result.message,
      errorCode: result.errorCode,
      licensee: result.valid && result.mode === "active" ? result.licensee : undefined,
      mode: result.mode,
      warning: result.warning,
    };

    res.json(response);
  } catch (error) {
    console.error("[License] Status check error:", error);
    res.status(500).json({
      valid: false,
      message: "License status check failed",
    });
  }
};

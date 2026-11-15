import type { RequestHandler } from "express";
import { isLicenseIssuerEnabled } from "../services/signed-license";

export const requireLicenseIssuer: RequestHandler = (_req, res, next) => {
  if (!isLicenseIssuerEnabled()) {
    return res.status(404).json({ success: false, message: "License issuing is unavailable in this installation." });
  }
  next();
};

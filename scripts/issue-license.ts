import { readFileSync, writeFileSync } from "node:fs";
import { createLicenseCertificate, isActivationRequest } from "../server/services/signed-license";
import { createLicenseIssuanceDb } from "../server/store/db";

const [requestPath, outputPath = "data/issued-license.json", supersedesLicenseId = null] = process.argv.slice(2);
if (!requestPath) throw new Error("Usage: tsx scripts/issue-license.ts <activation-request.json> [output.json] [supersedes-license-id]");

const request: unknown = JSON.parse(readFileSync(requestPath, "utf8"));
if (!isActivationRequest(request)) throw new Error("The file is not a valid activation request.");

const licensee = "STC Dev Test";
const certificate = createLicenseCertificate({
  installationId: request.installationId,
  deploymentId: request.deploymentId,
  host: request.host,
  licensee,
  expiresAt: null,
  supersedesLicenseId,
});

const payload = JSON.parse(Buffer.from(certificate.payload, "base64url").toString("utf8"));
await createLicenseIssuanceDb({
  licenseId: payload.licenseId,
  installationId: payload.installationId,
  deploymentId: payload.deploymentId,
  licensee,
  certificate,
  expiresAt: null,
  createdByUserId: null,
  notes: "Issued with scripts/issue-license.ts",
  supersedesLicenseId,
  migrationReason: null,
});

writeFileSync(outputPath, JSON.stringify(certificate, null, 2));
console.log(`License ${payload.licenseId} recorded in the database and written to ${outputPath}`);
process.exit(0);

import { readFileSync, writeFileSync } from "node:fs";
import { createLicenseCertificate, isActivationRequest } from "../server/services/signed-license";

const [requestPath, outputPath = "issued-license.json", supersedesLicenseId = null] = process.argv.slice(2);
if (!requestPath) throw new Error("Usage: tsx scripts/issue-license.ts <activation-request.json> [output.json] [supersedes-license-id]");

const request: unknown = JSON.parse(readFileSync(requestPath, "utf8"));
if (!isActivationRequest(request)) throw new Error("The file is not a valid activation request.");

const certificate = createLicenseCertificate({
  installationId: request.installationId,
  deploymentId: request.deploymentId,
  host: request.host,
  licensee: "STC Dev Test",
  expiresAt: null,
  supersedesLicenseId,
});

writeFileSync(outputPath, JSON.stringify(certificate, null, 2));
console.log(`License written to ${outputPath}`);

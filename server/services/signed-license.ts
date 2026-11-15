import crypto from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ActivationRequest {
  version: 1;
  installationId: string;
  deploymentId: string;
  host: string;
  createdAt: number;
}

export interface LicenseCertificatePayload {
  version: 1;
  licenseId: string;
  installationId: string;
  deploymentId: string;
  host: string;
  licensee: string;
  supersedesLicenseId: string | null;
  product: "STC";
  issuedAt: number;
  expiresAt: number | null;
  keyId: string;
}

export interface LicenseCertificate {
  payload: string;
  signature: string;
}

const LICENSE_STATE_DIR = process.env.LICENSE_STATE_DIR || path.resolve(process.cwd(), ".stc-license");
const IDENTITY_PATH = path.join(LICENSE_STATE_DIR, "installation.json");
const CERTIFICATE_PATH = path.join(LICENSE_STATE_DIR, "license.json");
const LEGACY_ACTIVATION_PATH = path.join(LICENSE_STATE_DIR, "legacy-activation.json");

function signingPrivateKey(): crypto.KeyObject {
  const rawKey = process.env.LICENSE_SIGNING_PRIVATE_KEY?.replace(/\\n/gu, "\n");
  if (!rawKey) throw new Error("The issuer signing key is not configured.");
  return crypto.createPrivateKey(rawKey);
}

function trustedPublicKey(keyId: string): crypto.KeyObject | null {
  const configured = process.env.LICENSE_TRUSTED_PUBLIC_KEYS;
  if (!configured) return null;

  const keys = JSON.parse(configured) as Record<string, string>;
  const rawKey = keys[keyId];
  return rawKey ? crypto.createPublicKey(rawKey.replace(/\\n/gu, "\n")) : null;
}

export function isLicenseIssuerEnabled(): boolean {
  if (process.env.LICENSE_ISSUER_ENABLED !== "true" || !process.env.LICENSE_SIGNING_KEY_ID?.trim() || !process.env.LICENSE_SIGNING_PRIVATE_KEY?.trim()) return false;
  try {
    const message = Buffer.from("STC issuer key configuration check");
    const signature = crypto.sign(null, message, signingPrivateKey());
    const publicKey = trustedPublicKey(process.env.LICENSE_SIGNING_KEY_ID.trim());
    return Boolean(publicKey && crypto.verify(null, message, publicKey, signature));
  } catch {
    return false;
  }
}

function parseCertificatePayload(payload: string): LicenseCertificatePayload | null {
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<LicenseCertificatePayload>;
    if (
      value.version !== 1 ||
      value.product !== "STC" ||
      typeof value.licenseId !== "string" ||
      typeof value.installationId !== "string" ||
      typeof value.deploymentId !== "string" ||
      typeof value.host !== "string" ||
      typeof value.licensee !== "string" ||
      typeof value.keyId !== "string" ||
      !value.keyId ||
      typeof value.issuedAt !== "number" ||
      !Number.isFinite(value.issuedAt) ||
      !(value.expiresAt === null || (typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt))) ||
      !(value.supersedesLicenseId === null || typeof value.supersedesLicenseId === "string")
    ) return null;
    return value as LicenseCertificatePayload;
  } catch {
    return null;
  }
}

export function createLicenseCertificate(input: {
  installationId: string;
  deploymentId: string;
  host: string;
  licensee: string;
  expiresAt: number | null;
  supersedesLicenseId: string | null;
}): LicenseCertificate {
  if (!isLicenseIssuerEnabled()) throw new Error("License issuing is not enabled in this environment.");
  const keyId = process.env.LICENSE_SIGNING_KEY_ID!.trim();
  const payload: LicenseCertificatePayload = {
    version: 1,
    licenseId: crypto.randomUUID(),
    installationId: input.installationId,
    deploymentId: input.deploymentId,
    host: input.host,
    licensee: input.licensee,
    supersedesLicenseId: input.supersedesLicenseId,
    product: "STC",
    issuedAt: Date.now(),
    expiresAt: input.expiresAt,
    keyId,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.sign(null, Buffer.from(encodedPayload), signingPrivateKey()).toString("base64url");
  const certificate = { payload: encodedPayload, signature };
  if (!verifyLicenseCertificate(certificate)) {
    throw new Error("The current signing key does not match a trusted public key.");
  }
  return certificate;
}

export function verifyLicenseCertificate(value: unknown): LicenseCertificatePayload | null {
  if (!value || typeof value !== "object") return null;
  const certificate = value as Partial<LicenseCertificate>;
  if (typeof certificate.payload !== "string" || typeof certificate.signature !== "string") return null;

  const payload = parseCertificatePayload(certificate.payload);
  if (!payload) return null;

  try {
    const publicKey = trustedPublicKey(payload.keyId);
    if (!publicKey) return null;
    const signature = Buffer.from(certificate.signature, "base64url");
    if (!crypto.verify(null, Buffer.from(certificate.payload), publicKey, signature)) return null;
    return payload;
  } catch {
    return null;
  }
}

interface InstallationIdentity {
  installationId: string;
  deploymentId: string;
  pendingMigrationAt?: number;
  installedLicenseId?: string;
  installedLicenseIssuedAt?: number;
}

async function readInstallationIdentity(): Promise<InstallationIdentity> {
  await mkdir(LICENSE_STATE_DIR, { recursive: true, mode: 0o700 });
  try {
    const state = JSON.parse(await readFile(IDENTITY_PATH, "utf8")) as { installationId?: unknown; deploymentId?: unknown; pendingMigrationAt?: unknown };
    if (typeof state.installationId === "string" && typeof state.deploymentId === "string") return state as InstallationIdentity;
    throw new Error("The stored installation identity is invalid.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const identity = { installationId: crypto.randomUUID(), deploymentId: crypto.randomUUID() };
  try {
    await writeFile(IDENTITY_PATH, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
    return identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return JSON.parse(await readFile(IDENTITY_PATH, "utf8")) as InstallationIdentity;
  }
}

export function isActivationRequest(value: unknown): value is ActivationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<ActivationRequest>;
  if (request.version !== 1 ||
    typeof request.installationId !== "string" ||
    typeof request.deploymentId !== "string" ||
    typeof request.host !== "string" ||
    typeof request.createdAt !== "number" ||
    !Number.isFinite(request.createdAt) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(request.installationId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(request.deploymentId) ||
    !request.host ||
    request.host.length > 253 ||
    request.host !== request.host.trim() ||
    /[\s/@\\]/u.test(request.host)) return false;
  return true;
}

export async function createActivationRequest(host: string): Promise<ActivationRequest> {
  const identity = await readInstallationIdentity();
  const certificate = await loadInstalledCertificate().catch(() => null);
  const payload = certificate ? verifyLicenseCertificate(certificate) : null;
  const legacyKey = process.env.LICENSE_KEY?.trim();
  const legacyActivation = legacyKey ? await loadLegacyActivation(legacyKey) : null;
  if (
    (payload && (payload.installationId !== identity.installationId || payload.deploymentId !== identity.deploymentId || payload.host !== host)) ||
    (legacyActivation && legacyActivation.host !== host)
  ) {
    identity.pendingMigrationAt ??= Date.now();
    const temporaryPath = `${IDENTITY_PATH}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
    await rename(temporaryPath, IDENTITY_PATH);
  }
  return {
    version: 1,
    installationId: identity.installationId,
    deploymentId: identity.deploymentId,
    host,
    createdAt: Date.now(),
  };
}

export async function getInstallationId(): Promise<string> {
  return (await readInstallationIdentity()).installationId;
}

export async function getDeploymentId(): Promise<string> {
  return (await readInstallationIdentity()).deploymentId;
}

export async function getPendingMigrationAt(): Promise<number | null> {
  const value = (await readInstallationIdentity()).pendingMigrationAt;
  return typeof value === "number" ? value : null;
}

export async function clearPendingMigration(): Promise<void> {
  const identity = await readInstallationIdentity();
  if (!identity.pendingMigrationAt) return;
  delete identity.pendingMigrationAt;
  const temporaryPath = `${IDENTITY_PATH}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, IDENTITY_PATH);
}

export async function hasInstalledSignedLicense(): Promise<boolean> {
  return Boolean((await readInstallationIdentity()).installedLicenseId);
}

export async function getInstalledLicenseId(): Promise<string | null> {
  return (await readInstallationIdentity()).installedLicenseId ?? null;
}

export async function loadInstalledCertificate(): Promise<LicenseCertificate | null> {
  try {
    return JSON.parse(await readFile(CERTIFICATE_PATH, "utf8")) as LicenseCertificate;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function saveInstalledCertificate(certificate: LicenseCertificate): Promise<void> {
  const payload = verifyLicenseCertificate(certificate);
  if (!payload) throw new Error("The license certificate is not trusted.");
  await mkdir(LICENSE_STATE_DIR, { recursive: true, mode: 0o700 });
  const identity = await readInstallationIdentity();
  if (
    identity.installedLicenseId &&
    payload.licenseId !== identity.installedLicenseId &&
    payload.supersedesLicenseId !== identity.installedLicenseId
  ) {
    throw new Error("This license would replace a newer installed license without superseding it.");
  }
  if (identity.installedLicenseIssuedAt && payload.issuedAt < identity.installedLicenseIssuedAt) {
    throw new Error("This license is older than the latest installed license.");
  }
  identity.installedLicenseId = payload.licenseId;
  identity.installedLicenseIssuedAt = payload.issuedAt;
  delete identity.pendingMigrationAt;
  const identityTemporaryPath = `${IDENTITY_PATH}.${crypto.randomUUID()}.tmp`;
  await writeFile(identityTemporaryPath, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
  await rename(identityTemporaryPath, IDENTITY_PATH);
  await unlink(LEGACY_ACTIVATION_PATH).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
  const temporaryPath = `${CERTIFICATE_PATH}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(certificate), { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, CERTIFICATE_PATH);
}

interface LegacyActivation {
  licenseKeyHash: string;
  licenseId: string;
  host: string;
  licensee: string;
  expiresAt: number | null;
  signature: string;
}

export async function saveLegacyActivation(value: Omit<LegacyActivation, "signature">): Promise<void> {
  const secret = process.env.APP_SECRET || process.env.AUTH_SECRET;
  if (!secret) return;
  const payload = JSON.stringify(value);
  const state: LegacyActivation = {
    ...value,
    signature: crypto.createHmac("sha256", secret).update(payload).digest("base64url"),
  };
  await mkdir(LICENSE_STATE_DIR, { recursive: true, mode: 0o700 });
  const temporaryPath = `${LEGACY_ACTIVATION_PATH}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state), { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, LEGACY_ACTIVATION_PATH);
}

export async function loadLegacyActivation(licenseKey: string, host?: string): Promise<Omit<LegacyActivation, "signature"> | null> {
  const secret = process.env.APP_SECRET || process.env.AUTH_SECRET;
  if (!secret) return null;
  try {
    const state = JSON.parse(await readFile(LEGACY_ACTIVATION_PATH, "utf8")) as LegacyActivation;
    const { signature, ...value } = state;
    const expected = crypto.createHmac("sha256", secret).update(JSON.stringify(value)).digest();
    const actual = Buffer.from(signature, "base64url");
    const keyHash = crypto.createHash("sha256").update(licenseKey.trim()).digest("hex");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    if (value.licenseKeyHash !== keyHash || (host !== undefined && value.host !== host)) return null;
    return value;
  } catch {
    return null;
  }
}

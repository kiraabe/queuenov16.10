import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface ActivationRequest {
  version: 1;
  installationId: string;
  deploymentId: string;
  host: string;
  createdAt: number;
}

interface IssuedLicense {
  licenseId: string;
  installationId: string;
  deploymentId: string;
  previousInstallationId: string | null;
  previousDeploymentId: string | null;
  licensee: string;
  status: "active" | "superseded" | "revoked";
  expiresAt: number | null;
  createdAt: number;
  notes: string | null;
  supersedesLicenseId: string | null;
  migrationReason: string | null;
}

export default function SignedLicenseIssuance({ unlockToken }: { unlockToken: string }) {
  const [activationRequest, setActivationRequest] = useState<ActivationRequest | null>(null);
  const [licenses, setLicenses] = useState<IssuedLicense[]>([]);
  const [licensee, setLicensee] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [supersedesLicenseId, setSupersedesLicenseId] = useState("");
  const [migrationReason, setMigrationReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const headers = { "X-Requested-With": "XMLHttpRequest", "X-Licenses-Unlock": unlockToken };

  const loadLicenses = async () => {
    const response = await fetch("/api/admin/licenses/issued", { headers });
    if (!response.ok) throw new Error("Could not load signed license history.");
    const data = await response.json();
    setLicenses(data.licenses);
  };

  useEffect(() => {
    loadLicenses().catch((error) => toast.error(error.message));
  }, []);

  const handleRequestFile = async (file?: File) => {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as ActivationRequest;
      if (value.version !== 1 || !value.installationId || !value.deploymentId || !value.host) {
        throw new Error("This is not a valid STC activation request.");
      }
      setActivationRequest(value);
    } catch (error) {
      setActivationRequest(null);
      toast.error(error instanceof Error ? error.message : "Could not read activation request.");
    }
  };

  const handleIssue = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activationRequest || !licensee.trim()) return;
    setIsSubmitting(true);
    try {
      const expiresAt = expiresOn ? new Date(`${expiresOn}T23:59:59.999`).getTime() : null;
      const response = await fetch("/api/admin/licenses/issue", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          activationRequest,
          licensee: licensee.trim(),
          expiresAt,
          notes: notes.trim(),
          supersedesLicenseId: supersedesLicenseId.trim() || null,
          migrationReason: migrationReason.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not issue the license.");
      const link = document.createElement("a");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data.certificate, null, 2)], { type: "application/json" }));
      link.href = url;
      link.download = `STC-License-${data.license.licenseId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Signed license issued and downloaded.");
      setActivationRequest(null);
      setLicensee("");
      setExpiresOn("");
      setNotes("");
      setSupersedesLicenseId("");
      setMigrationReason("");
      await loadLicenses();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not issue the license.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (licenseId: string) => {
    if (!confirm("Mark this license revoked in issuer records? Offline installations will need a replacement or update to receive the revocation.")) return;
    try {
      const response = await fetch(`/api/admin/licenses/issued/${encodeURIComponent(licenseId)}/revoke`, {
        method: "PUT",
        headers,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not revoke the license.");
      toast.success(data.message);
      await loadLicenses();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke the license.");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Issue Signed License</CardTitle>
          <CardDescription>Import a sub-city activation request, approve it, and send the downloaded license file back for local activation.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleIssue} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="activation-request">Activation request file</Label>
              <Input id="activation-request" type="file" accept="application/json,.json" onChange={(event) => handleRequestFile(event.target.files?.[0])} disabled={isSubmitting} />
              {activationRequest && <p className="text-sm text-muted-foreground">Installation {activationRequest.installationId} · {activationRequest.host}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="signed-licensee">Sub-city / licensee</Label>
              <Input id="signed-licensee" value={licensee} onChange={(event) => setLicensee(event.target.value)} maxLength={200} required disabled={isSubmitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signed-license-expiry">Expiry date</Label>
              <Input id="signed-license-expiry" type="date" min={new Date().toISOString().slice(0, 10)} value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} disabled={isSubmitting} />
              <p className="text-xs text-muted-foreground">Leave blank for a license that does not expire.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supersedes-license">Existing license ID to replace (optional)</Label>
              <Input id="supersedes-license" value={supersedesLicenseId} onChange={(event) => setSupersedesLicenseId(event.target.value)} disabled={isSubmitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="migration-reason">Renewal or migration reason</Label>
              <Input id="migration-reason" value={migrationReason} onChange={(event) => setMigrationReason(event.target.value)} maxLength={500} disabled={isSubmitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signed-license-notes">Internal notes</Label>
              <Textarea id="signed-license-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} disabled={isSubmitting} />
            </div>
            <Button type="submit" disabled={!activationRequest || !licensee.trim() || isSubmitting}>{isSubmitting ? "Issuing..." : "Approve and Issue License"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Issuance and Migration History</CardTitle>
          <CardDescription>Revocation is recorded here; disconnected installations receive it only when they apply an update or replacement.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {licenses.length === 0 ? <p className="text-sm text-muted-foreground">No signed licenses issued yet.</p> : licenses.map((license) => (
            <div key={license.licenseId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{license.licensee} · {license.status}</p>
                <p className="break-all text-xs text-muted-foreground">License {license.licenseId} · Installation {license.installationId}</p>
                <p className="text-xs text-muted-foreground">Issued {new Date(license.createdAt).toLocaleDateString()}{license.expiresAt ? ` · Expires ${new Date(license.expiresAt).toLocaleDateString()}` : " · No expiry"}{license.migrationReason ? ` · ${license.migrationReason}` : ""}</p>
              </div>
              {license.status === "active" && <Button type="button" size="sm" variant="destructive" onClick={() => handleRevoke(license.licenseId)}>Revoke</Button>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

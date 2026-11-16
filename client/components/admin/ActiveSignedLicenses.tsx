import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { IssuedLicense } from "./SignedLicenseIssuance";

export default function ActiveSignedLicenses({ unlockToken, refreshKey, onChange }: { unlockToken: string; refreshKey: number; onChange: () => void }) {
  const [licenses, setLicenses] = useState<IssuedLicense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const headers = { "X-Requested-With": "XMLHttpRequest", "X-Licenses-Unlock": unlockToken };

  const loadLicenses = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/licenses/issued", { headers });
      if (!response.ok) throw new Error("Could not load signed licenses.");
      const data = await response.json();
      setLicenses(data.licenses.filter((license: IssuedLicense) => license.status === "active"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load signed licenses.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLicenses();
  }, [refreshKey]);

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
      onChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke the license.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Licenses ({licenses.length})</CardTitle>
        <CardDescription>Signed licenses currently bound to an installation.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading signed licenses...</p>
        ) : licenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active signed licenses.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Licensee</TableHead>
                  <TableHead>Installation</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {licenses.map((license) => (
                  <TableRow key={license.licenseId}>
                    <TableCell>
                      {license.licensee}
                      <div className="break-all font-mono text-xs text-muted-foreground">{license.licenseId}</div>
                    </TableCell>
                    <TableCell className="break-all font-mono text-xs">{license.installationId}</TableCell>
                    <TableCell className="text-sm">
                      {license.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : <span className="text-muted-foreground">Never</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(license.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" size="sm" variant="destructive" onClick={() => handleRevoke(license.licenseId)}>Revoke</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

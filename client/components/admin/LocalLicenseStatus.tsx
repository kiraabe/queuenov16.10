import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { ValidateLicenseResponse } from "@shared/api";

export default function LocalLicenseStatus() {
  const [status, setStatus] = useState<ValidateLicenseResponse | null>(null);
  const [message, setMessage] = useState("");

  const loadStatus = async () => {
    const response = await fetch("/api/license/status");
    const data: ValidateLicenseResponse = await response.json();
    setStatus(data);
  };

  useEffect(() => {
    loadStatus().catch(() => setMessage("License status could not be loaded."));
  }, []);

  const downloadRequest = async () => {
    try {
      const response = await fetch("/api/license/activation-request");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not create activation request.");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data.activationRequest, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "stc-activation-request.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create activation request.");
    }
  };

  const importLicense = async (file?: File) => {
    if (!file) return;
    try {
      const certificate = JSON.parse(await file.text());
      const response = await fetch("/api/license/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ certificate }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not import license.");
      setMessage(data.message);
      await loadStatus();
      toast.success("License activated.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not import license.";
      setMessage(text);
      toast.error(text);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>STC License Status</CardTitle>
        <CardDescription>View this installation’s license and request an approved activation or replacement.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Status</span>
          <Badge variant={status?.valid ? "default" : "destructive"}>{status?.mode || (status?.valid ? "active" : "not activated")}</Badge>
          {status?.licensee && <span className="text-sm text-muted-foreground">{status.licensee}</span>}
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Installation ID</dt><dd className="break-all font-mono">{status?.installationId || "Available in activation request"}</dd></div>
          <div><dt className="text-muted-foreground">Registered domain</dt><dd>{status?.host || "—"}</dd></div>
          <div><dt className="text-muted-foreground">License ID</dt><dd className="break-all font-mono">{status?.licenseId || "—"}</dd></div>
          <div><dt className="text-muted-foreground">Expires</dt><dd>{status?.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : status?.valid ? "Never" : "—"}</dd></div>
        </dl>
        {(message || status?.warning) && <Alert><AlertDescription>{message || `${status?.message} ${status?.warning || ""}`}</AlertDescription></Alert>}
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={downloadRequest}>Download activation request</Button>
          <Input className="max-w-sm" type="file" accept="application/json,.json" aria-label="Upload approved STC license" onChange={(event) => importLicense(event.target.files?.[0])} />
        </div>
      </CardContent>
    </Card>
  );
}

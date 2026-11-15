import React, { ReactNode, useEffect, useState } from "react";
import { useLicense } from "@/hooks/use-license";
import { getLicenseErrorMessage } from "@/lib/license-errors";
import { LicenseLockedScreen } from "./LicenseLockedScreen";

interface LicenseProviderProps {
  children: ReactNode;
}

/**
 * LicenseProvider wraps the entire app and ensures the license is valid
 * before rendering any content. If the license is invalid, shows a locked screen.
 */
export function LicenseProvider({ children }: LicenseProviderProps) {
  const licenseState = useLicense();
  const [isSubmittingLicense, setIsSubmittingLicense] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const handleLicenseFileSubmit = async (certificate: unknown) => {
    setIsSubmittingLicense(true);
    setSubmissionError(null);
    try {
      const response = await fetch("/api/license/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ certificate }),
      });
      const data = await response.json();
      if (response.ok && data.valid) {
        window.location.reload();
        return;
      }
      setSubmissionError(getLicenseErrorMessage(data.errorCode, data.message));
    } catch {
      setSubmissionError("Unable to import the license file. Check the file and try again.");
    } finally {
      setIsSubmittingLicense(false);
    }
  };

  const handleDownloadActivationRequest = async () => {
    try {
      const response = await fetch("/api/license/activation-request", { headers: { "X-Requested-With": "XMLHttpRequest" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to create an activation request.");
      const blob = new Blob([JSON.stringify(data.activationRequest, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "stc-activation-request.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Unable to create an activation request.");
    }
  };

  const handleLicenseSubmit = async (licenseKey: string) => {
    setIsSubmittingLicense(true);
    setSubmissionError(null);
    try {
      const response = await fetch("/api/license/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify({ licenseKey }),
      });

      const data = await response.json();

      if (response.ok && data.valid) {
        // Success! Reload the page to unlock for everyone
        window.location.reload();
      } else {
        const errorMessage = getLicenseErrorMessage(data.errorCode, data.message);
        setSubmissionError(errorMessage);
        setIsSubmittingLicense(false);
      }
    } catch (error) {
      console.error("[License] Failed to submit license:", error);
      setSubmissionError("Network error. Please try again.");
      setIsSubmittingLicense(false);
    }
  };

  // Show loading screen
  if (licenseState.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white mx-auto mb-4" />
          <p className="text-white">{licenseState.message}</p>
        </div>
      </div>
    );
  }

  if (licenseState.isValid === true || licenseState.mode === "restricted") {
    return (
      <>
        {licenseState.warning && (
          <div role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
            {licenseState.message} {licenseState.warning}
          </div>
        )}
        {children}
      </>
    );
  }

  // Show locked screen for any other state (null, false, undefined)
  return (
    <LicenseLockedScreen
      message={submissionError || licenseState.message}
      onLicenseSubmit={handleLicenseSubmit}
      onLicenseFileSubmit={handleLicenseFileSubmit}
      onDownloadActivationRequest={handleDownloadActivationRequest}
      isValidating={isSubmittingLicense}
    />
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function WhatsAppSharing({
  link,
  qrDataUrl,
  profileName,
}: {
  link: string;
  qrDataUrl: string;
  profileName: string | null;
}) {
  const [message, setMessage] = useState("");
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm">
        Profile name:{" "}
        <strong>{profileName ?? "Not available from Meta"}</strong>
      </p>
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className="text-sm underline"
      >
        {link}
      </a>
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setMessage("WhatsApp link copied.");
          } catch {
            setMessage(
              "Could not copy. Select the link above to copy it manually.",
            );
          }
        }}
      >
        Copy WhatsApp link
      </Button>
      {/* biome-ignore lint/performance/noImgElement: locally generated QR data URL */}
      <img src={qrDataUrl} width={240} height={240} alt="WhatsApp QR code" />
      <a
        href={qrDataUrl}
        download="whatsapp-qr.png"
        className="text-sm underline"
      >
        Download QR code
      </a>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}

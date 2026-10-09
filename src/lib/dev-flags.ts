export function isDevEmailAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_AUTH === "true";
}

export function allowSelfApproval(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_SELF_APPROVAL === "true"
  );
}

export function isLocalEmailNoop(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY;
}

export function isLocalWhatsAppNoop(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    !process.env.WHATSAPP_SYSTEM_USER_TOKEN
  );
}

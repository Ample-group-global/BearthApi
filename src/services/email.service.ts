import nodemailer from "nodemailer";
import path from "path";

function createTransport() {
  const user    = process.env.GMAIL_SENDER_EMAIL ?? "";
  const appPass = process.env.GMAIL_APP_PASSWORD ?? "";

  if (!user || !appPass) {
    throw new Error("Email not configured: GMAIL_SENDER_EMAIL and GMAIL_APP_PASSWORD are required");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass: appPass },
  });
}

export async function sendResetPasswordEmail(
  toEmail: string,
  resetLink: string,
  recipientName?: string,
): Promise<void> {
  const transport   = createTransport();
  const senderEmail = process.env.GMAIL_SENDER_EMAIL ?? "";
  const senderName  = process.env.GMAIL_SENDER_NAME ?? "Bearth Admin";
  const displayName = recipientName ?? toEmail;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <tr><td style="background:#1a1f2e;padding:28px 40px 24px;text-align:center;">
          <img src="cid:bearthicon@bearth" alt="Bearth" width="52" height="52"
               style="display:block;margin:0 auto 10px;border-radius:14px;box-shadow:0 0 0 3px rgba(65,175,235,0.25),0 8px 24px rgba(0,0,0,0.3);" />
          <h1 style="color:#41afeb;margin:0;font-size:20px;font-weight:700;letter-spacing:1px;">BEARTH ADMIN</h1>
        </td></tr>

        <tr><td style="padding:40px 40px 24px;">
          <p style="color:#374151;font-size:15px;margin:0 0 16px;">Hi ${displayName},</p>
          <p style="color:#374151;font-size:15px;margin:0 0 24px;">
            We received a request to reset your Bearth Admin password.
            Click the button below to set a new password.
          </p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${resetLink}"
               style="display:inline-block;background:#41afeb;color:#ffffff;text-decoration:none;
                      padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;">
              Reset Password
            </a>
          </div>
          <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">Or copy this link into your browser:</p>
          <p style="color:#41afeb;font-size:12px;word-break:break-all;margin:0 0 24px;">${resetLink}</p>
          <p style="color:#9ca3af;font-size:13px;margin:0;">
            This link expires in <strong>1 hour</strong>.
            If you did not request a password reset, ignore this email.
          </p>
        </td></tr>

        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">
            &copy; ${new Date().getFullYear()} Bearth Admin &mdash; Ample Group Global
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transport.sendMail({
    from:    `"${senderName}" <${senderEmail}>`,
    to:      toEmail,
    subject: "Reset Your Bearth Admin Password",
    html,
    attachments: [
      {
        filename: "icon.png",
        path:     path.join(__dirname, "../assets/icon.png"),
        cid:      "bearthicon@bearth",
      },
    ],
  });
}

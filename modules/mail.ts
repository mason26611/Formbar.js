import nodemailer = require("nodemailer");

const { settings } = require("./config") as { settings: { emailEnabled: boolean } };

const limitStore = new Map<string, number>();
const RATE_LIMIT = 60000; // 1 minute in milliseconds

/**
 * Send an email via SMTP.
 * Applies per-recipient rate limiting.
 */
function sendMail(recipient: string, subject: string, html: string): void {
    if (!settings.emailEnabled) return;

    const emailPassword = process.env.EMAIL_PASSWORD;
    const emailUser = process.env.EMAIL_USER;
    if (!emailPassword || !emailUser) return;

    const currentTime = Date.now();
    if (limitStore.has(recipient) && currentTime - (limitStore.get(recipient) as number) < RATE_LIMIT) {
        return;
    }

    const smtpConfig: nodemailer.TransportOptions & { service: string; host: string; port: number; secure: boolean; auth: { user: string; pass: string } } = {
        service: "dreamhost",
        host: "smtp.dreamhost.com",
        port: 465,
        secure: true,
        auth: {
            user: emailUser,
            pass: emailPassword,
        },
    };

    const transporter = nodemailer.createTransport(smtpConfig);
    const mailOptions: nodemailer.SendMailOptions = {
        from: emailUser,
        to: recipient,
        subject: subject,
        html: html,
    };

    transporter.sendMail(mailOptions, (error: Error | null, _info: nodemailer.SentMessageInfo) => {
        if (error) {
            console.error("Error sending email:", error);
        } else {
            limitStore.set(recipient, currentTime);
        }
    });
}

module.exports = {
    sendMail,
    limitStore,
    RATE_LIMIT,
};

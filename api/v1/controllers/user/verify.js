const { dbRun, dbGetAll } = require("@modules/database");
const { settings, frontendUrl } = require("@modules/config");
const { MANAGER_PERMISSIONS } = require("@modules/permissions");
const { hasPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const userService = require("@services/user-service");
const jwt = require("jsonwebtoken");
const AppError = require("@errors/app-error");
const ForbiddenError = require("@errors/forbidden-error");
const NotFoundError = require("@errors/not-found-error");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    router.post("/user/:id/verify/request", isAuthenticated, async (req, res) => {
        const targetUserId = String(req.params.id);
        if (String(req.user.id) !== targetUserId) {
            throw new ForbiddenError("You may only request verification for your own account.", {
                event: "user.verify.request.failed",
                reason: "forbidden",
            });
        }

        if (!settings.emailEnabled) {
            throw new AppError("Email service is not enabled. Verification emails are unavailable at this time.", {
                statusCode: 503,
                event: "user.verify.request.failed",
                reason: "email_disabled",
            });
        }

        const apiBaseUrl = `${req.protocol}://${req.get("host")}`;
        req.infoEvent("user.verify.request.attempt", "Attempting to request verification email", { targetUserId });

        const result = await userService.requestVerificationEmail(targetUserId, apiBaseUrl);

        req.infoEvent("user.verify.request.success", "Verification email request processed", {
            targetUserId,
            alreadyVerified: result.alreadyVerified,
        });

        res.status(200).json({
            success: true,
            data: {
                message: result.alreadyVerified ? "Your account is already verified." : "Verification email has been sent.",
            },
        });
    });

    // Use a non-ambiguous path so it is not shadowed by GET /user/:id.
    router.get("/user/verify/email", async (req, res) => {
        const code = typeof req.query.code === "string" ? req.query.code : "";
        if (!code) {
            throw new ValidationError("Verification code is required.", {
                event: "user.verify.email.failed",
                reason: "missing_code",
            });
        }

        req.infoEvent("user.verify.email.attempt", "Attempting to verify account via email token");
        const result = await userService.verifyEmailFromCode(code);

        req.infoEvent("user.verify.email.success", "Account verified via email token", {
            userId: result.userId,
            alreadyVerified: result.alreadyVerified,
        });

        const acceptsHtml = String(req.headers.accept || "").includes("text/html");
        if (acceptsHtml && frontendUrl) {
            return res.redirect(`${frontendUrl}/login?verified=true`);
        }

        return res.status(200).json({
            success: true,
            data: {
                message: result.alreadyVerified ? "User is already verified." : "User has been verified successfully.",
            },
        });
    });

    const verifyUserHandler = async (req, res) => {
        const id = req.params.id;
        req.infoEvent("user.verify.attempt", "Attempting to verify user", { pendingUserId: id });

        const tempUsers = await dbGetAll("SELECT * FROM temp_user_creation_data");
        let tempUser;
        for (const user of tempUsers) {
            const userData = jwt.decode(user.token);
            if (userData.newSecret == id) {
                tempUser = userData;
                break;
            }
        }

        if (!tempUser) {
            throw new NotFoundError("Pending user not found", { event: "user.verify.failed", reason: "user_not_found" });
        }

        await dbRun("INSERT INTO users (email, password, permissions, API, secret, displayName, verified) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            tempUser.email,
            tempUser.hashedPassword,
            tempUser.permissions,
            tempUser.newAPI,
            tempUser.newSecret,
            tempUser.displayName,
            1,
        ]);
        await dbRun("DELETE FROM temp_user_creation_data WHERE secret=?", [tempUser.newSecret]);

        req.infoEvent("user.verify.success", "User verified successfully");
        res.status(200).json({
            success: true,
            data: {
                ok: true,
            },
        });
    };

    /**
     * @swagger
     * /api/v1/user/{id}/verify:
     *   patch:
     *     summary: Verify a pending user
     *     tags:
     *       - Users
     *     description: Verifies and activates a pending user account (requires manager permissions)
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Pending user's temporary ID
     *     responses:
     *       200:
     *         description: User verified successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                   example: true
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Pending user not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.patch("/user/:id/verify", isAuthenticated, hasPermission(MANAGER_PERMISSIONS), verifyUserHandler);

    // Deprecated endpoint - kept for backwards compatibility, use PATCH /api/v1/user/:id/verify instead
    router.post("/user/:id/verify", isAuthenticated, hasPermission(MANAGER_PERMISSIONS), async (req, res) => {
        res.setHeader("X-Deprecated", "Use PATCH /api/v1/user/:id/verify instead");
        res.setHeader(
            "Warning",
            '299 - "Deprecated API: Use PATCH /api/v1/user/:id/verify instead. This endpoint will be removed in a future version."'
        );
        await verifyUserHandler(req, res);
    });
};

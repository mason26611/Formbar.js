import passport = require("passport");
import { Strategy as GoogleStrategy, Profile, VerifyCallback } from "passport-google-oauth20";

const { settings } = require("./config") as { settings: { googleOauthEnabled: boolean } };

function setupGooglePassport(): void {
    if (!settings.googleOauthEnabled) return;

    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID ?? "",
                clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
                callbackURL: "/api/auth/google/callback",
            },
            (_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback) => {
                return done(null, profile);
            }
        )
    );

    passport.serializeUser((user: Express.User, done: (err: Error | null, id?: unknown) => void) => {
        done(null, user);
    });

    passport.deserializeUser((user: Express.User, done: (err: Error | null, user?: Express.User | false | null) => void) => {
        done(null, user);
    });
}

setupGooglePassport();
module.exports = {
    passport,
};

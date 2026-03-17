const DiscordStrategy = require('passport-discord').Strategy;
const { env } = require('../../config/env');

function configurePassport(passport) {
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));

  passport.use(
    new DiscordStrategy(
      {
        clientID: env.CLIENT_ID,
        clientSecret: env.CLIENT_SECRET,
        callbackURL: env.CALLBACK_URL,
        scope: ['identify', 'email', 'guilds']
      },
      async (accessToken, refreshToken, profile, done) => {
        let email = profile.email || '';
        // Fallback: fetch /users/@me directly if passport profile doesn't include email.
        if (!email && accessToken) {
          try {
            const r = await fetch('https://discord.com/api/users/@me', {
              headers: { authorization: `Bearer ${accessToken}` }
            });
            const data = r.ok ? await r.json().catch(() => null) : null;
            if (data && data.email) email = String(data.email);
          } catch {
            // ignore
          }
        }

        const user = {
          id: profile.id,
          username: profile.username,
          discriminator: profile.discriminator,
          globalName: profile.global_name || profile.globalName || '',
          avatar: profile.avatar || '',
          email,
          guilds: profile.guilds || []
        };
        return done(null, user);
      }
    )
  );
}

module.exports = { configurePassport };

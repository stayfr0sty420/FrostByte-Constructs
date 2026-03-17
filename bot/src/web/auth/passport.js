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
        const user = {
          id: profile.id,
          username: profile.username,
          discriminator: profile.discriminator,
          globalName: profile.global_name || profile.globalName || '',
          avatar: profile.avatar || '',
          email: profile.email || '',
          guilds: profile.guilds || []
        };
        return done(null, user);
      }
    )
  );
}

module.exports = { configurePassport };


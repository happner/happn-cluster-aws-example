
var config = {
  port: process.env.CONDUCTOR_PORT ? parseInt(process.env.CONDUCTOR_PORT) : 49000,
  secure: true,
  services: {
    connect: {
      config: {
        middleware: {
          security: {
            exclusions: [
              '/start',
              '/stop',
              '/download',
              '/reset'
            ]
          }
        }
      }
    },
    security: {
      config: {
        adminUser: {
          username: '_ADMIN',
          password: process.env.CONDUCTOR_PASSWORD || 'secret'
        }
      }
    }
  }
};

module.exports = config;

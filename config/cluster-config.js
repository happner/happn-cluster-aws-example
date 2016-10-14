
/*
     # (eg) osx

     HAPPN_IFACE=en0 \
     ADMIN_PASSWORD=happn \
     MONGO_URL=mongodb://127.0.0.1:27017/example-cluster \
     MONGO_COLLECTION=example-cluster \
     CLUSTER_NAME=example-cluster \
     SWIM_IFACE=en0 \
     JOIN_HOST_1=10.0.0.20:56000 \
     JOIN_HOST_2=10.0.0.20:56000 \
     JOIN_HOST_3=10.0.0.20:56000 \
     IS_SEED=1 \
     bin/cluster-server

 */

var config = {

  host: process.env.HAPPN_IFACE,
  port: 57000,
  secure: true,

  services: {

    security: {
      config: {
        adminUser: {
          username: '_ADMIN',
          password: process.env.ADMIN_PASSWORD
        }
      }
    },

    data: {
      path: 'happn-service-mongo',
      config: {
        url: process.env.MONGO_URL,
        collection: process.env.MONGO_COLLECTION
      }
    },

    proxy: {
      config: {
        listenPort: 55000
      }
    },

    orchestrator: {
      config: {
        // replicate: ['/*'],
        replicate: ['/global/*']
      }
    },

    membership: {
      config: {
        clusterName: process.env.CLUSTER_NAME,
        host: process.env.SWIM_IFACE,
        port: 56000,
        hosts: [process.env.JOIN_HOST_1, process.env.JOIN_HOST_2, process.env.JOIN_HOST_3],
        seed: process.env.IS_SEED == '1'
      }
    }
  }
};

// console.log(JSON.stringify(config, null, 2));

module.exports = config;

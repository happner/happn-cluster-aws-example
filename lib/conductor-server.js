module.exports = ConductorServer;

var path = require('path');
var fs = require('fs');
var bodyParser = require('body-parser');
var pad = require('pad');
var Promise = require('bluebird');
var authorization = process.env.CONDUCTOR_WEB_AUTH || 'secret';
var overheadTimeout = 10000;
var messageTimeout = 10000;

function ConductorServer() {

  this.csvFileName = path.dirname(__dirname) + '/metrics.csv';
  this.members = {};
  this.overheads = {};
  this.messages = {};
  this.running = null;
  this.nextId = 0;
  // this.csvHeaders = [
  //   'timestamp',
  //   'count-members',   // count of member in cluster
  //   'mode',            // benchmark mode
  //   'interval',        // message interval
  //   'lag-avg',         // average milliseconds per member lost in transmission of test instructions / results
  //   'replicate-avg',   // average milliseconds per member replication time
  //   'replicate-max',   // fastest milliseconds replication time
  //   'replicate-min'    // slowest milliseconds replication time
  // ];
}

ConductorServer.prototype.run = function (happnServer) {
  var _this = this;
  return new Promise(function (resolve, reject) {

    _this.log = happnServer.log.createLogger('Conductor');
    _this.server = happnServer;

    happnServer.services.session.localClient({
      username: '_ADMIN',
      password: process.env.CONDUCTOR_PASSWORD || 'secret'
    }, function (error, client) {

      if (error) return reject(error);
      _this.client = client;
      resolve();

    });

  })

    .then(function () {
      // input - event - listen to members join
      happnServer.services.session.on('authentic', _this.onConnection.bind(_this));
    })

    .then(function () {
      // input - event - listen to members leave
      happnServer.services.session.on('disconnect', _this.onDisconnection.bind(_this));
    })

    .then(function () {
      // input - subscribe - overhead measurement responses
      return new Promise(function (resolve, reject) {
        _this.client.on('/pong', _this.onPong.bind(_this), function (e) {
          if (e) return reject(e);
          resolve();
        });
      });
    })

    .then(function () {
      return new Promise(function (resolve, reject) {
        _this.client.on('/response', _this.onResponse.bind(_this), function (e) {
          if (e) return reject(e);
          resolve();
        });
      });
    })

    .then(function () {
      // input - web - turn on load conductor-server
      //
      // starts the benchmark process
      //
      // supply mode:
      //
      //   fullLinear
      //   ==========
      //   1. pre-measures request and response time overhead to all cluster members without
      //      passing message though cluster
      //   2. sends messages at interval to random cluster member which passes the message
      //      into the cluster to be fully replicated to each member and returned here by
      //      that member
      //   3. the measured duration of (2) minus (1) produces the replication time per member
      //
      //   4. some concern that returning all replicated messages to a single point here will
      //      produce an artificial bottleneck not present in the cluster itself, hence the
      //      attempt to offset this lag in 1
      //
      //   fullAscending (not implemented)
      //   ===============================
      //   1. same as liner except the message frequency per the interval of (2) ascends
      //
      //   diffLinear (not implemented)
      //   ============================
      //   1. sends message at interval to random cluster member which passes the message
      //      into the cluster to be fully replicated to each member
      //   2. the time-span between each message arriving at each member reflects the
      //      the replication cost (ie. it is expected to increase as the numbers of members
      //      increases)
      /*

       curl \
       -k \
       -H "Authorization: secret" \
       -H "Content-Type: application/json" \
       -X POST -d '
       {
       "mode": "fullLinear",
       "fullLinear": {
       "interval": 1000,
       "payload": {
       "lengthBytes": 1000
       }
       }
       }
       ' https://localhost:49000/start

       */
      happnServer.connect.use('/start', bodyParser.json());
      happnServer.connect.use('/start', _this.onStart.bind(_this));
    })

    .then(function () {
      // input - web - turn off load conductor-server
      //
      // stops the benchmark process
      //
      /*

       curl \
       -k \
       -H "Authorization: secret" \
       -H "Content-Type: application/json" \
       -X POST -d '{}' \
       https://localhost:49000/stop

       */
      happnServer.connect.use('/stop', bodyParser.json());
      happnServer.connect.use('/stop', _this.onStop.bind(_this));
    })

    .then(function () {
      // input - web - get data (replace headings)
      //
      // download the data
      //
      /*

       curl \
       -k \
       -H "Authorization: secret" \
       -X GET \
       https://localhost:49000/download

       */
      happnServer.connect.use('/download', _this.onDownload.bind(_this));
    })

    .then(function () {
      // input - web - get csv (replace headings)
      //
      // clear the data
      //
      /*

       curl \
       -k \
       -H "Authorization: secret" \
       -X GET \
       https://localhost:49000/reset

       */
      happnServer.connect.use('/reset', _this.onReset.bind(_this));
    })

    .then(function () {
      // input - web - get csv (replace headings)
      //
      // list members
      //
      /*

       curl \
       -k \
       -H "Authorization: secret" \
       -X GET \
       https://localhost:49000/members

       */
      happnServer.connect.use('/members', _this.onMembers.bind(_this));
    })

};

ConductorServer.prototype.onConnection = function (data) {
  this.members[data.info.name] = {
    overhead: undefined
  };
  this.log.info('connect %s (%d)', data.info.name, Object.keys(this.members).length);
};

ConductorServer.prototype.onDisconnection = function (data) {
  this.log.info('disconnect', data.info.name);
  delete this.members[data.info.name];
  this.log.info('disconnect %s (%d)', data.info.name, Object.keys(this.members).length);
};

ConductorServer.prototype.onStart = function (req, res) {
  if (!this.authorized(req, res)) return;
  if (!this.valid(req, res, '/start')) return;
  this.log.info('starting in mode %s', req.body.mode);
  this['start_' + req.body.mode](req.body[req.body.mode]);
  res.end('ok');
};

ConductorServer.prototype.onStop = function (req, res) {
  if (!this.authorized(req, res)) return;
  if (!this.valid(req, res, '/stop')) return;
  this.log.info('stopping');
  clearInterval(this.interval);
  res.end('stop ok');
};

ConductorServer.prototype.onDownload = function (req, res) {
  if (!this.authorized(req, res)) return;
  this.log.info('downloading');
  res.end(JSON.stringify({
    overheads: this.overheads,
    messages: this.messages
  }, null, 2));
};

ConductorServer.prototype.onReset = function (req, res) {
  if (!this.authorized(req, res)) return;
  this.log.info('resetting');
  this.overheads = {};
  this.messages = {};
  res.end('reset ok');
};

ConductorServer.prototype.onMembers = function (req, res) {
  if (!this.authorized(req, res)) return;
  this.log.info('listing members');
  var members = Object.keys(this.members);
  res.end(JSON.stringify({
    count: members.length,
    members: members
  }));
};

ConductorServer.prototype.authorized = function (req, res) {
  if (!req.headers.authorization || req.headers.authorization !== authorization) {
    res.statusCode = 401;
    res.end('unauthorized');
    return false;
  }
  return true;
};

ConductorServer.prototype.valid = function (req, res, urlpath) {
  function invalid(message) {
    res.statusCode = 400;
    res.end(message);
    return false;
  }

  if (urlpath == '/stop') return true;
  if (urlpath == '/start') {
    if (!req.body.mode) return invalid('missing mode');
    if (req.body.mode !== 'fullLinear') return invalid('no such mode');
    if (!req.body[req.body.mode]) return invalid('missing config for ' + req.body.mode);
    if (!this['valid_' + req.body.mode](req.body[req.body.mode])) {
      return invalid('invalid config for ' + req.body.mode);
    }
  }
  return true;
};

ConductorServer.prototype.valid_fullLinear = function (config) {
  if (typeof config.interval !== 'number') return false;
  if (typeof config.payload !== 'object') return false;
  if (typeof config.payload.lengthBytes !== 'number') return false;
  return true;
};

ConductorServer.prototype.randomMember = function () {
  var members = Object.keys(this.members);
  var random = Math.round(Math.random() * (members.length - 1));
  return members[random];
};

ConductorServer.prototype.getNextId = function () {
  var next = this.nextId;
  this.nextId++;
  if (this.nextId == Number.MAX_SAFE_INTEGER) this.nextId = 0;
  return pad(Number.MAX_SAFE_INTEGER.toString().length, next.toString(), '0');
};

ConductorServer.prototype.start_fullLinear = function (config) {
  // if (!this.running || this.running !== 'fullLinear') {
  //   try {
  //     fs.statSync(this.csvFileName);
  //   } catch (e) {
  //     fs.writeFileSync(this.csvFileName, this.csvHeaders.join(',') + '\n');
  //   }
  // }

  this.running = 'fullLinear';

  clearInterval(this.interval);

  this.interval = setInterval(function () {
    var id = this.getNextId();
    Promise.resolve()
      .then(function () {
        return this.measureOverhead(id, config);
      }.bind(this))
      .then(function(result) {
        this.log.info('overhead %s has %s of %d in %dms', id, result.state, result.count, result.ms);
      }.bind(this))
      .then(function () {
        return this.measureReplication(id, config);
      }.bind(this))
      .then(function(result) {
        this.log.info('message  %s has %s of %d in %dms', id, result.state, result.count, result.ms);
      }.bind(this))
      .catch(function (error) {
        this.log.error('start_fullLinear interval', error);
      }.bind(this))
  }.bind(this), config.interval);
};

ConductorServer.prototype.onPong = function (data) {
  var now = Date.now();
  var name = data.name;
  var overheads = this.overheads[data.id];
  if (!overheads) return;
  var member = overheads.members[name];
  if (!member) return;
  member.duration = now - overheads.ts;
  var all = true;
  Object.keys(overheads.members).forEach(function (name) {
    if (!overheads.members[name].duration) all = false;
  });
  overheads.all = all;
  if (all) {
    clearTimeout(overheads.timeout);
    delete overheads.timeout;
    overheads.resolve({
      state: 'all',
      ms: member.duration,
      count: overheads.count
    });
    delete overheads.resolve;
  }
};

ConductorServer.prototype.onResponse = function(data) {
  var now = Date.now();
  var name = data.name;
  var messages = this.messages[data.id];
  // console.log(data.id);
  if (!messages) return;
  var member = messages.members[name];
  if (!member) return;
  member.duration = now - messages.ts;
  var all = true;
  Object.keys(messages.members).forEach(function (name) {
    if (!messages.members[name].duration) all = false;
  });
  messages.all = all;
  if (all) {
    clearTimeout(messages.timeout);
    delete messages.timeout;
    messages.resolve({
      state: 'all',
      ms: member.duration,
      count: messages.count
    });
    delete messages.resolve;
  }
};

ConductorServer.prototype.measureOverhead = function (id, config) {
  var _this = this;
  return new Promise(function (resolve, reject) {
    var now = Date.now();

    _this.overheads[id] = {
      resolve: resolve,
      count: 0,
      ts: now,
      all: false,
      members: {}
    };

    Object.keys(_this.members).forEach(function (name) {
      _this.overheads[id].count++;
      _this.overheads[id].members[name] = {};
    });

    _this.overheads[id].timeout = setTimeout(function () {
      delete _this.overheads[id].timeout;
      resolve({
        state: 'timeout',
        ms: Date.now() - now,
        count: _this.overheads[id].count
      });
    }, overheadTimeout);

    var message = {id: id};
    if (config.payload && config.payload.lengthBytes) {
      message.data = _this.genText(config.payload.lengthBytes);
    }

    _this.client.set('/ping', message, {noStore: true})
      .catch(reject);

  });
};

ConductorServer.prototype.measureReplication = function (id, config) {
  var _this = this;
  return new Promise(function (resolve, reject) {
    var now = Date.now();
    var randomMemberName = _this.randomMember();

    _this.messages[id] = {
      resolve: resolve,
      count: 0,
      ts: now,
      all: false,
      members: {}
    };

    Object.keys(_this.members).forEach(function (name) {
      _this.messages[id].count++;
      _this.messages[id].members[name] = {};
    });

    _this.messages[id].timeout = setTimeout(function () {
      delete _this.messages[id].timeout;
      resolve({
        state: 'timeout',
        ms: Date.now() - now,
        count: _this.messages[id].count
      });
    }, messageTimeout);

    var message = {id: id};
    if (config.payload && config.payload.lengthBytes) {
      message.data = _this.genText(config.payload.lengthBytes);
    }

    // _this.log.info('message %s to %s', id, randomMemberName);
    _this.client.set('/message/' + randomMemberName, message, {noStore: true})
      .catch(reject);

  });
};

ConductorServer.prototype.genText = function (length) {
  var possible = 'ab cde f gh ijk lmn opqr st u v w x yz';
  var text = '';
  for (var i = 0; i < length; i++) {
    text += possible[Math.round(Math.random() * (possible.length - 1))];
  }
  return text;
};

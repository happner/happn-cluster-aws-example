module.exports = ConductorClient;

function ConductorClient() {
}

ConductorClient.prototype.run = function (conductorClientInstance, clusterClientInstance) {
  if (!conductorClientInstance) return;
  this.conductorClient = conductorClientInstance;
  this.clusterClient = clusterClientInstance;
  var _this = this;
  return new Promise(function (resolve, reject) {
    _this.conductorClient.on('/ping', _this.onPing.bind(_this), function (e) {
      if (e) return reject(e);
      resolve();
    });
  })

    .then(function() {
      return new Promise(function (resolve, reject) {
        _this.conductorClient.on('/message/' + _this.conductorClient.options.info.name, _this.onMessage.bind(_this), function (e) {
          if (e) return reject(e);
          resolve();
        });
      });
    })

    .then(function() {
      return new Promise(function (resolve, reject) {
        _this.clusterClient.on('/global/message/*', _this.onMessageReplicated.bind(_this), function (e) {
          if (e) return reject(e);
          resolve();
        });
      });
    });

};

ConductorClient.prototype.onPing = function (data) {
  this.conductorClient.log.debug('received ping %s', data.id);
  var _this = this;
  data.name = this.conductorClient.options.info.name;
  this.conductorClient.set('/pong', data, {noStore: true}, function (e) {
    if (e) _this.conductorClient.log.info('failed pong', e);
  });
};

ConductorClient.prototype.onMessage = function (data, meta) {
  this.conductorClient.log.info('received instruction -> %s', data.id);
  var _this = this;
  var path = '/global' + meta.path;
  this.clusterClient.set(path, data, function (e) {
    if (e) _this.clusterClient.log.info('failed message', e);
  });
};

ConductorClient.prototype.onMessageReplicated = function (data) {
  this.conductorClient.log.info('received replicated -> %s', data.id);
  var _this = this;
  data.name = this.conductorClient.options.info.name;
  this.conductorClient.set('/response', data, {noStore: true}, function (e) {
    if (e) _this.conductorClient.log.info('failed response', e);
  });
};

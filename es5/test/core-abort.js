'use strict';

var TestRunner = require('test-runner');
var UsageStats = require('../../');
var a = require('core-assert');
var os = require('os');
var runner = new TestRunner();
var shared = require('./lib/shared');

function getServer(port, delay) {
  var http = require('http');
  var server = http.createServer(function (req, res) {
    setTimeout(function () {
      res.statusCode = 200;
      res.end('yeah?');
    }, delay);
  });
  server.listen(port);
  return server;
}

runner.test('.abort(): aborting throws', function () {
  var server = getServer(9000, 1000);

  var testStats = new UsageStats('UA-00000000-0', {
    dir: shared.getCacheDir(this.index, 'abort'),
    url: 'http://localhost:9000'
  });
  testStats.screenView('test');

  return new Promise(function (resolve, reject) {
    testStats.send().then(function (responses) {
      throw new Error('should not reach here');
      reject();
    }).catch(function (err) {
      a.strictEqual(testStats._aborted, false);
      server.close();
      resolve();
    }).catch(function (err) {
      server.close();
      reject(err);
    });

    setTimeout(testStats.abort.bind(testStats), 50);
  });
});

runner.test('.abort(): called before .send() is a no-op', function () {
  var testStats = new UsageStats('UA-00000000-0');
  testStats.screenView('test');
  testStats.abort();
  a.ok(!this._aborted);
});

runner.test('.abort(): abort after a completed send is a no-op', function () {
  var server = getServer(9020, 20);

  var testStats = new UsageStats('UA-00000000-0', {
    dir: shared.getCacheDir(this.index, 'abort'),
    url: 'http://localhost:9020'
  });
  testStats.screenView('test');

  return new Promise(function (resolve, reject) {
    testStats.send().then(function (responses) {
      a.strictEqual(testStats._aborted, false);
      testStats.abort();
      a.strictEqual(testStats._aborted, false);
      server.close();
      resolve();
    }).catch(function (err) {
      console.error(err.stack);
      server.close();
      reject(err);
    });
  });
});

runner.test('.abort(): multiple requests - throws', function () {
  var server = getServer(9010, 1000);

  var testStats = new UsageStats('UA-00000000-0', {
    dir: shared.getCacheDir(this.index, 'abort'),
    url: 'http://localhost:9010'
  });

  for (var i = 0; i < 100; i++) {
    testStats.screenView('test');
  }

  setTimeout(testStats.abort.bind(testStats), 50);

  a.strictEqual(testStats._hits.length, 100);

  return new Promise(function (resolve, reject) {
    testStats.send().then(function (responses) {
      server.close();
      reject(new Error('should not reach here'));
    }).catch(function (err) {
      a.strictEqual(testStats._hits.length, 100);
      a.strictEqual(testStats._aborted, false);
      server.close();
      resolve();
    }).catch(function (err) {
      server.close();
      reject(err);
    });
  });
});
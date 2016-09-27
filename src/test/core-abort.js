'use strict'
const TestRunner = require('test-runner')
const UsageStats = require('../../')
const a = require('core-assert')
const os = require('os')
const runner = new TestRunner()
const shared = require('./lib/shared')

function getServer (port, delay) {
  const http = require('http')
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.statusCode = 200
      res.end('yeah?')
    }, delay)
  })
  server.listen(port)
  return server
}

runner.test('.abort(): aborting throws', function () {
  const server = getServer(9000, 1000)

  const testStats = new UsageStats('UA-00000000-0', {
    dir: shared.getCacheDir(this.index, 'abort'),
    url: 'http://localhost:9000'
  })
  testStats.screenView('test')

  return new Promise((resolve, reject) => {
    testStats.send()
      .then(responses => {
        throw new Error('should not reach here')
        reject()
      })
      .catch(err => {
        a.strictEqual(testStats._aborted, false)
        server.close()
        resolve()
      })
      .catch(err => {
        server.close()
        reject(err)
      })

    setTimeout(testStats.abort.bind(testStats), 50)
  })
})

runner.test('.abort(): called before .send() is a no-op', function () {
  const testStats = new UsageStats('UA-00000000-0')
  testStats.screenView('test')
  testStats.abort()
  a.ok(!this._aborted)
})

runner.test('.abort(): abort after a completed send is a no-op', function () {
  const server = getServer(9020, 20)

  const testStats = new UsageStats('UA-00000000-0', {
    dir: shared.getCacheDir(this.index, 'abort'),
    url: 'http://localhost:9020'
  })
  testStats.screenView('test')

  return new Promise((resolve, reject) => {
    testStats.send()
      .then(responses => {
        a.strictEqual(testStats._aborted, false)
        testStats.abort()
        a.strictEqual(testStats._aborted, false)
        server.close()
        resolve()
      })
      .catch(err => {
        console.error(err.stack)
        server.close()
        reject(err)
      })
  })
})

runner.test('.abort(): multiple requests - throws', function () {
  const server = getServer(9010, 1000)

  const testStats = new UsageStats('UA-00000000-0', {
    dir: shared.getCacheDir(this.index, 'abort'),
    url: 'http://localhost:9010'
  })

  for (let i = 0; i < 100; i++) {
    testStats.screenView('test')
  }

  setTimeout(testStats.abort.bind(testStats), 50)

  a.strictEqual(testStats._hits.length, 100)

  return new Promise((resolve, reject) => {
    testStats.send()
      .then(responses => {
        server.close()
        reject(new Error('should not reach here'))
      })
      .catch(err => {
        a.strictEqual(testStats._hits.length, 100)
        a.strictEqual(testStats._aborted, false)
        server.close()
        resolve()
      })
      .catch(err => {
        server.close()
        reject(err)
      })
  })
})

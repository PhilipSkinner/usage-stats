'use strict'
const path = require('path')
const os = require('os')
const fs = require('fs')
const arrayify = require('array-back')
const url = require('url')

/**
 * @module usage-stats
 * @typicalname usageStats
 * @example
 * const UsageStats = require('usage-stats')
 */

 /**
  * @alias module:usage-stats
  */
class UsageStats {
  /**
   * @param {string} - Google Analytics tracking ID (required).
   * @param [options] {object}
   * @param [options.name] {string} - App name
   * @param [options.version] {string} - App version
   * @param [options.lang] {string} - Language. Defaults to `process.env.LANG`.
   * @param [options.sr] {string} - Screen resolution. Defaults to `${process.stdout.rows}x${process.stdout.columns}`.
   * @param [options.ua] {string} - User Agent string to use.
   * @param [options.dir] {string} - Path of the directory used for persisting clientID and queue. Defaults to `~/.usage-stats`.
   * @param [options.url] {string} - Defaults to `'https://www.google-analytics.com/batch'`.
   * @param [options.debugUrl] {string} - Defaults to `'https://www.google-analytics.com/debug/collect'`.
   * @example
   * const usageStats = new UsageStats('UA-98765432-1', {
   *   name: 'sick app',
   *   version: '1.0.0'
   * })
   */
  constructor (trackingId, options) {
    if (!trackingId) throw new Error('a Google Analytics TrackingID is required')
    options = options || {}

    const homePath = require('home-path')

    /**
     * Cache directory where the queue and client ID is kept. Defaults to `~/.usage-stats`.
     * @type {string}
     */
    this.dir = options.dir || path.resolve(homePath(), '.usage-stats')
    this._queuePath = path.resolve(this.dir, 'queue')
    this._disabled = false
    this._hits = []

    this._url = {
      debug: options.debugUrl || 'https://www.google-analytics.com/debug/collect',
      batch: options.url || 'https://www.google-analytics.com/batch'
    }

    /**
     * Set parameters on this map to send them with every hit.
     * @type {Map}
     * @example
     * usageStats.defaults
     *   .set('cd1', process.version)
     *   .set('cd2', os.type())
     *   .set('cd3', os.release())
     *   .set('cd4', 'api')
     */
    this.defaults = new Map([
      [ 'v', 1 ],
      [ 'tid', trackingId ],
      [ 'ds', 'app' ],
      [ 'cid', this._getClientId() ],
      [ 'ua', options.ua || `Mozilla/5.0 ${this._getOSVersion()}` ],
      [ 'ul', options.lang || process.env.LANG ],
      [ 'sr', options.sr || this._getScreenResolution() ]
    ])
    if (options.name) this.defaults.set('an', options.name)
    if (options.version) this.defaults.set('av', options.version)

    this._requestControllers = []
    this._aborted = false
  }

  get dir () {
    return this._dir
  }
  set dir (val) {
    this._dir = val
    const mkdirp = require('mkdirp')
    mkdirp.sync(this._dir)
  }

  /**
   * Starts the [session](https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters#sc).
   * @param [sessionParams] {Map[]} - An optional map of paramaters to send with each hit in the sesison.
   * @chainable
   */
  start (sessionParams) {
    if (this._disabled) return this
    this._sessionStarted = true
    if (sessionParams) this._sessionParams = sessionParams
    return this
  }

  /**
   * Ends the [session](https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters#sc).
   * @param [sessionParams] {Map[]} - An optional map of paramaters to send with the final hit of this sesison.
   * @chainable
   */
  end (sessionParams) {
    if (this._disabled) return this
    if (this._hits.length === 1) {
      let hit = this._hits[0]
      hit.set('sc', 'end')
      if (sessionParams) hit = new Map([ ...hit, sessionParams ])
    } else if (this._hits.length > 1) {
      let hit = this._hits[this._hits.length - 1]
      hit.set('sc', 'end')
      if (sessionParams) hit = new Map([ ...hit, sessionParams ])
    }
    if (this._sessionParams) delete this._sessionParams
    return this
  }

  /**
   * Disable the module. While disabled, all operations are no-ops.
   * @chainable
   */
  disable () {
    this._disabled = true
    return this
  }

  /**
   * Re-enable the module.
   * @chainable
   */
  enable () {
    this._disabled = false
    return this
  }

  _createHit (map, options) {
    if (map && !(map instanceof Map)) throw new Error('map instance required')
    options = options || {}
    let hit = new Map([ ...this.defaults, ...(map || new Map()) ])
    if (options.hitParams) hit = new Map([ ...hit, ...options.hitParams ])
    if (this._sessionParams) hit = new Map([ ...hit, ...this._sessionParams ])
    if (this._sessionStarted) {
      hit.set('sc', 'start')
      this._sessionStarted = false
    }
    return hit
  }

  /**
   * Track an event. All event hits are queued until `.send()` is called.
   * @param {string} - Event category (required).
   * @param {string} - Event action (required).
   * @param [options] {option}
   * @param [options.label] {string} - Event label
   * @param [options.value] {string} - Event value
   * @param [options.hitParams] {map[]} - One or more additional params to send with the hit.
   * @returns {Map}
   */
  event (category, action, options) {
    if (this._disabled) return this
    options = options || {}
    if (!(category && action)) throw new Error('category and action required')

    let hit = this._createHit(new Map([
      [ 't', 'event' ],
      [ 'ec', category ],
      [ 'ea', action ]
    ]), options)

    const t = require('typical')
    if (t.isDefined(options.label)) hit.set('el', options.label)
    if (t.isDefined(options.value)) hit.set('ev', options.value)
    this._hits.push(hit)
    return hit
  }

  /**
   * Track a screenview. All screenview hits are queued until `.send()` is called. Returns the hit instance.
   * @param {string} - Screen name
   * @param [options] {object}
   * @param [options.hitParams] {map[]} - One or more additional params to set on the hit.
   * @returns {Map}
   */
  screenView (name, options) {
    if (this._disabled) return this
    options = options || {}
    if (options.hitParams && !(options.hitParams instanceof Map)) throw new Error('map instance required')

    let hit = this._createHit(new Map([
      [ 't', 'screenview' ],
      [ 'cd', name ],
    ]), options)
    this._hits.push(hit)
    return hit
  }

  /**
   * Track a exception. All exception hits are queued until `.send()` is called.
   * @param {string} - Error message
   * @param {boolean} - Set true if the exception was fatal
   * @param [options.hitParams] {map[]} - One or more additional params to set on the hit.
   * @returns {Map}
   */
  exception (description, isFatal, options) {
    if (this._disabled) return this
    options = options || {}
    let hit = this._createHit(new Map([
      [ 't', 'exception' ],
      [ 'exd', description ],
      [ 'exf', isFatal ? 1 : 0 ]
    ]), options)
    this._hits.push(hit)
    return hit
  }

  /**
   * Send queued stats using as few requests as possible (typically a single request - a max of 20 events/screenviews may be sent per request). If offline, the stats will be stored and re-tried on next invocation.
   * @param [options] {object}
   * @param [options.debug] {boolean} - [Validates hits](https://developers.google.com/analytics/devguides/collection/protocol/v1/validating-hits), fulfilling with the result.
   * @returns {Promise}
   * @fulfil `response[]` - array of responses
   */
  send (options) {
    if (this._disabled) return Promise.resolve([])
    options = options || {}

    let toSend = this._dequeue().concat(this._hits)
    this._hits.length = 0

    const reqOptions = url.parse(this._url.batch)
    reqOptions.method = 'POST'
    reqOptions.headers = { 'content-type': 'text/plain' }

    const requests = []

    while (toSend.length && !this._aborted) {
      let batch = toSend.splice(0, 20)
      reqOptions.controller = {}
      this._requestControllers.push(reqOptions.controller)
      const req = this._sendBatch(reqOptions, batch, true)
      requests.push(req)
    }

    return Promise.all(requests)
      .then(results => {
        this._requestControllers = []
        return results
      })
      .catch(err => {
        this._requestControllers = []
        if (this._aborted) {
          this._aborted = false
        }
        throw err
      })
  }

  /**
   * Send any hits (including queued) to the GA [validation server](https://developers.google.com/analytics/devguides/collection/protocol/v1/validating-hits), fulfilling with the result.
   * @returns {Promise}
   * @fulfil {Response[]}
   * @reject {Error} - Error instance includes `hits`.
   */
  debug () {
    if (this._disabled) return Promise.resolve([])
    let toSend = this._dequeue().concat(this._hits)
    this._hits.length = 0

    const reqOptions = url.parse(this._url.debug)
    reqOptions.method = 'POST'
    reqOptions.headers = { 'content-type': 'text/plain' }

    const requests = []
    while (toSend.length) {
      let batch = toSend.splice(0, 20)
      const req = this._sendBatch(reqOptions, batch)
        .then(response => {
          return {
            hits: batch,
            result: JSON.parse(response.data.toString())
          }
        })
      requests.push(req)
    }
    return Promise.all(requests)
  }

  _sendBatch (reqOptions, batch, enqueue) {
    return this._request(reqOptions, this._createHitsPayload(batch))
      .then(response => {
        if (response.res.statusCode >= 300) {
          throw new Error('Unexpected response')
        } else {
          return response
        }
      })
      .catch(err => {
        err.hits = batch
        if (enqueue) this._enqueue(batch)
        throw err
      })
  }

  /**
   * Aborts the in-progress .send() operation, queuing any unsent hits.
   * @chainable
   */
  abort () {
    if (this._disabled) return this
    while (this._requestControllers.length) {
      const controller = this._requestControllers.shift()
      if (controller && controller.abort) {
        this._aborted = true
        controller.abort()
      }
    }
    return this
  }

  /**
   * Loads queued hits.
   * @chainable
   */
  load () {
    this._hits = this._dequeue()
    return this
  }

  /**
   * Dumps unsent hits to the queue. They will be dequeued and sent on the next invocation of `.send()`.
   * @chainable
   */
  save () {
    this._enqueue(this._hits)
    this._hits.length = 0
    return this
  }

  /**
   * Return the total hits stored on the queue.
   * @returns {number}
   */
  get queueLength () {
    let hits = []
    try {
      const queue = fs.readFileSync(this._queuePath, 'utf8')
      hits = queue.trim().split(os.EOL)
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err
      }
    }
    return hits.length
  }

  /**
   * Must return a v4 UUID.
   * @returns {string}
   * @private
   */
  _getClientId () {
    let cid = null
    const uuid = require('node-uuid')
    const cidPath = path.resolve(this.dir, 'cid')
    try {
      cid = fs.readFileSync(cidPath, 'utf8')
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      cid = uuid.v4()
      fs.writeFileSync(cidPath, cid)
    }
    return cid
  }

  /**
   * @returns {string}
   * @private
   */
  _getOSVersion () {
    let output = null
    const osVersionPath = path.resolve(this.dir, 'osversion')
    try {
      output = fs.readFileSync(osVersionPath, 'utf8')
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      const execSync = require('child_process').execSync
      if (!execSync) {
        output = 'N/A'
      } else {
        if (os.platform() === 'win32') {
          output = `(Windows NT ${os.release()})`
        } else if (os.platform() === 'darwin') {
          output = `(Macintosh; Intel MAC OS X ${execSync('sw_vers -productVersion').toString().trim()})`
        } else if (os.platform() === 'linux') {
          output = `(X11; Linux ${os.release()})`
        }
      }
      fs.writeFileSync(osVersionPath, output)
    }
    return output
  }

  /**
   * The request method used internally, can be overridden for testing or other purpose. Takes a node-style request options object in. Must return a promise.
   * @param {object}
   * @param [data] {*}
   * @returns {Promise}
   * @fulfil `{ res: <node response object>, data: <Buffer payload> }`
   * @private
   */
  _request (reqOptions, data) {
    const request = require('req-then')
    return request(reqOptions, data)
  }

  /**
   * Returns hits queued.
   * @param [count] {number} - Number of hits to dequeue. Defaults to "all hits".
   * @return {map[]}
   * @private
   * @sync
   */
  _dequeue (count) {
    try {
      const queue = fs.readFileSync(this._queuePath, 'utf8')
      let hits
      try {
        hits = jsonToHits(queue)
      } catch (err) {
        hits = []
      }
      let output = []
      if (count) {
        output = hits.splice(0, count)
        fs.writeFileSync(this._queuePath, hitsToJson(hits))
      } else {
        fs.writeFileSync(this._queuePath, '')
        output = hits
      }
      return output
    } catch (err) {
      /* queue file doesn't exist */
      if (err.code === 'ENOENT') {
        return []
      } else {
        throw err
      }
    }
  }

  /**
   * Append an array of hits to the queue.
   * @param {string[]} - Array of hits.
   * @private
   * @sync
   * @chainable
   */
  _enqueue (hits) {
    hits = arrayify(hits)
    if (hits.length) {
      fs.appendFileSync(this._queuePath, hitsToJson(hits))
    }
    return this;
  }

  _getScreenResolution () {
    return process.stdout.columns && process.stdout.rows
      ? `${process.stdout.columns}x${process.stdout.rows}`
      : 'N/A'
  }

  _createHitsPayload (hits) {
    return arrayify(hits)
      .map(hit => {
        return Array.from(hit)
          .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
          .join('&')
      })
      .join(os.EOL)
  }
}

function hitsToJson (hits) {
  return arrayify(hits)
    .map(hit => {
      return mapToJson(hit) + os.EOL
    })
    .join('')
}

function jsonToHits (json) {
  if (json) {
    const hits = json.trim().split(os.EOL)
    return hits.map(hitJson => jsonToMap(hitJson))
  } else {
    return []
  }
}

function mapToJson(map) {
  return JSON.stringify([...map])
}
function jsonToMap(json) {
  return new Map(JSON.parse(json))
}

module.exports = UsageStats

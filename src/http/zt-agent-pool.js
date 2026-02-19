'use strict'
import EventEmitter from 'events';
import { ZitiAgent } from './zt-agent';

const NOOP = function () {}

const removeWhere = (list, predicate) => {
  const i = list.findIndex(predicate)

  return i === -1 ? undefined : list.splice(i, 1)[0]
}

class IdleItem {
  constructor(ztAgent, idleListener, timeoutId) {
    this.ztAgent = ztAgent
    this.idleListener = idleListener
    this.timeoutId = timeoutId
  }
}

class PendingItem {
  constructor(callback, req, opts) {
    this.callback = callback
    this.req = req
    this.opts = opts
  }
}

function throwOnDoubleRelease() {
  throw new Error('Release called on ztAgent which has already been released to the pool.')
}

function promisify(Promise, callback) {
  if (callback) {
    return { callback: callback, result: undefined }
  }
  let rej
  let res
  const cb = function (err, ztAgent) {
    err ? rej(err) : res(ztAgent)
  }
  const result = new Promise(function (resolve, reject) {
    res = resolve
    rej = reject
  }).catch((err) => {
    // replace the stack trace that leads to `TCP.onStreamRead` with one that leads back to the
    // application that created the query
    Error.captureStackTrace(err)
    throw err
  })
  return { callback: cb, result: result }
}

function makeIdleListener(pool, ztAgent) {
  return function idleListener(err) {
    err.ztAgent = ztAgent

    ztAgent.removeListener('error', idleListener)
    ztAgent.on('error', () => {
      pool.log('additional ztAgent error after disconnection due to error', err)
    })
    pool._remove(ztAgent)
    // TODO - document that once the pool emits an error
    // the ztAgent has already been closed & purged and is unusable
    pool.emit('error', err, ztAgent)
  }
}

class ZitiAgentPool extends EventEmitter {
  constructor(options) {
    super()
    this.options = Object.assign({}, options)

    this.options.max = this.options.max || this.options.poolSize || 10
    this.options.maxUses = this.options.maxUses || Infinity
    this.options.allowExitOnIdle = this.options.allowExitOnIdle || false
    this.options.maxLifetimeSeconds = this.options.maxLifetimeSeconds || 0
    this.logger = this.options.logger || function () {}
    this.ZitiAgent = ZitiAgent
    this.Promise = this.options.Promise || Promise

    if (typeof this.options.idleTimeoutMillis === 'undefined') {
      this.options.idleTimeoutMillis = (60 * 1000)
    }

    this._ztAgents = []
    this._idle = []
    this._expired = new WeakSet()
    this._pendingQueue = []
    this._endCallback = undefined
    this.ending = false
    this.ended = false
  }

  _hasFive() {
    return this._ztAgents.length >= 5
  }

  _isFull() {
    return this._ztAgents.length >= this.options.max
  }

  _pulseQueue() {

    if (this.ended) {
      this.logger.trace('pulse queue ended')
      return
    }
    if (this.ending) {
      this.logger.trace('pulse queue on ending')
      if (this._idle.length) {
        this._idle.slice().map((item) => {
          this._remove(item.ztAgent)
        })
      }
      if (!this._ztAgents.length) {
        this.ended = true
        this._endCallback()
      }
      return
    }

    this.logger.trace(`ZitiAgentPool._pulseQueue() poolLength[${this._ztAgents.length}] idleLength[${this._idle.length}] pendingQueue[${this._pendingQueue.length}] max[${this.options.max}]`)

    // if we don't have any waiting, do nothing
    if (!this._pendingQueue.length) {
      this.logger.trace('no queued requests')
      return
    }
    // if we don't have any idle ztAgents and we have no more room, do nothing
    if (!this._idle.length && this._isFull()) {
        this.logger.trace('no idle ztAgents and pool is at max capacity')
        return
    }
    const pendingItem = this._pendingQueue.shift()
    if (this._idle.length) {
      const idleItem = this._idle.pop()
      clearTimeout(idleItem.timeoutId)
      const ztAgent = idleItem.ztAgent
      ztAgent.ref && ztAgent.ref()
      const idleListener = idleItem.idleListener

        const info = {
            serviceName: pendingItem.opts.serviceName,
            serviceScheme: pendingItem.opts.serviceScheme,
            serviceConnectAppData: pendingItem.opts.serviceConnectAppData,
            conn: pendingItem.opts.conn,
            host: pendingItem.opts.hostname || pendingItem.opts.host,
            port: Number(pendingItem.opts.port) || this.defaultPort,
            localAddress: pendingItem.opts.localAddress,
            isWebSocket: pendingItem.opts.isWebSocket,
            ztContext: pendingItem.opts.ztContext,
            req: pendingItem.req,

            //
            // Reusable agents/sockets/connections is a work in progress (so not enabled yet)
            //
            // isNew: false,
            isNew: true,
        };

        ztAgent.inUse = true;

        ztAgent.createConnection(info, (err, socket) => {

            if (err) {
                pendingItem.req.emit('error', err);
            } else {
                pendingItem.req.onSocket(socket);
            }

            return this._acquireZitiAgent(ztAgent, pendingItem, idleListener, info.isNew)
        });

        return;
    }
    if (!this._isFull()) {
      return this.newZitiAgent(pendingItem, pendingItem.req, pendingItem.opts)
    }
    this.logger.trace(`ZitiAgentPool._pulseQueue() ERROR poolLength[${this._ztAgents.length}] idleLength[${this._idle.length}] pendingQueue[${this._pendingQueue.length}] max[${this.options.max}]`)
    throw new Error('unexpected condition')
  }

  _remove(ztAgent) {
    const removed = removeWhere(this._idle, (item) => item.ztAgent === ztAgent)

    if (removed !== undefined) {
      clearTimeout(removed.timeoutId)
    }

    this._ztAgents = this._ztAgents.filter((c) => c !== ztAgent)
    ztAgent.end()
    this.emit('remove', ztAgent)
  }

  async connect(req, reqOptions, cb) {

    this.logger.trace(`ZitiAgentPool.connect() poolLength[${this._ztAgents.length}] idleLength[${this._idle.length}] pendingQueue[${this._pendingQueue.length}] max[${this.options.max}]`)

    if (this.ending) {
      const err = new Error('Cannot use a pool after calling end on the pool')
      return cb ? cb(err) : this.Promise.reject(err)
    }

    const response = promisify(this.Promise, cb)
    const result = response.result

    // if we don't have to connect a new ztAgent, don't do so
    // if (this._hasFive() && (this._isFull() || this._idle.length)) {
    if (this._isFull() || this._idle.length) {
        
      // if we have idle ztAgents schedule a pulse
      if (this._idle.length) {
        setTimeout(() => {
            this._pulseQueue();
        }, 1)
      }

      if (!this.options.connectionTimeoutMillis) {
        this._pendingQueue.push(new PendingItem(response.callback, req, reqOptions))
        return result
      }

      const queueCallback = (err, res, done) => {
        clearTimeout(tid)
        response.callback(err, res, done)
      }

      const pendingItem = new PendingItem(queueCallback, req, reqOptions)

      // set connection timeout on checking out an existing ztAgent
      const tid = setTimeout(() => {
        // remove the callback from pending waiters because
        // we're going to call it with a timeout error
        removeWhere(this._pendingQueue, (i) => i.callback === queueCallback)
        pendingItem.timedOut = true
        response.callback(new Error('timeout exceeded when trying to connect'))
      }, this.options.connectionTimeoutMillis)

      this._pendingQueue.push(pendingItem)
      return result
    }

    await this.newZitiAgent(new PendingItem(response.callback, req, reqOptions))

    return result
  }

  async newZitiAgent(pendingItem) {
    let ztAgentOptions = Object.assign({}, this.options, pendingItem.opts)
    const ztAgent = new this.ZitiAgent(ztAgentOptions)
    this._ztAgents.push(ztAgent)
    this.logger.trace(`ZitiAgentPool.newZitiAgent() poolLength[${this._ztAgents.length}] idleLength[${this._idle.length}] pendingQueue[${this._pendingQueue.length}] max[${this.options.max}]`)
    const idleListener = makeIdleListener(this, ztAgent)

    this.logger.trace('checking ztAgent timeout')

    // connection timeout logic
    let tid
    let timeoutHit = false
    if (this.options.connectionTimeoutMillis) {
      tid = setTimeout(() => {
        this.logger.trace('ending ztAgent due to timeout')
        timeoutHit = true
        ztAgent.connection ? ztAgent.connection.stream.destroy() : ztAgent.end()
      }, this.options.connectionTimeoutMillis)
    }

    this.logger.trace('connecting new ztAgent');

    const info = {
        serviceName: pendingItem.opts.serviceName,
        serviceScheme: pendingItem.opts.serviceScheme,
        serviceConnectAppData: pendingItem.opts.serviceConnectAppData,
        conn: pendingItem.opts.conn,
        host: pendingItem.opts.hostname || pendingItem.opts.host,
        port: Number(pendingItem.opts.port) || this.defaultPort,
        localAddress: pendingItem.opts.localAddress,
        isWebSocket: pendingItem.opts.isWebSocket,
        ztContext: pendingItem.opts.ztContext,
        req: pendingItem.req,
        isNew: true,
    };

    ztAgent.inUse = true;

    await ztAgent.createConnection(info, (err, socket) => {
        if (tid) {
            clearTimeout(tid)
        }
    
        if (err) {
            pendingItem.req.emit('error', err);
        } else {
            pendingItem.req.onSocket(socket);
        }

        return this._acquireZitiAgent(ztAgent, pendingItem, idleListener, info.isNew)
    });

  }

  // acquire a ZitiAgent for a pending work item
  _acquireZitiAgent(ztAgent, pendingItem, idleListener, isNew) {
    if (isNew) {
      this.emit('connect', ztAgent)
    }

    this.emit('acquire', ztAgent)

    ztAgent.release = this._releaseOnce(ztAgent, idleListener)

    ztAgent.removeListener('error', idleListener)

    if (!pendingItem.timedOut) {
      if (isNew && this.options.verify) {
        this.options.verify(ztAgent, (err) => {
          if (err) {
            ztAgent.release(err)
            return pendingItem.callback(err, undefined, NOOP)
          }

          pendingItem.callback(undefined, ztAgent, ztAgent.release)
        })
      } else {
        pendingItem.callback(undefined, ztAgent, ztAgent.release)
      }
    } else {
      if (isNew && this.options.verify) {
        this.options.verify(ztAgent, ztAgent.release)
      } else {
        ztAgent.release()
      }
    }
  }

  // returns a function that wraps _release and throws if called more than once
  _releaseOnce(ztAgent, idleListener) {
    let released = false

    return (err) => {
      if (released) {
        throwOnDoubleRelease()
      }

      released = true
      this._release(ztAgent, idleListener, err)
    }
  }

  // release a ztAgent back to the pool, include an error
  // to remove it from the pool
  _release(ztAgent, idleListener, err) {
    ztAgent.on('error', idleListener)

    ztAgent._poolUseCount = (ztAgent._poolUseCount || 0) + 1

    ztAgent.inUse = false;

    this.emit('release', err, ztAgent)

    // TODO(bmc): expose a proper, public interface _queryable and _ending
    // if (err || this.ending || !ztAgent._queryable || ztAgent._ending || ztAgent._poolUseCount >= this.options.maxUses) {
    if (err || this.ending || ztAgent._ending || ztAgent._poolUseCount >= this.options.maxUses) {
      if (ztAgent._poolUseCount >= this.options.maxUses) {
        this.logger.trace('remove expended ztAgent')
      }
      this._remove(ztAgent)
      this._pulseQueue()
      return
    }

    const isExpired = this._expired.has(ztAgent)
    if (isExpired) {
      this.logger.trace('remove expired ztAgent')
      this._expired.delete(ztAgent)
      this._remove(ztAgent)
      this._pulseQueue()
      return
    }

    // idle timeout
    let tid
    if (this.options.idleTimeoutMillis) {
      tid = setTimeout(() => {
        this.logger.trace('remove idle ztAgent')
        this._remove(ztAgent)
      }, this.options.idleTimeoutMillis)

      if (this.options.allowExitOnIdle) {
        // allow Node to exit if this is all that's left
        tid.unref()
      }
    }

    if (this.options.allowExitOnIdle) {
      ztAgent.unref()
    }

    this._idle.push(new IdleItem(ztAgent, idleListener, tid))
    this.logger.trace(`ZitiAgentPool._release() poolLength[${this._ztAgents.length}] idleLength[${this._idle.length}] pendingQueue[${this._pendingQueue.length}] max[${this.options.max}]`)
    this._pulseQueue()
  }

  query(text, values, cb) {
    // guard clause against passing a function as the first parameter
    if (typeof text === 'function') {
      const response = promisify(this.Promise, text)
      setImmediate(function () {
        return response.callback(new Error('Passing a function as the first parameter to pool.query is not supported'))
      })
      return response.result
    }

    // allow plain text query without values
    if (typeof values === 'function') {
      cb = values
      values = undefined
    }
    const response = promisify(this.Promise, cb)
    cb = response.callback

    this.connect((err, ztAgent) => {
      if (err) {
        return cb(err)
      }

      let ztAgentReleased = false
      const onError = (err) => {
        if (ztAgentReleased) {
          return
        }
        ztAgentReleased = true
        ztAgent.release(err)
        cb(err)
      }

      ztAgent.once('error', onError)
      this.logger.trace('dispatching query')
      try {
        ztAgent.query(text, values, (err, res) => {
          this.logger.trace('query dispatched')
          ztAgent.removeListener('error', onError)
          if (ztAgentReleased) {
            return
          }
          ztAgentReleased = true
          ztAgent.release(err)
          if (err) {
            return cb(err)
          }
          return cb(undefined, res)
        })
      } catch (err) {
        ztAgent.release(err)
        return cb(err)
      }
    })
    return response.result
  }

  end(cb) {
    this.logger.trace('ending')
    if (this.ending) {
      const err = new Error('Called end on pool more than once')
      return cb ? cb(err) : this.Promise.reject(err)
    }
    this.ending = true
    const promised = promisify(this.Promise, cb)
    this._endCallback = promised.callback
    this._pulseQueue()
    return promised.result
  }

  get waitingCount() {
    return this._pendingQueue.length
  }

  get idleCount() {
    return this._idle.length
  }

  get expiredCount() {
    return this._ztAgents.reduce((acc, ztAgent) => acc + (this._expired.has(ztAgent) ? 1 : 0), 0)
  }

  get totalCount() {
    return this._ztAgents.length
  }
}
export {
    ZitiAgentPool
};
  
const crypto = require('crypto')
const https = require('https')
const fs = require('fs')
const fsp = require('fs').promises
const { DEFAULT_OPTIONS } = require('./constants')

const timeoutPromise = t => new Promise(resolve => setTimeout(resolve, t))

module.exports = class FileTransfer {
  constructor (url, size, hash, agent, options = {}) {
    this.url = url
    this.size = size
    this.hash = hash
    this.agent = agent
    this.fh = null
    this.opts = Object.assign(DEFAULT_OPTIONS, options)

    this.state = {
      pos: this.opts.initialPos,
      chunkSize: (this.opts.chunkSizeMax + this.opts.chunkSizeMin) / 2
    }
  }

  requestRange (start, end) {
    return new Promise((resolve) => {
      const chunk = Buffer.alloc(end - start + 1)
      let chunkPos = 0

      let res = null
      const tId = setTimeout(() => {
        if (res === null) {
          req.destroy(new Error('Timeout (during request)'))
        } else {
          res.destroy(new Error('Timeout (during response)'))
        }
      }, this.opts.maxInterval)

      const req = https.get(this.url, {
        agent: this.agent,
        headers: { range: `bytes=${start}-${end}` }
      }, (r) => {
        res = r
        res.on('data', (subChunk) => {
          if (chunkPos + subChunk.length > chunk.length) {
            res.destroy(new Error('Sub-chunk overflow'))
            return
          }

          subChunk.copy(chunk, chunkPos)
          chunkPos += subChunk.length
          if (chunkPos === chunk.length) {
            clearTimeout(tId)
            resolve({ chunk, error: null })
          }
        })
      })

      req.on('error', (error) => {
        resolve({ chunk: chunk.subarray(0, chunkPos), error })
      })
    })
  }

  async openFile (file, truncate = true) {
    if (this.fh !== null) throw new Error('File already open')
    this.fh = await fsp.open(file, `${truncate ? 'w' : 'a'}+`)
  }

  async writeNextChunk () {
    if (this.fh === null) throw new Error('File not open')
    if (this.state.pos === this.size) throw new Error('Done already')
    if (this.state.pos > this.size) throw new Error('Chunk overflow')

    const startRange = this.state.pos
    const endRange = Math.min(this.state.pos + this.state.chunkSize - 1, this.size - 1)

    if (this.opts.debug) console.log(`Requesting ${endRange - startRange + 1} b, at ${startRange}`)

    const t0 = process.hrtime.bigint()
    let res = await this.requestRange(startRange, endRange)

    const resTime = Number(process.hrtime.bigint() - t0) / 1000000
    const resTimeRel = Math.min(resTime / this.opts.maxInterval, 1.0)

    if (res.chunk.length > 0) {
      await fsp.appendFile(this.fh, res.chunk)
      this.state.pos += res.chunk.length
      if (this.opts.debug) console.log(`Transferred ${res.chunk.length} b`)
    }

    if (res.error === null) {
      // resTimeRel  chunkSizeMult
      // 1           ms1
      // 0           ms0
      if (this.opts.debug) console.log(`Full transfer, response time: ${(100.0 * resTimeRel).toFixed(1)} %`)
      this.state.chunkSize *= this.opts.ms0 - (this.opts.ms0 - this.opts.ms1) * resTimeRel
    } else {
      // resTimeRel  chunkSizeMult
      // 1           mf1
      // 0           mf0
      if (this.opts.debug) console.log(`Partial transfer [${res.error.message}], response time: ${(100.0 * resTimeRel).toFixed(1)} %`)
      this.state.chunkSize *= this.opts.mf0 - (this.opts.mf0 - this.opts.mf1) * resTimeRel
      await timeoutPromise(this.opts.maxInterval * (1.0 - resTimeRel))
    }

    this.state.chunkSize = Math.floor(this.state.chunkSize)
    if (this.state.chunkSize > this.opts.chunkSizeMax) {
      this.state.chunkSize = this.opts.chunkSizeMax
    } else if (this.state.chunkSize < this.opts.chunkSizeMin) {
      this.state.chunkSize = this.opts.chunkSizeMin
    }

    return {
      done: this.state.pos === this.size,
      size: this.size,
      written: this.state.pos
    }
  }

  verifyFile () {
    return new Promise((resolve, reject) => {
      if (this.fh === null) {
        reject('File not open')
        return
      }

      const hash = crypto.createHash('sha256')

      fs.createReadStream('', {
        fd: this.fh.fd,
        autoClose: false,
        start: 0
      }).on('data', (chunk) => {
        hash.update(chunk)
      }).on('end', () => {
        resolve(hash.digest('base64') === this.hash)
      }).on('error', (e) => reject(e))
    })
  }

  async closeFile () {
    if (this.fh === null) throw new Error('File not open')
    await this.fh.close()
    this.fh = null
  }
}

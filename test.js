const fs = require('fs')
const https = require('https')
const FileTransfer = require('kanakuri')

const httpsAgent = new https.Agent({
  cert: fs.readFileSync('mycert.crt'),
  key: fs.readFileSync('mykey.key'),
  ca: fs.readFileSync('myca.crt')
})

const entrypoint = async () => {
  // url, length, hash (base64), agent, options (optional)
  const ft = new FileTransfer('https://example.com/test.txt', 1234, 'TpVf6gJoUYy6pQBAnfvsiPDs660o2E7L4lC67ZfbqIk=', httpsAgent, {
    debug: true, // Log error messages, progress, chunk size and response time.
    chunkSizeMax: 50000000, // Maximum bytes transferred in one chunk. Increase for fast connections.
    chunkSizeMin: 10000, // Minimum bytes transferred in one chunk. Decrease for slow connections.
    maxInterval: 10000, // Maximum time in milliseconds between retries.
    initialPos: 0, // Position in bytes where requests are started. Used for resuming transfers.
    // After each response the chunk size is multiplied by a value linearly related to how long the response took.
    // The following values determine how the algorithm will adapt to changing network conditions:
    mf1: 0.05, // Failed request, response time at 100% of maxInterval
    mf0: 1, // Failed request, response time at 0% of maxInterval
    ms1: 0.2, // Successful request, response time at 100% of maxInterval
    ms0: 2 // Successful request, response time at 0% of maxInterval
  })

  // file, truncate (optional, default true)
  await ft.openFile('./test.txt')

  for (let status = { done: false }; !status.done;) {
    status = await ft.writeNextChunk()
    console.log('Progress:', (100.0 * status.written / status.size).toFixed(1), '%\n')
  }

  console.log('hash OK:', await ft.verifyFile())
  await ft.closeFile()
}

entrypoint()
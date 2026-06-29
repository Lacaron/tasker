const fs = require('fs')
const os = require('os')
const path = require('path')

const QUEUE_PATH = path.join(os.tmpdir(), 'tasker-sync-queue.json')

function readQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf8')
}

function enqueue(taskId, commentBody, commentId) {
  const queue = readQueue()
  queue[taskId] = { taskId, commentBody, commentId, queuedAt: new Date().toISOString() }
  writeQueue(queue)
}

function dequeue(taskId) {
  const queue = readQueue()
  delete queue[taskId]
  writeQueue(queue)
}

function getQueue() {
  return readQueue()
}

function clearQueue() {
  try { fs.unlinkSync(QUEUE_PATH) } catch {}
}

module.exports = { enqueue, dequeue, getQueue, clearQueue }

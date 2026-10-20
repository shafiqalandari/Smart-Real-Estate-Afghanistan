const { spawn } = require('child_process')
const path = require('path')

const node = process.execPath
const viteBin = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js')
const children = []

function start(label, args) {
  const child = spawn(node, args, { stdio: 'inherit', env: process.env })
  child.on('exit', (code, signal) => {
    if (signal || code === 0) return
    console.error(`${label} exited with code ${code}`)
    shutdown(code || 1)
  })
  children.push(child)
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 100)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('Starting SafarPro API on :3001 and Vite on :5173 ...')
start('API', ['--watch', 'server/index.js'])
start('Vite', [viteBin])

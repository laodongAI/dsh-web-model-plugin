import assert from 'node:assert/strict'
import {test} from 'node:test'
import {WebviewBrowserBridge} from '../lib/browser/webview-bridge.js'
import {registerRoutes} from '../lib/http-routes.js'

test('browser bridge only claims a request for its target session', async () => {
  const bridge = new WebviewBrowserBridge()
  const pending = bridge.connect('deepseek').withSession('session-a').evaluate('1', 5000)

  assert.equal(bridge.next(['deepseek'], 'session-b'), undefined)
  const request = bridge.next(['deepseek'], 'session-a')
  assert.equal(request?.sessionId, 'session-a')
  bridge.resolve(request.id, 7)
  assert.equal(await pending, 7)
  bridge.dispose()
})

test('route registration rolls back routes already registered when a later route fails', () => {
  const disposed = []
  let attempted = 0

  assert.throws(() => registerRoutes({}, {}, () => {
    attempted++
    if (attempted === 4) throw new Error('registration failed')
    const number = attempted
    return () => disposed.push(number)
  }), /registration failed/)

  assert.deepEqual(disposed, [3, 2, 1])
})

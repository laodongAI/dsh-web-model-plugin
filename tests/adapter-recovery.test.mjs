import assert from 'node:assert/strict'
import {test} from 'node:test'
import {DshBrowserAdapter} from '../lib/dsh-browser-adapter.js'

test('resumes a submitted browser response without sending the prompt a second time', async () => {
  let submissions = 0
  let resumptions = 0
  const browserProvider = {
    async *chat(request) {
      submissions++
      request.onSubmitted()
      throw new Error('SERVICE_UNAVAILABLE: simulated response read failure')
    },
    async *resume() {
      resumptions++
      yield 'Recovered answer'
    },
    async health() {
      return {status: 'ready'}
    },
    classifyError() {
      return 'SERVICE_UNAVAILABLE'
    },
  }
  const accounts = {
    selectProvider() {},
    async ensureProvider() {
      return {id: 'account-1'}
    },
    getProvider() {
      return browserProvider
    },
  }
  const adapter = new DshBrowserAdapter(accounts, {}, {loginWaitTimeoutMs: 2000})
  const chunks = []

  for await (const chunk of adapter.stream({
    provider: 'web-ai',
    model: 'deepseek',
    sessionId: 'session-1',
    messages: [{role: 'user', content: 'Please do this once'}],
  })) chunks.push(chunk)

  assert.equal(submissions, 1)
  assert.equal(resumptions, 1)
  assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'Recovered answer'))
  assert.deepEqual(chunks.at(-1), {type: 'finish', reason: {kind: 'stop'}})
})

import assert from 'node:assert/strict'
import {test} from 'node:test'
import {ConfiguredWebPage} from '../lib/providers/web-page.js'

test('stops instead of appending a replacement answer snapshot as a duplicate delta', async () => {
  const answers = ['first answer', 'replacement answer']
  const cdp = {
    async evaluate(expression) {
      if (expression.includes('const p=')) return answers.shift() ?? ''
      if (expression.includes('location.href')) {
        return {url: 'https://chat.deepseek.com/chat/1', conversationId: '1', ready: true, changed: false}
      }
      if (expression.includes('document.body?.innerText')) return null
      if (expression.includes('const re=')) return false
      throw new Error('Unexpected page expression')
    },
    async setFileInputFiles() {},
    async close() {},
  }
  const page = new ConfiguredWebPage({
    displayName: 'DeepSeek',
    host: 'deepseek.com',
    inputSelectors: 'textarea',
    conversationIdPattern: 'chat/([\\w-]+)',
    sendButtonPattern: 'send',
    answerSelectors: '.answer',
    loginPattern: 'sign in',
  }, cdp, {streamTimeoutMs: 5000, noStartTimeoutMs: 1000, uploadTimeoutMs: 1000})
  const emitted = []

  await assert.rejects(async () => {
    for await (const delta of page.streamAnswer()) emitted.push(delta)
  }, /PAGE_CHANGED: 网页回答在生成过程中被替换/)
  assert.deepEqual(emitted, ['first answer'])
})

import assert from 'node:assert/strict'
import {test} from 'node:test'
import {PROVIDER_MAP, PAGE_CONFIGS} from '../lib/provider-catalog.js'
import {ConfiguredWebPage} from '../lib/providers/web-page.js'

const timing = {streamTimeoutMs: 5000, noStartTimeoutMs: 2000, uploadTimeoutMs: 1000}

function createPage(url, overrides = {}) {
  const expressions = []
  const cdp = {
    async evaluate(expression) {
      expressions.push(expression)
      if (expression.includes('location.href')) {
        return {url, conversationId: undefined, ready: true, changed: false}
      }
      if (expression.includes('document.body?.innerText')) return null
      if (expression.includes('document.querySelector')) return true
      return null
    },
    async setFileInputFiles() {},
    async close() {},
    ...overrides,
  }
  return {page: new ConfiguredWebPage(PAGE_CONFIGS.copilot, cdp, timing), expressions}
}

test('Copilot catalog recognizes both domains and uses the current chat URL', () => {
  assert.equal(PROVIDER_MAP.copilot.url, 'https://copilot.com/chat/')
  assert.deepEqual(PAGE_CONFIGS.copilot.hostAliases, ['copilot.microsoft.com'])
  assert.equal(PROVIDER_MAP.copilot.hostPattern.test('https://copilot.com/chat/'), true)
  assert.equal(PROVIDER_MAP.copilot.hostPattern.test('https://copilot.microsoft.com/'), true)
  assert.equal(PROVIDER_MAP.copilot.hostPattern.test('https://copilot.com.evil.example/'), false)
})

test('Copilot health accepts the current and legacy hosts but rejects lookalike hosts', async () => {
  for (const url of ['https://copilot.com/chat/', 'https://copilot.microsoft.com/']) {
    const {page} = createPage(url)
    assert.equal((await page.health()).status, 'ready')
  }
  const {page} = createPage('https://copilot.com.evil.example/chat/')
  assert.equal((await page.health()).status, 'page_changed')
})

test('Copilot selectors include accessible inputs and assistant-only message targets', async () => {
  const {page, expressions} = createPage('https://copilot.com/chat/')
  await page.canChat()
  await page.readAnswer('')
  assert.match(expressions[0], /role=/)
  assert.match(expressions[1], /data-message-author-role/)
  assert.match(expressions[1], /data-author.*user/)
  assert.doesNotMatch(expressions[1], /class\*=/)
})

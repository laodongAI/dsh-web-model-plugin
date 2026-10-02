import assert from 'node:assert/strict'
import {afterEach, test} from 'node:test'
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {AccountStore} from '../lib/account-store.js'

const roots = []

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-account-store-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

function account(id = 'test-account') {
  const timestamp = new Date().toISOString()
  return {
    id,
    provider: 'deepseek',
    displayName: 'DeepSeek',
    profileDir: 'unused',
    debugPort: 0,
    status: 'unknown',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

test('does not replace accounts data when reading fails for a reason other than ENOENT', async () => {
  const root = await createRoot()
  const file = join(root, 'accounts.json')
  await mkdir(file)

  await assert.rejects(new AccountStore(root).load())
  assert.equal((await readdir(root)).includes('accounts.json'), true)
})

test('backs up malformed JSON before recreating an empty store', async () => {
  const root = await createRoot()
  const file = join(root, 'accounts.json')
  await writeFile(file, '{broken', 'utf8')

  await new AccountStore(root).load()

  const backup = (await readdir(root)).find(name => name.startsWith('accounts.json.corrupt-'))
  assert.ok(backup)
  assert.equal(await readFile(join(root, backup), 'utf8'), '{broken')
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {version: 1, accounts: []})
})

test('a failed save does not poison later queued writes', async () => {
  const root = await createRoot()
  const store = new AccountStore(root)
  await store.load()
  await rm(join(root, 'accounts.json'))
  await mkdir(join(root, 'accounts.json'))

  await assert.rejects(store.upsert(account('failed-write')))
  await rm(join(root, 'accounts.json'), {recursive: true})
  await store.upsert(account('recovered-write'))

  assert.equal(store.get('failed-write'), undefined)
  assert.equal(store.get('recovered-write')?.id, 'recovered-write')
})

import {readFile,writeFile,mkdir} from 'node:fs/promises'
const id='dsh-account-models'
const source=await readFile(new URL('../src/client/index.js',import.meta.url),'utf8')
await mkdir(new URL('../lib',import.meta.url),{recursive:true})
const output=[
`window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
'var module = { exports: {} };',
'var exports = module.exports;',
source,
'return module.exports;',
'} });',
].join('\\n')
await writeFile(new URL('../lib/client.js',import.meta.url),output,'utf8')
console.log('[dsh-account-models] client bundle written')

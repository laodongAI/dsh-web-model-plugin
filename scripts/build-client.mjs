import {readFile,writeFile,mkdir} from 'node:fs/promises'

const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
const id=packageJson.name
if(typeof id!=='string'||!id){
  throw new Error('package.json.name is required for the client module id')
}

const source=await readFile(new URL('../src/client/index.js',import.meta.url),'utf8')

await mkdir(new URL('../lib',import.meta.url),{recursive:true})

const output=[
 `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
 'var module = { exports: {} };',
 'var exports = module.exports;',
 source,
 'return module.exports;',
 '} });',
].join('\n')

await writeFile(new URL('../lib/client.js',import.meta.url),output,'utf8')
console.log(`[dsh-account-models] client bundle written: ${id}`)

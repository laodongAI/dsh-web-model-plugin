import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {AccountProvider} from './types.js'

export interface WebAiConfig {
  version:1
  defaultProvider?:AccountProvider
  defaultAccountId?:string
}

export class WebAiConfigStore {
  private data:WebAiConfig={version:1}
  private readonly file:string
  constructor(readonly rootDir:string){this.file=join(rootDir,'config.json')}
  async load(){
    await mkdir(this.rootDir,{recursive:true})
    try{
      const value=JSON.parse(await readFile(this.file,'utf8')) as WebAiConfig
      if(value.version!==1)throw new Error('Invalid Web AI config')
      this.data=value
    }catch(e){
      if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e
      await this.save()
    }
  }
  get(){return {...this.data}}
  async set(value:Pick<WebAiConfig,'defaultProvider'|'defaultAccountId'>){
    this.data={version:1,...value}
    await this.save()
    return this.get()
  }
  private async save(){await mkdir(this.rootDir,{recursive:true});await writeFile(this.file,JSON.stringify(this.data,null,2),'utf8')}
}

import {mkdir,readFile,rename,writeFile} from 'node:fs/promises'
import type {AccountRecord} from './types.js'

interface StoreFile {version:1;accounts:AccountRecord[]}

export class AccountStore {
 private data:StoreFile={version:1,accounts:[]}
 private readonly file:string

 constructor(readonly rootDir:string){this.file=rootDir+'/accounts.json'}

 async load(){
  await mkdir(this.rootDir,{recursive:true})
  try{
   this.data=JSON.parse(await readFile(this.file,'utf8')) as StoreFile
   if(this.data.version!==1||!Array.isArray(this.data.accounts))throw new Error('Invalid account store')
  }catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT'){await this.save();return}
   const backup=`${this.file}.corrupt-${Date.now()}`
   try{await rename(this.file,backup)}catch{}
   this.data={version:1,accounts:[]}
   await this.save()
  }
 }

 list(){return this.data.accounts.map(x=>({...x}))}
 get(id:string){const x=this.data.accounts.find(a=>a.id===id);return x?{...x}:undefined}
 async upsert(a:AccountRecord){const i=this.data.accounts.findIndex(x=>x.id===a.id);if(i<0)this.data.accounts.push({...a});else this.data.accounts[i]={...a};await this.save()}
 async remove(id:string){this.data.accounts=this.data.accounts.filter(x=>x.id!==id);await this.save()}
 private async save(){await mkdir(this.rootDir,{recursive:true});await writeFile(this.file,JSON.stringify(this.data,null,2),'utf8')}
}

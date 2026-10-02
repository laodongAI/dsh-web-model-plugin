import {mkdir,readFile,rename,writeFile,unlink} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import type {AccountRecord,AccountStatus} from './types.js'

/** 账号存储文件结构（版本 1） */
interface StoreFile {version:1;accounts:AccountRecord[]}

/**
 * 账号持久化存储（accounts.json）。
 * 采纳的加固项：
 * - 原子写：先写临时文件再 rename，进程中断不会留下半截 JSON；
 * - 串行保存队列：并发 upsert/remove 不会交错写文件；
 * - 读取时验证完整记录结构；损坏文件先备份，再重建空存储；
 * - 非损坏 I/O 错误直接上报，不覆盖原文件。
 */
export class AccountStore {
 /** 内存中的存储数据（版本 1） */
 private data:StoreFile={version:1,accounts:[]}
 /** 存储文件绝对路径 */
 private readonly file:string
 /** 串行保存队列：所有写操作按序执行，避免并发交错 */
 private saveQueue:Promise<void>=Promise.resolve()

 constructor(readonly rootDir:string){this.file=join(rootDir,'accounts.json')}

 /** 加载并校验存储；文件不存在则创建空存储 */
 async load(){
  await mkdir(this.rootDir,{recursive:true})
  let raw:string
  try{
   raw=await readFile(this.file,'utf8')
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error
   this.data={version:1,accounts:[]}
   await this.save()
   return
  }

  let parsed:unknown
  try{
   parsed=JSON.parse(raw)
   if(!parsed||typeof parsed!=='object')throw new Error('账户存储根节点必须是对象')
   const candidate=parsed as Partial<StoreFile>
   if(candidate.version!==1||!Array.isArray(candidate.accounts)||!candidate.accounts.every(isValidAccount)){
    throw new Error('账户存储结构无效')
   }
   this.data={version:1,accounts:candidate.accounts}
   return
  }catch(parseError){
   const backup=`${this.file}.corrupt-${Date.now()}`
   try{
    await rename(this.file,backup)
   }catch(renameError){
    throw new Error(`accounts.json 损坏且无法备份到 ${backup}`,{cause:renameError})
   }
   console.warn(`[dsh-account-models] accounts.json 损坏，已备份到 ${backup}，将重建空存储: ${String(parseError)}`)
   this.data={version:1,accounts:[]}
   await this.save()
  }
 }

 /** 列出全部账号（浅拷贝，防止外部改内存） */
 list(){return this.data.accounts.map(x=>({...x}))}

 /** 按 id 查询单条记录 */
 get(id:string){const x=this.data.accounts.find(a=>a.id===id);return x?{...x}:undefined}

 /** 新增或更新一条记录（原子落盘） */
 async upsert(a:AccountRecord){
  await this.mutate(accounts=>{
   const i=accounts.findIndex(x=>x.id===a.id)
   if(i<0)accounts.push({...a})
   else accounts[i]={...a}
  })
 }

 /** 只更新状态与错误信息（避免为改状态而整条覆盖） */
 async updateStatus(id:string,status:AccountStatus,lastError?:string){
  await this.mutate(accounts=>{
   const i=accounts.findIndex(x=>x.id===id)
   if(i<0)return
   accounts[i]={...accounts[i],status,lastError,updatedAt:new Date().toISOString()}
  })
 }

 /** 删除一条记录 */
 async remove(id:string){
  await this.mutate(accounts=>{
   const i=accounts.findIndex(x=>x.id===id)
   if(i>=0)accounts.splice(i,1)
  })
 }

 /** 每项变更串行基于上一次成功状态保存，失败后队列仍可继续处理后续操作。 */
 private save():Promise<void>{
  return this.write(this.data)
 }

 private mutate(change:(accounts:AccountRecord[])=>void):Promise<void>{
  const operation=this.saveQueue.catch(()=>{}).then(async()=>{
   const next:StoreFile={version:1,accounts:this.data.accounts.map(account=>({...account}))}
   change(next.accounts)
   await this.write(next)
   this.data=next
  })
  this.saveQueue=operation
  return operation
 }

 private async write(data:StoreFile):Promise<void>{
  const snapshot=JSON.stringify(data,null,2)
  await mkdir(this.rootDir,{recursive:true})
  const tmp=`${this.file}.${randomUUID()}.tmp`
  try{
   await writeFile(tmp,snapshot,'utf8')
   await rename(tmp,this.file)
  }catch(error){
   try{await unlink(tmp)}catch(cleanupError){
    if((cleanupError as NodeJS.ErrnoException).code!=='ENOENT'){
     console.warn('[dsh-account-models] failed to remove temporary account file:',cleanupError)
    }
   }
   throw error
  }
 }
}

/** 校验一条记录的结构是否完整合法（provider 需在受支持集合内） */
function isValidAccount(value:unknown):value is AccountRecord{
 if(!value||typeof value!=='object')return false
 const a=value as Partial<AccountRecord>
 const providers:readonly string[]=['deepseek','chatgpt','qwen','tencent-yuanbao','doubao','perplexity','copilot','huggingchat','kimi','chatglm']
 const statuses:readonly string[]=['unknown','login_required','ready','browser_closed','page_changed','error']
 return (
  typeof a.id==='string'&&a.id.length>0&&
  typeof a.provider==='string'&&providers.includes(a.provider)&&
  typeof a.displayName==='string'&&
  typeof a.profileDir==='string'&&
  typeof a.debugPort==='number'&&
  typeof a.status==='string'&&statuses.includes(a.status)&&
  typeof a.createdAt==='string'&&
  typeof a.updatedAt==='string'
 )
}

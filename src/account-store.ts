import {mkdir,readFile,rename,writeFile,unlink} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import type {AccountRecord,AccountStatus} from './types.js'

/** 账号存储文件结构（版本 1） */
interface StoreFile {version:1;accounts:AccountRecord[]}

/**
 * 账号持久化存储（accounts.json）。
 * 采纳的加固项：
 * - 原子写：先写临时文件再 rename，进程中断不会留下半截 JSON；
 * - 串行保存队列：并发 upsert/remove 不会交错写文件；
 * - 读取时逐条校验记录结构（isValidAccount），脏数据直接过滤；
 * - 文件损坏时备份到 .corrupt-<时间戳> 并输出警告，方便用户找回。
 */
export class AccountStore {
 /** 内存中的存储数据（版本 1） */
 private data:StoreFile={version:1,accounts:[]}
 /** 存储文件绝对路径 */
 private readonly file:string
 /** 串行保存队列：所有写操作按序执行，避免并发交错 */
 private saveQueue:Promise<void>=Promise.resolve()

 constructor(readonly rootDir:string){this.file=rootDir+'/accounts.json'}

 /** 加载并校验存储；文件不存在则创建空存储 */
 async load(){
  await mkdir(this.rootDir,{recursive:true})
  try{
   const parsed=JSON.parse(await readFile(this.file,'utf8')) as StoreFile
   if(parsed.version!==1||!Array.isArray(parsed.accounts))throw new Error('Invalid account store')
   // 逐条校验，过滤掉结构不合法的脏记录
   this.data={version:1,accounts:parsed.accounts.filter(isValidAccount)}
  }catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT'){await this.save();return}
   // 损坏：备份原文件再重建，并输出备份路径供用户恢复
   const backup=`${this.file}.corrupt-${Date.now()}`
   try{
    await rename(this.file,backup)
    console.warn(`[dsh-account-models] accounts.json 损坏，已备份到 ${backup}，将重建空存储`)
   }catch(renameError){
    console.warn('[dsh-account-models] accounts.json 损坏且备份失败:',renameError)
   }
   this.data={version:1,accounts:[]}
   await this.save()
  }
 }

 /** 列出全部账号（浅拷贝，防止外部改内存） */
 list(){return this.data.accounts.map(x=>({...x}))}

 /** 按 id 查询单条记录 */
 get(id:string){const x=this.data.accounts.find(a=>a.id===id);return x?{...x}:undefined}

 /** 新增或更新一条记录（原子落盘） */
 async upsert(a:AccountRecord){const i=this.data.accounts.findIndex(x=>x.id===a.id);if(i<0)this.data.accounts.push({...a});else this.data.accounts[i]={...a};await this.save()}

 /** 只更新状态与错误信息（避免为改状态而整条覆盖） */
 async updateStatus(id:string,status:AccountStatus,lastError?:string){
  const i=this.data.accounts.findIndex(x=>x.id===id)
  if(i<0)return
  this.data.accounts[i]={...this.data.accounts[i],status,lastError,updatedAt:new Date().toISOString()}
  await this.save()
 }

 /** 删除一条记录 */
 async remove(id:string){this.data.accounts=this.data.accounts.filter(x=>x.id!==id);await this.save()}

 /** 原子保存：临时文件 + rename；通过 saveQueue 串行执行 */
 private save():Promise<void>{
  const snapshot=JSON.stringify(this.data,null,2)
  this.saveQueue=this.saveQueue.then(async()=>{
   await mkdir(this.rootDir,{recursive:true})
   const tmp=`${this.file}.${randomUUID()}.tmp`
   try{
    await writeFile(tmp,snapshot,'utf8')
    await rename(tmp,this.file)
   }catch(error){
    try{await unlink(tmp)}catch{}
    throw error
   }
  })
  return this.saveQueue
 }
}

/** 校验一条记录的结构是否完整合法（provider 需在受支持集合内） */
function isValidAccount(value:unknown):value is AccountRecord{
 if(!value||typeof value!=='object')return false
 const a=value as Partial<AccountRecord>
 const providers:readonly string[]=['deepseek','chatgpt','qwen','tencent-yuanbao','doubao','perplexity','copilot','huggingchat','kimi','chatglm']
 return (
  typeof a.id==='string'&&a.id.length>0&&
  typeof a.provider==='string'&&providers.includes(a.provider)&&
  typeof a.displayName==='string'&&
  typeof a.profileDir==='string'&&
  typeof a.debugPort==='number'&&
  typeof a.status==='string'&&
  typeof a.createdAt==='string'&&
  typeof a.updatedAt==='string'
 )
}

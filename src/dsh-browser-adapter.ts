import {LlmAdapter,LlmError,type GenerateOptions,type LlmModelInfo,type LlmResolvedModelInfo,type StreamChunk} from '@deepseek-ai/dsh-llm'
import type {AccountManager} from './account-manager.js'
import type {AttachmentStore} from '@deepseek-ai/dsh-attachment'

const DEFAULT_MODEL_ID='default'
const accountIdOf=(id:string)=>id===DEFAULT_MODEL_ID?'':id.startsWith('web-ai:')?id.slice('web-ai:'.length):id

export class DshBrowserAdapter extends LlmAdapter{
 constructor(private readonly accounts:AccountManager,private readonly attachments:AttachmentStore){super()}

 override providerInfo(provider:string){
  return {id:provider,name:'Web AI（浏览器）'}
 }

 override async listModels(provider:string):Promise<readonly LlmModelInfo[]>{
  const account=this.accounts.getDefaultAccount()
  if(!account)return [{provider,id:DEFAULT_MODEL_ID,name:'Web AI（未配置账号）',description:'请在 Web AI 设置中添加并登录浏览器账号',inputModalities:['text','image']}]
  return [{
   provider,
   id:DEFAULT_MODEL_ID,
   name:account.displayName,
   description:`${account.provider} · ${account.status==='ready'?'已登录':account.status==='login_required'?'需要登录':'浏览器会话状态未知'}`,
   inputModalities:['text','image'],
  }]
 }

 override async resolveModel(provider:string,model:string,signal?:AbortSignal):Promise<LlmResolvedModelInfo>{
  if(signal?.aborted)throw signal.reason??new Error('请求已取消')
  if(provider!=='web-ai')throw new LlmError(`未知 Web AI Provider：${provider}`,'MODEL_UNAVAILABLE')
  const accountId=accountIdOf(model)
  const account=accountId?this.accounts.list().find(a=>a.id===accountId):this.accounts.getDefaultAccount()
  console.info('[dsh-account-models] resolveModel',JSON.stringify({provider,model,accountId:account?.id??null,accountStatus:account?.status??null}))
  if(!account)throw new LlmError('尚未配置默认 Web AI 浏览器账号，请先打开 Web AI 设置完成配置','MODEL_UNAVAILABLE')
  return {provider,id:model,name:account.displayName,inputModalities:['text','image']}
 }

 override async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
  if(options.provider!=='web-ai')throw new LlmError(`未知 Web AI Provider：${options.provider}`,'MODEL_UNAVAILABLE')
  const accountId=accountIdOf(options.model)
  const account=accountId?this.accounts.list().find(a=>a.id===accountId):this.accounts.getDefaultAccount()
  if(!account)throw new LlmError('尚未配置默认 Web AI 浏览器账号，请先打开 Web AI 设置完成配置','MODEL_UNAVAILABLE')
  let adapter=this.accounts.getProvider(account.id)
  if(!adapter){
   await this.accounts.open(account.id)
   adapter=this.accounts.getProvider(account.id)
  }
  if(!adapter)throw new LlmError('账号浏览器启动失败，请在 Web AI 设置中检查账号','SERVICE_UNAVAILABLE')

  const messages=options.messages.map(m=>({
   role:m.role,
   content:typeof m.content==='string'?m.content:m.content.filter(x=>x.type==='text').map(x=>x.text).join('\n')
  }))
  const browserAttachments=this.collectAttachments(options.messages)
  const sessionId=options.sessionId?String(options.sessionId):account.id
  let answer=''
  let started=false

  try{
   for await(const delta of adapter.chat({accountId:account.id,model:options.model,sessionId,messages,attachments:browserAttachments,signal:options.signal})){
    if(!delta)continue
    if(!started){
     started=true
     yield {type:'block-start',index:0,blockType:'text'}
    }
    answer+=delta
    yield {type:'text-delta',index:0,text:delta}
   }
   if(!answer)throw new LlmError('网页没有提取到模型回答','SERVICE_UNAVAILABLE')
   yield {type:'block-end',index:0,block:{type:'text',text:answer}}
   yield {type:'finish',reason:{kind:'stop'}}
  }catch(error){
   const code=adapter.classifyError(error)
   const mapped=code==='LOGIN_REQUIRED'||code==='SESSION_EXPIRED'?'AUTH':code==='RATE_LIMITED'?'RATE_LIMIT':code==='QUOTA_EXCEEDED'?'QUOTA_EXCEEDED':code==='SERVICE_UNAVAILABLE'?'UNAVAILABLE':'PROVIDER_ERROR'
   throw error instanceof LlmError?error:new LlmError(error instanceof Error?error.message:String(error),mapped,{cause:error})
  }
 }

 private collectAttachments(messages:GenerateOptions['messages']):readonly {path:string;name?:string;kind:'image'|'file'}[]{
  const latest=[...messages].reverse().find(m=>m.role==='user')
  if(!latest||typeof latest.content==='string')return []
  const result:{path:string;name?:string;kind:'image'|'file'}[]=[]
  for(const block of latest.content){
   if(block.type==='image'){
    const path=this.attachments.imageHostPath(block.attachment)
    if(path)result.push({path,name:block.attachment.name,kind:'image'})
   }else if(block.type==='text'){
    const match=block.text.match(/\[File\s+"[^"]+"\s+\(\d+\s+bytes,\s+sha256:[^)]+\):\s+verbatim\s+read-only\s+copy\s+saved\s+at\s+"([^"]+)"\./)
    if(match){
     try{result.push({path:JSON.parse('"'+match[1]+'"'),kind:'file'})}catch{}
    }
   }
  }
  const seen=new Set<string>()
  return result.filter(x=>seen.has(x.path)?false:(seen.add(x.path),true))
 }
}

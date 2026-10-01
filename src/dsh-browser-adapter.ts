import {LlmAdapter,LlmError,type GenerateOptions,type LlmModelInfo,type LlmResolvedModelInfo,type StreamChunk,type ToolCallId} from '@deepseek-ai/dsh-llm'
import type {AccountManager} from './account-manager.js'
import type {AttachmentStore} from '@deepseek-ai/dsh-attachment'
import {PROVIDERS,PROVIDER_MAP} from './provider-catalog.js'
import type {AccountProvider} from './types.js'

function providerOfModel(model:string):AccountProvider|undefined{
 if((PROVIDERS as readonly {id:AccountProvider}[]).some(x=>x.id===model))return model as AccountProvider
 return undefined
}

const TOOL_CALL_RE=/<dsh_tool_call>\s*([\s\S]*?)\s*<\/dsh_tool_call>/g

function extractToolCalls(text:string){
 const calls:{id:ToolCallId;name:string;arguments:string}[]=[]
 for(const match of text.matchAll(TOOL_CALL_RE)){
  try{
   const value=JSON.parse(match[1]) as {name?:unknown;arguments?:unknown;id?:unknown}
   if(typeof value.name!=='string'||!value.name.trim())continue
   const args=typeof value.arguments==='string'?value.arguments:JSON.stringify(value.arguments??{})
   calls.push({id:(typeof value.id==='string'&&value.id?value.id:`web-${calls.length+1}`) as ToolCallId,name:value.name.trim(),arguments:args})
  }catch{}
 }
 return calls
}

function stripToolCalls(text:string){return text.replace(TOOL_CALL_RE,'').trim()}
export class DshBrowserAdapter extends LlmAdapter{
 private readonly conversations=new Map<string,{provider:AccountProvider}>()

 constructor(private readonly accounts:AccountManager,private readonly attachments:AttachmentStore){super()}

 override providerInfo(provider:string){
  return {id:provider,name:'Web AI（浏览器）'}
 }

 override async listModels(provider:string):Promise<readonly LlmModelInfo[]>{
  if(provider!=='web-ai')return []
  return PROVIDERS.map(item=>{
   const account=this.accounts.findByProvider(item.id)
   const state=account?.status==='ready'?'已就绪':account?.status==='login_required'?'需要登录':'首次使用将打开浏览器'
   return {provider,id:item.id,name:item.name+'（浏览器）',description:`${item.name} · ${state}`,inputModalities:['text','image'] as const}
  })
 }

 override async resolveModel(provider:string,model:string,signal?:AbortSignal):Promise<LlmResolvedModelInfo>{
  if(signal?.aborted)throw signal.reason??new Error('请求已取消')
  if(provider!=='web-ai')throw new LlmError(`未知 Web AI Provider：${provider}`,'MODEL_UNAVAILABLE')
  const selected=providerOfModel(model)
  if(selected){
   this.accounts.selectProvider(selected)
   const account=this.accounts.findByProvider(selected)
   return {provider,id:model,name:PROVIDER_MAP[selected].name+'（浏览器）',inputModalities:['text','image']}
  }
  const legacy=this.accounts.list().find(a=>a.id===model)
  if(legacy)return {provider,id:model,name:legacy.displayName,inputModalities:['text','image']}
  throw new LlmError(`未知 Web AI 模型：${model}`,'MODEL_UNAVAILABLE')
 }

 override async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
  if(options.provider!=='web-ai')throw new LlmError(`未知 Web AI Provider：${options.provider}`,'MODEL_UNAVAILABLE')
  const selected=providerOfModel(options.model)
  if(!selected)throw new LlmError('必须从 DSH 中间模型选择器选择一个 Web AI Provider','MODEL_UNAVAILABLE')
  this.accounts.selectProvider(selected)
  const account=await this.accounts.ensureProvider(selected)
  let adapter=this.accounts.getProvider(account.id)
  if(!adapter){
   await this.accounts.open(account.id)
   adapter=this.accounts.getProvider(account.id)
  }
  if(!adapter)throw new LlmError('账号浏览器启动失败，请检查对应 Provider 的浏览器会话','SERVICE_UNAVAILABLE')

  const sessionId=options.sessionId?String(options.sessionId):account.id
  const toolSchemas=options.tools??[]
  const browserAttachments=this.collectAttachments(options.messages)
  const state=this.conversations.get(sessionId)
  const firstTurn=!state||state.provider!==selected
  const prompt=this.buildBrowserPrompt(options,firstTurn,toolSchemas)
  let answer=''

  try{
   for await(const delta of adapter.chat({accountId:account.id,model:options.model,sessionId,messages:[{role:'user',content:prompt}],attachments:browserAttachments,signal:options.signal})){
    if(delta)answer+=delta
   }
   this.conversations.set(sessionId,{provider:selected})
   const toolCalls=extractToolCalls(answer)
   const visible=stripToolCalls(answer)
   if(toolCalls.length){
    if(visible){
     yield {type:'block-start',index:0,blockType:'text'}
     yield {type:'text-delta',index:0,text:visible}
     yield {type:'block-end',index:0,block:{type:'text',text:visible}}
    }
    for(let i=0;i<toolCalls.length;i++){
     const call=toolCalls[i]
     const index=i+(visible?1:0)
     yield {type:'block-start',index,blockType:'tool-call'}
     yield {type:'tool-call-delta',index,id:call.id,name:call.name,argumentsDelta:call.arguments}
     yield {type:'block-end',index,block:{type:'tool-call',id:call.id,name:call.name,arguments:call.arguments}}
    }
    yield {type:'finish',reason:{kind:'tool-calls'}}
    return
   }
   if(!visible)throw new LlmError('网页没有提取到模型回答','EMPTY_RESPONSE')
   yield {type:'block-start',index:0,blockType:'text'}
   yield {type:'text-delta',index:0,text:visible}
   yield {type:'block-end',index:0,block:{type:'text',text:visible}}
   yield {type:'finish',reason:{kind:'stop'}}
  }catch(error){
   const code=adapter.classifyError(error)
   const providerName=PROVIDER_MAP[selected].name
   const detail=error instanceof Error?error.message:String(error)
   if(code==='LOGIN_REQUIRED'||code==='SESSION_EXPIRED'){
    throw new LlmError(`${providerName} 尚未完成登录或登录状态已失效。请在 DSH 右侧浏览器完成登录/验证，确认页面可以正常对话后，再回到 DSH Chat 重新发送。\n浏览器地址：${PROVIDER_MAP[selected].url}`,'AUTH',{cause:error})
   }
   if(code==='PAGE_CHANGED'){
    throw new LlmError(`${providerName} 右侧浏览器的页面或会话发生变化，当前请求无法继续。请在右侧浏览器恢复到可对话页面，然后在 DSH Chat 重新发送。\n浏览器地址：${PROVIDER_MAP[selected].url}`,'PROVIDER_ERROR',{cause:error})
   }
   if(code==='SERVICE_UNAVAILABLE'){
    throw new LlmError(`${providerName} 没有在规定时间内返回响应。请检查 DSH 右侧浏览器中的页面、网络和登录状态，修复后在 DSH Chat 重新发送。\n浏览器地址：${PROVIDER_MAP[selected].url}`,'UNAVAILABLE',{cause:error})
   }
   const mapped=code==='RATE_LIMITED'?'RATE_LIMIT':code==='QUOTA_EXCEEDED'?'QUOTA_EXCEEDED':code==='SERVICE_UNAVAILABLE'?'UNAVAILABLE':'PROVIDER_ERROR'
   throw error instanceof LlmError?error:new LlmError(`${providerName} Web AI 请求失败：${detail}` ,mapped,{cause:error})
  }
 }

 private buildBrowserPrompt(
  options:GenerateOptions,
  firstTurn:boolean,
  tools:NonNullable<GenerateOptions['tools']>,
 ):string{
  const toolInstruction=tools.length?this.buildToolInstruction(tools):''
  if(!firstTurn){
   const latest=options.messages.at(-1)
   const content=this.renderMessageContent(latest)
   if(latest?.role==='tool'){
    return [
     '继续执行当前 DSH Agent 任务。',
     toolInstruction,
     '下面是刚刚由 DSH 主机实际执行工具得到的结果。不要把它当成用户新问题，也不要伪造工具执行；请基于结果继续推理。',
     '<dsh_tool_result>',
     content,
     '</dsh_tool_result>',
    ].filter(Boolean).join('\n\n')
   }
   if(latest?.role==='user'){
    return [
     '继续当前 DSH Agent 对话。网页会话中已经保留此前对话历史，请只处理下面这一条新的用户消息。',
     toolInstruction,
     '<dsh_user_message>',
     content,
     '</dsh_user_message>',
    ].filter(Boolean).join('\n\n')
   }
   return [toolInstruction,content].filter(Boolean).join('\n\n')
  }

  const history=options.messages.map(message=>{
   const content=this.renderMessageContent(message)
   return `[${message.role}]\n${content}`
  }).join('\n\n')
  return [
   '你现在是 DSH Agent 使用的 Web AI 模型。DSH 主机负责工作区、文件、命令和工具执行；你只负责理解任务、推理并返回下一步结果。',
   '下面是本次 DSH 请求的完整已组装上下文。请把它视为一次真实 LLM 请求的 messages，不要要求用户重新提供这些上下文。',
   toolInstruction,
   '<dsh_messages>',
   history,
   '</dsh_messages>',
  ].filter(Boolean).join('\n\n')
 }

 private buildToolInstruction(tools:NonNullable<GenerateOptions['tools']>):string{
  const catalog=tools.map(tool=>JSON.stringify({
   name:tool.name,
   description:tool.description,
   parameters:tool.parameters,
  })).join('\n')
  return [
   'DSH 主机保留工具执行权。',
   '如果需要调用工具，只能输出一个或多个 <dsh_tool_call>...</dsh_tool_call>。',
   '标签内部必须是 JSON：{"id":"可选调用ID","name":"工具名","arguments":工具参数对象}。',
   '不要直接声称工具已经执行；必须先输出工具调用，等待 DSH 主机返回工具结果。',
   '如果不需要工具，直接正常回答。',
   '当前可用工具：',
   catalog,
  ].join('\n')
 }

 private renderMessageContent(message:GenerateOptions['messages'][number]|undefined):string{
  if(!message)return ''
  if(typeof message.content==='string')return message.content
  return message.content.map(block=>{
   if(block.type==='text')return block.text
   if(block.type==='reasoning')return `[reasoning]\n${block.text}`
   if(block.type==='tool-call')return `[tool-call ${block.name}]\n${block.arguments}`
   if(block.type==='tool-addition')return `[tool-addition] ${block.toolName}`
   if(block.type==='tool-removal')return `[tool-removal] ${block.toolName}`
   if(block.type==='file')return `[file] ${block.attachment.name??'unnamed'}`
   if(block.type==='image')return `[image] ${block.attachment.name??'unnamed'}`
   return ''
  }).filter(Boolean).join('\n')
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
    const match=block.text.match(/\[File\s+"[^"]+"\s+\(\d+\s+bytes,\s+sha256:[^)]+\):\s+verbatim\s+read-only\s+copy\s+saved\s+at\s+"([^"]+)"/)
    if(match){
     try{result.push({path:JSON.parse('"'+match[1]+'"'),kind:'file'})}catch{}
    }
   }
  }
  const seen=new Set<string>()
  return result.filter(x=>seen.has(x.path)?false:(seen.add(x.path),true))
 }
}

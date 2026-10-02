import {request} from 'node:http'

export interface CdpTab { id:string; url:string; title:string; webSocketDebuggerUrl?:string }

export interface CdpClient {
 /** timeoutMs：单次 DOM 表达式执行超时（毫秒）；缺省由底层 Bridge 使用默认值（大 payload 填充建议传更大值） */
 evaluate<T>(expression:string,timeoutMs?:number):Promise<T>
 /** Bind page operations to one DSH Session when the transport supports session routing. */
 withSession?(sessionId:string):CdpClient
 setFileInputFiles(selector:string,files:readonly string[]):Promise<void>
 close():Promise<void>
}

export async function listTabs(port:number):Promise<CdpTab[]>{
 const raw=await httpGet(port,'/json/list')
 return JSON.parse(raw) as CdpTab[]
}

export async function connectTab(tab:CdpTab):Promise<CdpClient>{
 if(!tab.webSocketDebuggerUrl)throw new Error('目标 Chromium 页面没有 CDP WebSocket')
 const ws=new WebSocket(tab.webSocketDebuggerUrl)
 await waitOpen(ws)
 let id=0
 const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:any)=>void}>()
 ws.onmessage=e=>{
  const m=JSON.parse(String(e.data))
  if(m.id&&pending.has(m.id)){
   const p=pending.get(m.id)!
   pending.delete(m.id)
   m.error?p.reject(new Error(m.error.message||'CDP error')):p.resolve(m.result)
  }
 }
 const call=(method:string,params:Record<string,unknown>={})=>new Promise<any>((resolve,reject)=>{
  const n=++id
  pending.set(n,{resolve,reject})
  ws.send(JSON.stringify({id:n,method,params}))
 })
 await call('Runtime.enable')
 return {
  async evaluate<T>(expression:string){
   const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
   if(result.exceptionDetails)throw new Error(result.exceptionDetails.text||'页面脚本执行失败')
   return result.result?.result?.value as T
  },
  async setFileInputFiles(selector:string,files:readonly string[]){
   await call('DOM.enable')
   const root=await call('DOM.getDocument',{depth:-1})
   const node=await call('DOM.querySelector',{nodeId:root.root.nodeId,selector})
   if(!node?.nodeId)throw new Error('PAGE_CHANGED: 未找到浏览器文件上传控件')
   await call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[...files]})
   await call('Runtime.evaluate',{
    expression:`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el){el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}})()`
   })
  },
  async close(){
   for(const p of pending.values())p.reject(new Error('CDP closed'))
   pending.clear()
   ws.close()
  }
 }
}

function httpGet(port:number,path:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path},res=>{
   const a:Buffer[]=[]
   res.on('data',c=>a.push(Buffer.from(c)))
   res.on('end',()=>res.statusCode===200?resolve(Buffer.concat(a).toString('utf8')):reject(new Error('CDP HTTP '+res.statusCode)))
  })
  req.on('error',reject)
  req.end()
 })
}

function waitOpen(ws:WebSocket){
 return new Promise<void>((resolve,reject)=>{
  ws.addEventListener('open',()=>resolve(),{once:true})
  ws.addEventListener('error',()=>reject(new Error('无法连接 Chromium CDP')),{once:true})
 })
}

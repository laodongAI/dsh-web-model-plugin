import type { IncomingMessage,ServerResponse } from 'node:http'
import type { AccountManager } from './account-manager.js'
import type { AccountProvider } from './types.js'
export function registerRoutes(m:AccountManager,register:(r:{kind:'exact'|'prefix';path:string;handler:(q:IncomingMessage,s:ServerResponse)=>void|Promise<void>})=>()=>void){
 const routes=[
 {kind:'exact' as const,path:'/api/dsh-account-models/accounts',handler:async(_q,s)=>json(s,m.list())},
 {kind:'exact' as const,path:'/api/dsh-account-models/accounts/add',handler:async(q,s)=>{if(q.method!=='POST')return json(s,{error:'Method Not Allowed'},405);try{const b=await body(q) as {provider?:AccountProvider;displayName?:string};if(b.provider!=='deepseek'&&b.provider!=='chatgpt')return json(s,{error:'provider 必须是 deepseek 或 chatgpt'},400);return json(s,await m.add(b.provider,b.displayName))}catch(e){return json(s,{error:e instanceof Error?e.message:String(e)},500)}}},
 {kind:'prefix' as const,path:'/api/dsh-account-models/accounts/',handler:async(q,s)=>{const p=new URL(q.url??'/', 'http://dsh.local').pathname.split('/').filter(Boolean);const id=p[p.length-2],action=p[p.length-1];try{if(q.method==='POST'&&action==='open')return json(s,await m.open(id));if(q.method==='POST'&&action==='close')return json(s,await m.close(id));if(q.method==='DELETE'&&action==='account'){await m.remove(id);return json(s,{ok:true})}return json(s,{error:'Not Found'},404)}catch(e){return json(s,{error:e instanceof Error?e.message:String(e)},400)}}}
 ];const ds=routes.map(register);return()=>ds.forEach(d=>d())}
async function body(q:IncomingMessage){const a:Buffer[]=[];for await(const c of q)a.push(Buffer.from(c));return a.length?JSON.parse(Buffer.concat(a).toString('utf8')):{}}
function json(s:ServerResponse,v:unknown,status=200){s.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});s.end(JSON.stringify(v))}
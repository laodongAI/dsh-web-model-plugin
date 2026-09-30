const React=require('react')
const {createElement,useEffect,useMemo,useState}=React

const PROVIDERS=[
 ['deepseek','DeepSeek'],['chatgpt','ChatGPT'],['qwen','Qwen'],
 ['tencent-yuanbao','腾讯混元 AI Studio'],['doubao','豆包'],['perplexity','Perplexity'],
 ['copilot','Microsoft Copilot'],['huggingchat','HuggingChat'],['kimi','Kimi'],['chatglm','智谱 AI'],
]

async function api(path,options){
 const r=await fetch(path,{headers:{'content-type':'application/json',...(options?.headers||{})},...options})
 const data=await r.json()
 if(!r.ok)throw new Error(data?.error||'请求失败')
 return data
}

function WebAiSettingsPage({openLive}){
 const [accounts,setAccounts]=useState([])
 const [config,setConfig]=useState({})
 const [provider,setProvider]=useState('deepseek')
 const [accountId,setAccountId]=useState('')
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState('')
 const [message,setMessage]=useState('')

 async function refresh(){
  setLoading(true)
  try{
   const [a,c]=await Promise.all([api('/api/dsh-account-models/accounts'),api('/api/dsh-account-models/config')])
   setAccounts(a);setConfig(c)
   setProvider(c.defaultProvider||a[0]?.provider||'deepseek')
   setAccountId(c.defaultAccountId||a[0]?.id||'')
  }catch(e){
   setMessage(e instanceof Error?e.message:String(e))
  }finally{setLoading(false)}
 }

 useEffect(()=>{void refresh()},[])

 const filtered=useMemo(()=>accounts.filter(a=>a.provider===provider),[accounts,provider])

 async function addAccount(){
  setBusy('add');setMessage('')
  try{
   await api('/api/dsh-account-models/accounts/add',{method:'POST',body:JSON.stringify({provider})})
   await refresh()
   setMessage('浏览器已打开，请完成网页登录，然后点击“检查登录状态”。')
  }catch(e){setMessage(e instanceof Error?e.message:String(e))}
  finally{setBusy('')}
 }

 async function removeAccount(id){
 setBusy(id);setMessage('')
 try{
  await api('/api/dsh-account-models/accounts/remove',{method:'POST',body:JSON.stringify({accountId:id})})
  if(accountId===id)setAccountId('')
  await refresh()
  setMessage('浏览器账号已删除')
 }catch(e){setMessage(e instanceof Error?e.message:String(e))}
 finally{setBusy('')}
}

 async function check(id){
  setBusy(id);setMessage('')
  try{
   const a=await api('/api/dsh-account-models/accounts/check',{method:'POST',body:JSON.stringify({accountId:id})})
   setAccounts(v=>v.map(x=>x.id===a.id?a:x))
   setMessage(a.status==='ready'?'登录状态：已就绪':'登录状态：仍需登录')
  }catch(e){setMessage(e instanceof Error?e.message:String(e))}
  finally{setBusy('')}
 }

 async function save(){
  setBusy('save');setMessage('')
  try{
   const c=await api('/api/dsh-account-models/config',{method:'POST',body:JSON.stringify({defaultProvider:provider,defaultAccountId:accountId})})
   setConfig(c);setMessage('默认 Web AI Provider 已保存')
  }catch(e){setMessage(e instanceof Error?e.message:String(e))}
  finally{setBusy('')}
 }

 if(loading)return createElement('div',{style:{padding:24}},'正在加载 Web AI 配置…')

 return createElement('div',{style:{padding:'24px 28px',maxWidth:760}},
  createElement('div',{style:{marginBottom:20}},
   createElement('h2',{style:{margin:'0 0 6px'}},'Web AI 浏览器模型'),
   createElement('div',{style:{opacity:.7}},'通过可见 Chromium 浏览器使用 Web AI，不保存密码、Cookie 或 Token。')
  ),
  createElement('section',{style:{padding:16,border:'1px solid currentColor',borderRadius:10,marginBottom:16}},
   createElement('h3',null,'默认 Provider'),
   createElement('select',{value:provider,onChange:e=>{setProvider(e.target.value);setAccountId('')},style:{padding:8,minWidth:300}},
    PROVIDERS.map(([id,name])=>createElement('option',{key:id,value:id},name))
   ),
   createElement('div',{style:{marginTop:14}},
    createElement('div',{style:{marginBottom:8}},'浏览器账号'),
    filtered.length?filtered.map(a=>createElement('label',{key:a.id,style:{display:'flex',alignItems:'center',gap:10,padding:'8px 0'}},
     createElement('input',{type:'radio',name:'web-ai-account',checked:accountId===a.id,onChange:()=>setAccountId(a.id)}),
     createElement('span',null,a.displayName),
     createElement('span',{style:{opacity:.65}},a.status==='ready'?'● 已就绪':a.status==='login_required'?'○ 需要登录':'○ '+a.status),
     createElement('button',{type:'button',disabled:busy===a.id,onClick:()=>check(a.id),style:{marginLeft:'auto'}},busy===a.id?'检查中…':'检查登录状态'),
     createElement('button',{type:'button',disabled:busy===a.id,onClick:()=>removeAccount(a.id)},'删除')
    )):createElement('div',{style:{opacity:.7}},'当前 Provider 尚未添加浏览器账号。'),
    createElement('button',{type:'button',disabled:busy==='add',onClick:addAccount,style:{marginTop:8}},busy==='add'?'正在启动浏览器…':'添加并打开浏览器')
   )
  ),
  createElement('div',{style:{display:'flex',alignItems:'center',gap:12}},
   createElement('button',{type:'button',disabled:!accountId||busy==='save',onClick:save},busy==='save'?'保存中…':'保存默认 Provider'),
   createElement('button',{type:'button',disabled:!accountId,onClick:()=>openLive(accountId)},'打开浏览器交互'),
   message?createElement('span',{style:{opacity:.75}},message):null
  ),
  config.defaultAccountId?createElement('div',{style:{marginTop:18,opacity:.65}},'当前默认账号：'+config.defaultAccountId):null
 )
}

const inject=['slots']

function apply(ctx){
 console.info('[dsh-account-models] client apply')
 ctx.slots.inject('settings.section',()=>ctx.slots.register({
  name:'settings.section',
  id:'dsh-account-models',
  order:30,
  label:()=> 'Web AI',
 },props=>createElement(WebAiSettingsPage,{...props,openLive:()=>{}})))
 console.info('[dsh-account-models] client settings registered')
}
module.exports={inject,apply}

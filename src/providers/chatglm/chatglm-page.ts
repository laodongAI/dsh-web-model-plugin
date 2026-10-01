 async readAnswer(previous:string){return this.readLatest("[class*=\"markdown\"],[class*=\"message\"],[class*=\"assistant\"],main article",previous)}

 async isGenerating(){return this.isBusy()}
 async detectError(){
  return this.cdp.evaluate<{code:string;message:string}|null>(`(()=>{const t=document.body?.innerText||'';if(/微信扫码登录|手机号登录|请输入手机号|获取验证码/i.test(t)&&!document.querySelector('textarea,[contenteditable="true"],input[placeholder*="聊天"],input[placeholder*="消息"]'))return {code:'LOGIN_REQUIRED',message:'智谱 AI 当前尚未进入可对话状态，请在网页中完成登录'};if(/积分不足|额度|quota|limit reached/i.test(t))return {code:'QUOTA_EXCEEDED',message:'当前智谱 AI 账号达到使用限制'};if(/频繁|too many|rate limit/i.test(t))return {code:'RATE_LIMITED',message:'智谱 AI 请求过于频繁'};if(/服务异常|service unavailable|网络错误/i.test(t))return {code:'SERVICE_UNAVAILABLE',message:'智谱 AI Web 服务暂时不可用'};return null})()`)
 }
}
 async detectError(){return this.commonError("微信扫码登录|手机号登录|请输入手机号|获取验证码")}

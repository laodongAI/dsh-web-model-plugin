 async readAnswer(previous:string){return this.readLatest("[data-message-author-role=\"assistant\"]",previous)}

 async isGenerating(){return this.isBusy()}
 async detectError(){return this.cdp.evaluate<{code:string;message:string}|null>(`(()=>{const t=document.body?.innerText||'';if(/log in|sign up|登录|注册/i.test(t)&&!document.querySelector('textarea,[contenteditable="true"]'))return {code:'LOGIN_REQUIRED',message:'ChatGPT 需要登录'};if(/usage limit|quota|limit reached|额度/i.test(t))return {code:'QUOTA_EXCEEDED',message:'当前 ChatGPT 账号达到使用限制'};if(/too many|rate limit|频繁/i.test(t))return {code:'RATE_LIMITED',message:'请求过于频繁'};return null})()`)}
} async detectError(){return this.commonError("log in|sign up|登录|注册")}}
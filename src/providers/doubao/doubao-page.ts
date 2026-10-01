 async readAnswer(previous:string){return this.readLatest("[class*=\"message\"],[class*=\"markdown\"],main article",previous)}

 async isGenerating(){return this.isBusy()}
 async detectError(){return this.cdp.evaluate<any>(`(()=>{const t=document.body?.innerText||'';if(/登录|手机号登录|登录后/i.test(t)&&!document.querySelector('textarea,[contenteditable="true"]'))return {code:'LOGIN_REQUIRED',message:'豆包需要登录'};if(/额度|频繁|rate limit|too many/i.test(t))return {code:'RATE_LIMITED',message:'豆包请求受到限制'};return null})()`)}
} async detectError(){return this.commonError("登录|sign in|log in")}}
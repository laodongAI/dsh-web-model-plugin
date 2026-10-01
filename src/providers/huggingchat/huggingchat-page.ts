 async readAnswer(previous:string){return this.readLatest("[data-testid*=\"message\"],[class*=\"message\"],main article",previous)}

 async isGenerating(){return this.isBusy()}
 async detectError(){return this.cdp.evaluate<any>(`(()=>{const t=document.body?.innerText||'';if(/sign in|登录/i.test(t)&&!document.querySelector('textarea,[contenteditable="true"]'))return {code:'LOGIN_REQUIRED',message:'HuggingChat 需要登录'};if(/limit|quota|too many/i.test(t))return {code:'QUOTA_EXCEEDED',message:'HuggingChat 当前达到限制'};return null})()`)}
} async detectError(){return this.commonError("登录|sign in|log in")}}
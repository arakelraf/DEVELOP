/** Emits workflows/05-fb-delete.json - "05 - FB Delete Post".
 * POST {"post_id":"..."} → derives the Page token → DELETE /{post_id}.
 * Use only to clean up test posts. */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const FB_TOKEN={id:'k62FLo1U37qyXxOk',name:'Facebook User Token'};
const CONFIG='Fzx5awBGnmaDaffF';
const resp={timeout:30000,response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}}};
const nodes=[
 {id:'wh',name:'Del Webhook',type:'n8n-nodes-base.webhook',typeVersion:2.1,position:[200,0],
  parameters:{httpMethod:'POST',path:'fb-delete',responseMode:'lastNode',options:{}}},
 {id:'cfg',name:'Load Config',type:'n8n-nodes-base.dataTable',typeVersion:1.1,position:[420,0],alwaysOutputData:true,
  parameters:{resource:'row',operation:'get',dataTableId:{__rl:true,mode:'id',value:CONFIG},matchType:'allConditions',filters:{},returnAll:true}},
 {id:'cm',name:'Config',type:'n8n-nodes-base.code',typeVersion:2,position:[640,0],parameters:{jsCode:read('build/config-map.js')}},
 {id:'acc',name:'List Pages',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[860,0],
  parameters:{method:'GET',url:"={{ 'https://graph.facebook.com/'+$('Config').first().json.FB_API_VERSION+'/me/accounts' }}",
   authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendQuery:true,
   queryParameters:{parameters:[{name:'fields',value:'id,name,access_token'}]},options:resp},
  credentials:{httpHeaderAuth:FB_TOKEN},onError:'continueRegularOutput',alwaysOutputData:true},
 {id:'pp',name:'Pick Page',type:'n8n-nodes-base.code',typeVersion:2,position:[1080,0],parameters:{jsCode:read('build/pick-page.js')}},
 {id:'del',name:'Delete Post',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[1300,0],
  parameters:{method:'DELETE',
   url:"={{ 'https://graph.facebook.com/'+$('Config').first().json.FB_API_VERSION+'/'+$('Del Webhook').first().json.body.post_id }}",
   sendHeaders:true,headerParameters:{parameters:[{name:'Authorization',value:"={{ 'Bearer '+$json.page_token }}"}]},
   options:resp},
  onError:'continueRegularOutput',alwaysOutputData:true},
 {id:'rep',name:'Report',type:'n8n-nodes-base.code',typeVersion:2,position:[1520,0],parameters:{jsCode:
  "const d=$('Delete Post').first().json;const b=d.body&&typeof d.body==='object'?d.body:d;"
  +"return [{json:{http:d.statusCode,result:b}}];"}},
];
const m=n=>({node:n,type:'main',index:0});
const wf={name:'05 - FB Delete Post',nodes,connections:{
 'Del Webhook':{main:[[m('Load Config')]]},'Load Config':{main:[[m('Config')]]},'Config':{main:[[m('List Pages')]]},
 'List Pages':{main:[[m('Pick Page')]]},'Pick Page':{main:[[m('Delete Post')]]},'Delete Post':{main:[[m('Report')]]},
},settings:{executionOrder:'v1',timezone:'Europe/Belgrade',saveDataSuccessExecution:'all',saveManualExecutions:true}};
fs.writeFileSync(path.join(ROOT,'workflows/05-fb-delete.json'),JSON.stringify(wf,null,2)+'\n');
console.log('wrote 05-fb-delete.json');

/**
 * Emits workflows/04-fb-deep-check.json - "04 - FB Deep Check".
 * Reports NAMES and COUNTS only (no tokens) for /me, /me/permissions,
 * /me/accounts, using the Facebook User Token credential. Read-only.
 */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const FB_TOKEN={id:'k62FLo1U37qyXxOk',name:'Facebook User Token'};
const auth={authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth'};
const resp={timeout:30000,response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}}};
const ver='v21.0';
const get=(id,name,x,y,url,extra)=>({id,name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[x,y],
  parameters:{method:'GET',url,...auth,...(extra||{}),options:resp},
  credentials:{httpHeaderAuth:FB_TOKEN},onError:'continueRegularOutput',alwaysOutputData:true});

const reportCode = [
  '// Mode: Run Once for All Items. Names and counts only - no tokens.',
  "const body=(n)=>{try{const j=$(n).first().json;return j&&j.body!==undefined?j.body:j;}catch{return null;}};",
  "const status=(n)=>{try{return $(n).first().json.statusCode;}catch{return null;}};",
  "const me=body('Me'), perm=body('Permissions'), acc=body('Accounts'), pg=body('Page');",
  "const granted=(perm&&perm.data||[]).filter(p=>p.status==='granted').map(p=>p.permission);",
  "const declined=(perm&&perm.data||[]).filter(p=>p.status!=='granted').map(p=>p.permission+':'+p.status);",
  "const accErr=(acc&&acc.error)?(acc.error.type+' '+(acc.error.code||'')+': '+acc.error.message):null;",
  "return [{json:{",
  "  me_name:me&&me.name, me_id:me&&me.id,",
  "  granted_permissions:granted,",
  "  declined_or_missing:declined,",
  "  accounts_status:status('Accounts'),",
  "  accounts_error:accErr,",
  "  pages_count:(acc&&Array.isArray(acc.data))?acc.data.length:'n/a',",
  "  page_names:(acc&&acc.data||[]).map(p=>p.name),",
  "  page_tasks:(acc&&acc.data||[]).map(p=>({name:p.name,tasks:p.tasks})),",
  "  page_status:status('Page'),",
  "  page_direct:(pg&&pg.error)?('ERR '+pg.error.code+' '+pg.error.message):(pg&&pg.name),",
  "}}];",
].join('\n');

const nodes=[
  {id:'wh',name:'Deep Webhook',type:'n8n-nodes-base.webhook',typeVersion:2.1,position:[200,0],
   parameters:{httpMethod:'POST',path:'fb-deep-check',responseMode:'lastNode',options:{}}},
  get('me','Me',420,-120,`https://graph.facebook.com/${ver}/me`,
    {sendQuery:true,queryParameters:{parameters:[{name:'fields',value:'id,name'}]}}),
  get('perm','Permissions',420,40,`https://graph.facebook.com/${ver}/me/permissions`),
  get('acc','Accounts',420,200,`https://graph.facebook.com/${ver}/me/accounts`,
    {sendQuery:true,queryParameters:{parameters:[{name:'fields',value:'id,name,tasks'}]}}),
  get('pg','Page',420,340,`https://graph.facebook.com/${ver}/1378170695380729`,
    {sendQuery:true,queryParameters:{parameters:[{name:'fields',value:'id,name'}]}}),
  {id:'rep',name:'Report',type:'n8n-nodes-base.code',typeVersion:2,position:[680,0],
   parameters:{jsCode:reportCode}},
];
const m=(n)=>({node:n,type:'main',index:0});
const wf={name:'04 - FB Deep Check',nodes,connections:{
  'Deep Webhook':{main:[[m('Me'),m('Permissions'),m('Accounts'),m('Page')]]},
  'Me':{main:[[m('Report')]]},'Permissions':{main:[[m('Report')]]},'Accounts':{main:[[m('Report')]]},'Page':{main:[[m('Report')]]},
},settings:{executionOrder:'v1',timezone:'Europe/Belgrade',saveDataSuccessExecution:'all',saveManualExecutions:true}};
fs.writeFileSync(path.join(ROOT,'workflows/04-fb-deep-check.json'),JSON.stringify(wf,null,2)+'\n');
console.log('wrote 04-fb-deep-check.json');

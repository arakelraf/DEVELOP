/**
 * Emits workflows/04-fb-deep-check.json - "04 - FB Deep Check".
 * Dumps the RAW Facebook responses for /me, /me/permissions and /me/accounts
 * so a no_pages can be diagnosed precisely. Read-only; publishes nothing.
 */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const FB_OAUTH={id:'gew3mnOJy0FEybxs',name:'Facebook OAuth (login)'};
const oauth={authentication:'genericCredentialType',genericAuthType:'oAuth2Api'};
const resp={timeout:30000,response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}}};
const ver="v21.0";
const get=(id,name,x,y,url,extra)=>({id,name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[x,y],
  parameters:{method:'GET',url,...oauth,...(extra||{}),options:resp},
  credentials:{oAuth2Api:FB_OAUTH},onError:'continueRegularOutput',alwaysOutputData:true});

const nodes=[
  {id:'wh',name:'Deep Webhook',type:'n8n-nodes-base.webhook',typeVersion:2.1,position:[200,0],
   parameters:{httpMethod:'POST',path:'fb-deep-check',responseMode:'lastNode',options:{}}},
  get('me','Me',420,-120,`https://graph.facebook.com/${ver}/me`,
    {sendQuery:true,queryParameters:{parameters:[{name:'fields',value:'id,name'}]}}),
  get('perm','Permissions',420,40,`https://graph.facebook.com/${ver}/me/permissions`),
  get('acc','Accounts',420,200,`https://graph.facebook.com/${ver}/me/accounts`,
    {sendQuery:true,queryParameters:{parameters:[{name:'fields',value:'id,name,access_token,tasks'}]}}),
  {id:'rep',name:'Report',type:'n8n-nodes-base.code',typeVersion:2,position:[680,0],
   parameters:{jsCode:
    "// Mode: Run Once for All Items.\n"
    +"const body=(n)=>{try{const j=$(n).first().json;return j&&j.body!==undefined?j.body:j;}catch{return 'node did not run';}};\n"
    +"const status=(n)=>{try{return $(n).first().json.statusCode;}catch{return null;}};\n"
    +"const me=body('Me'), perm=body('Permissions'), acc=body('Accounts');\n"
    +"const granted=(perm&&perm.data||[]).filter(p=>p.status==='granted').map(p=>p.permission);\n"
    +"const declined=(perm&&perm.data||[]).filter(p=>p.status!=='granted').map(p=>p.permission+':'+p.status);\n"
    +"return [{json:{\n"
    +"  me_status:status('Me'), me,\n"
    +"  granted_permissions:granted,\n"
    +"  declined_or_missing:declined,\n"
    +"  has_pages_show_list:granted.includes('pages_show_list'),\n"
    +"  has_pages_manage_posts:granted.includes('pages_manage_posts'),\n"
    +"  accounts_status:status('Accounts'),\n"
    +"  pages_returned:(acc&&Array.isArray(acc.data))?acc.data.length:'n/a',\n"
    +"  pages:(acc&&acc.data||[]).map(p=>({id:p.id,name:p.name,tasks:p.tasks,has_token:Boolean(p.access_token)})),\n"
    +"  accounts_raw:acc,\n"
    +"}}];\n"}},
];
const m=(n)=>({node:n,type:'main',index:0});
const wf={name:'04 - FB Deep Check',nodes,connections:{
  'Deep Webhook':{main:[[m('Me'),m('Permissions'),m('Accounts')]]},
  'Me':{main:[[m('Report')]]},'Permissions':{main:[[m('Report')]]},'Accounts':{main:[[m('Report')]]},
},settings:{executionOrder:'v1',timezone:'Europe/Belgrade',saveDataSuccessExecution:'all',saveManualExecutions:true}};
fs.writeFileSync(path.join(ROOT,'workflows/04-fb-deep-check.json'),JSON.stringify(wf,null,2)+'\n');
console.log('wrote 04-fb-deep-check.json');

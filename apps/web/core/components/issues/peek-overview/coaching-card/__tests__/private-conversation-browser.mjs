import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../../../..");
const root=path.resolve(web,"../..");
const require=createRequire(path.join(web,"package.json"));
const packages=await readdir(path.join(root,"node_modules/.pnpm"));
const esbuildPath=packages.find(name=>/^esbuild@/.test(name));
const {build}=require(path.join(root,"node_modules/.pnpm",esbuildPath,"node_modules/esbuild"));
const temp=await mkdtemp(path.join(tmpdir(),"private-chat-browser-"));
await writeFile(path.join(temp,"mocks.tsx"),`
import React from "react";
export const CustomSelect=Object.assign(({children,value,onChange})=><select value={value} onChange={event=>onChange(event.target.value)}>{children}</select>,{Option:({children,value})=><option value={value}>{children}</option>});
export const Avatar=({name})=><span aria-label={name}>{name?.[0]}</span>;
export const API_BASE_URL="";
export const useUser=()=>({data:{id:"coach"}});
export const Button=({children,onClick,disabled})=><button disabled={disabled} onClick={onClick}>{children}</button>;
`);
const component=path.join(web,"core/components/issues/peek-overview/coaching-card/private-conversation.tsx");
await writeFile(path.join(temp,"fixture.tsx"),`
import React from "react";
import { createRoot } from "react-dom/client";
import { CoachPrivateConversation } from ${JSON.stringify(component)};
createRoot(document.getElementById("root")).render(<CoachPrivateConversation issueId="card" projectId="program" workspaceSlug="school" disabled={false}/>);
const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await wait();}throw new Error("Timed out");};
const check=(value,message)=>{if(!value)throw new Error(message);};
const setDraft=async text=>{const field=document.querySelector("textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,text);field.dispatchEvent(new Event("input",{bubbles:true}));await wait();};
const button=text=>[...document.querySelectorAll("button")].find(node=>node.textContent===text);
(async()=>{
 await until(()=>document.body.textContent.includes("Alpha secret"));
 check(!document.body.textContent.includes("Beta secret"),"other player's messages must be hidden");
 await setDraft("Draft for Alpha");
 const selector=document.querySelector("select");selector.value="beta";selector.dispatchEvent(new Event("change",{bubbles:true}));
 await until(()=>document.body.textContent.includes("Beta secret"));
 check(!document.body.textContent.includes("Alpha secret"),"old player's messages must disappear");
 check(document.querySelector("textarea").value==="","draft must not move to another player");
 await setDraft("Private beta reply");button("Send private reply").click();
 await until(()=>[...document.querySelectorAll("article p")].some(node=>node.textContent==="Private beta reply"));
 check(document.querySelector("textarea").value==="","confirmed send clears draft");
 check(!button("Attach clip"),"there must be no attachment choices menu");
 check(!!button("Upload clip from device"),"direct device upload must be offered");
 await until(()=>document.querySelector('input[type="file"]'));
 const fileInput=document.querySelector('input[type="file"]');let pickerOpened=false;fileInput.addEventListener("click",event=>{event.preventDefault();pickerOpened=true;});button("Upload clip from device").click();check(pickerOpened,"one button must open device picker directly");
 const input=document.querySelector('input[type="file"]');const files=new DataTransfer();files.items.add(new File([new Uint8Array([1,2,3])],"practice.mp4",{type:"video/mp4"}));input.files=files.files;input.dispatchEvent(new Event("change",{bubbles:true}));
 await until(()=>document.body.textContent.includes("practice.mp4")&&!button("Send private reply").disabled);button("Send private reply").click();
 await until(()=>document.querySelector('button[aria-label="Play clip: practice.mp4"]'));
 check(!document.querySelector("video"),"video players must wait until a clip is opened");
 const play=document.querySelector('button[aria-label="Play clip: practice.mp4"]');
 check(!!play,"sent video must have an accessible play card");play.click();
 await until(()=>document.querySelector("article video"));
 check(!document.querySelector('[role="dialog"]'),"video must play inside its message bubble");
 button("Close video").click();
 await until(()=>!document.querySelector("video"));
 await setDraft("FAIL_FIXTURE");button("Send private reply").click();
 await until(()=>document.body.textContent.includes("could not be confirmed"));
 check(document.querySelector("textarea").value==="FAIL_FIXTURE","failed send keeps draft");
 check(button("Send private reply").disabled,"uncertain send must block retry");
 await fetch("/control/revoke");button("Refresh private messages").click();
 await until(()=>document.body.textContent.includes("could not be loaded"));
 check(!document.body.textContent.includes("Beta secret"),"revocation hides cached messages");
 check(button("Send private reply").disabled,"revocation blocks sending");
 document.body.append(Object.assign(document.createElement("pre"),{textContent:"PRIVATE-CHAT-PASS"}));
})().catch(error=>document.body.append(Object.assign(document.createElement("pre"),{textContent:"PRIVATE-CHAT-FAIL: "+error.message})));
`);
const bundle=await build({entryPoints:[path.join(temp,"fixture.tsx")],bundle:true,write:false,format:"iife",jsx:"automatic",
 alias:{"@plane/constants":path.join(temp,"mocks.tsx"),"@plane/ui":path.join(temp,"mocks.tsx"),"@/hooks/store/user":path.join(temp,"mocks.tsx"),"@/services/api.service":path.join(web,"core/services/api.service.ts")},
 nodePaths:[path.join(web,"node_modules"),path.join(root,"node_modules")],define:{"process.env.NODE_ENV":'"development"'}});
const {createServer}=await import("node:http");
const requests=[];let revoked=false;
const audience={visibility:"private",issue:"card",coach_id:"coach"};
const messages={alpha:[{id:"alpha-msg",text:"Alpha secret"}],beta:[{id:"beta-msg",text:"Beta secret"}]};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,"http://localhost");
 const json=(status,data)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(data));};
 if(url.pathname==="/fixture.js")return res.writeHead(200,{"Content-Type":"text/javascript"}).end(bundle.outputFiles[0].text);
 if(url.pathname==="/control/revoke"){revoked=true;return json(200,{});}
 if(url.pathname.startsWith("/api/")){
  requests.push({method:req.method,path:url.pathname});
  const prefix="/api/workspaces/school/projects/program/coaching-cards/card/private-threads/";
  if(url.pathname===prefix)return json(200,{...audience,recipients:[{id:"alpha",name:"Alpha"},{id:"beta",name:"Beta"}]});
  const remaining=url.pathname.slice(prefix.length).replace(/\/$/,"");
  const recipient=remaining.split("/")[0];
  if(!["alpha","beta"].includes(recipient))return json(404,{});
  if(revoked)return json(403,{});
  if(remaining.endsWith("/attachments")) {
   if(req.method==="GET")return json(200,{...audience,recipient_id:recipient,max_bytes:1073741824,clips:[{kind:"card_clip",clip_index:0,revision:"a".repeat(64),name:"Kickoff"}]});
   let length=0;for await(const chunk of req)length+=chunk.length;
   if(length!==3||req.headers["x-video-size"]!=="3")return json(400,{});
   return json(201,{id:"phone-upload",kind:"upload",name:"practice.mp4",size:3,duration:2,start_seconds:0,end_seconds:2});
  }
  const serialize=m=>({...audience,recipient_id:recipient,id:m.id,actor:m.actor||recipient,actor_detail:{id:m.actor||recipient,display_name:m.actor==="coach"?"Coach":recipient},access:"PRIVATE",comment_stripped:m.text,...(m.attachment?{attachment:m.attachment}:{}),created_at:"2026-11-03T00:00:00Z"});
  if(req.method==="POST"){
   let raw="";for await(const part of req)raw+=part;const body=JSON.parse(raw);
   if(body.visibility!=="private")return json(400,{});
   if(body.comment_html.includes("FAIL_FIXTURE"))return json(500,{});
   const msg={id:"reply-"+messages[recipient].length,actor:"coach",text:body.comment_html.replace(/<[^>]*>/g,""),...(body.attachment?{attachment:{id:body.attachment.kind==="upload"?body.attachment.id:"existing-clip",kind:body.attachment.kind,name:body.attachment.kind==="upload"?"practice.mp4":"Kickoff",size:3,duration:2,start_seconds:0,end_seconds:2}}:{})};messages[recipient].push(msg);return json(201,serialize(msg));
  }
  return json(200,{...audience,recipient_id:recipient,limit:50,offset:0,total_count:messages[recipient].length,results:messages[recipient].map(serialize)});
 }
 res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
try{
 const child=spawn(process.env.CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",["--headless","--no-sandbox","--disable-gpu","--no-first-run","--disable-background-networking","--user-data-dir="+path.join(temp,"profile"),"--virtual-time-budget=10000","--dump-dom",`http://127.0.0.1:${server.address().port}`]);
 let output="",errors="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>errors+=chunk);
 await new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(new Error("Chrome failed: "+errors.slice(-300))));});
 const failure=output.match(/PRIVATE-CHAT-FAIL:[^<]*/)?.[0];
 assert.ok(output.includes("PRIVATE-CHAT-PASS"),failure||"Private browser fixture did not finish");
 assert.ok(requests.every(r=>r.path.includes("/private-threads/")),"no shared-thread requests allowed");
 assert.ok(requests.some(r=>r.method==="POST"&&r.path.endsWith("/beta/")),"reply must target selected player");
 console.log("Private coach UI: player/draft isolation, text reply, direct raw phone upload, attachment-only sends, uncertain-send recovery and revoked-access hiding passed.");
}finally{server.close();}

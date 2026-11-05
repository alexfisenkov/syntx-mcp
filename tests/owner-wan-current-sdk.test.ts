import assert from "node:assert/strict";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import test from "node:test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {SyntxChatHttpClient} from "../src/adapter/syntx/chat-http-client.js";
import {SyntxHttpClient} from "../src/adapter/syntx/http-client.js";
import {OwnerCurrentVideoReferenceStore} from "../src/application/owner-current-video-reference-store.js";
import {OwnerCurrentVideoNativeService} from "../src/adapter/syntx/owner-current-video-reference-native.js";
import {OwnerCurrentVideoGenerationService} from "../src/application/owner-current-video-generation-service.js";
import {getOwnerWanCurrentFamilyDefinition,type OwnerWanCurrentNormalized,type OwnerWanCurrentIntent} from "../src/application/owner-wan-current-intent.js";
import {registerOwnerCurrentVideoReferenceTools} from "../src/mcp/owner-current-video-reference-tools.js";
import {registerOwnerWanCurrentTools} from "../src/mcp/owner-wan-current-tools.js";
function crc32(bytes:Uint8Array):number {let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function png(){const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(640,16);b.writeUInt32BE(640,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b;}
const attempt="link_wan_current_sdk_000000000001";
test("WAN current SDK binds measured refs, source settings and two access gates",async(t)=>{
 const now=()=>Date.parse("2026-11-06T00:00:00Z"),binding={tenant_id:"wan-current-sdk",subject:"owner"},uploads:string[]=[],posts:any[]=[],quotes:Record<string,string>[]=[],counters={chat:0};
 const broker={async useCredential<T>(f:(s:string)=>Promise<T>){return f("synthetic-wan-current-credential");}};
 const fetchImpl:typeof fetch=async(input,init={})=>{const u=new URL(String(input)),method=init.method??"GET";
  if(u.pathname.endsWith("/chats/upload-files")){const url=`https://r2.syntx.ai/wan-current-${uploads.length}`;uploads.push(url);return Response.json({files:[{url}]});}
  if(u.pathname.endsWith("/user/balance"))return Response.json({balance:"1000"});if(u.pathname.endsWith("/user/subscription"))return Response.json({active:true,type:"PRO",end_date:"2099-01-01"});
  if(u.pathname.endsWith("/get_model_info")){quotes.push(Object.fromEntries(u.searchParams));return Response.json({access:true,cost:1,discount_cost:null,free_remaining_generations:null,limit:null,show_warning:null});}
  if(u.pathname==="/api/v1/chats"&&method==="POST")return Response.json({uuid:`wan-chat-${++counters.chat}`});
  if(u.pathname.endsWith("/video/generate")){const body=JSON.parse(String(init.body));posts.push(body);return Response.json({id:`owner-${body.chat_id}`});}
  const match=/^\/api\/v1\/chats\/(wan-chat-\d+)\/(messages|bot-wan-chat-\d+)$/u.exec(u.pathname);if(match){const chat=match[1]!,body=posts.find(p=>p.chat_id===chat),ownerId=`owner-${chat}`,botId=`bot-${chat}`,model=body.settings.model_type;
   const media=body.settings.file_urls.map((r:{type:string;url:string},i:number)=>({id:`ref-${i}`,message_id:ownerId,object_type:r.type==="first_frame"||r.type==="last_frame"?"image":r.type==="first_clip"?"video":r.type,object_url:r.url,model_type:model}));
   const owner={id:ownerId,chat_id:42,author_id:7,message_object:[{id:"text",message_id:ownerId,object_type:"text",object_text:body.prompt,model_type:model},...media]};
   const bot={id:botId,chat_id:42,author_id:-1,message_object:[{id:`result-${chat}`,message_id:botId,object_type:"video",model_type:model}]};
   if(match[2]==="messages")return Response.json({messages:[owner,bot],pagination:{page:1,page_size:10,total_count:2,total_pages:1,has_previous:false,has_next:false}});
   return Response.json({...bot,message_object:[{...bot.message_object[0],object_url:"https://r2.syntx.ai/result.mp4",completed:true}]});}
  throw Error(`unexpected ${method} ${u.pathname}`);};
 const links={async getStatus(_binding:unknown,id:string){return {attempt_id:id,authorization_profile:"OBSERVED_OWNER_AUTHORIZED",status:"LINKED",expires_at:null,linked:true};}};
 const chat=new SyntxChatHttpClient({credentialBroker:broker,fetchImpl}),refs=new OwnerCurrentVideoReferenceStore({binding,linkService:links as never,resolveClient:()=>chat,ffprobePath:process.env.SYNTX_MEDIA_FFPROBE_PATH??join(process.cwd(),"ffprobe"),...(process.env.SYNTX_MEDIA_FFMPEG_PATH===undefined?{}:{ffmpegPath:process.env.SYNTX_MEDIA_FFMPEG_PATH}),now});
 const native=new OwnerCurrentVideoNativeService({binding,linkService:links as never,references:refs,resolveClient:()=>chat});
 const service=new OwnerCurrentVideoGenerationService<OwnerWanCurrentNormalized,OwnerWanCurrentIntent>({binding,linkService:links as never,references:refs,native,family:getOwnerWanCurrentFamilyDefinition(),createReadClient:()=>new SyntxHttpClient({credentialBroker:broker,fetchImpl}),now});
 const server=new McpServer({name:"wan-current",version:"1"}),client=new Client({name:"wan-current-test",version:"1"}),[caller,host]=InMemoryTransport.createLinkedPair();
 try{registerOwnerCurrentVideoReferenceTools(server,refs);registerOwnerWanCurrentTools(server,{service});await server.connect(host);await client.connect(caller);await client.listTools();
  const base={link_attempt_id:attempt,model_id:"wan_25_t2v_preview",prompt:"quiet scene",resolution:"720P",aspect_ratio:"16:9",video_duration:5,prompt_extend:true,seed:77,references:[]};
  const bad=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{...base,prompt:"  "}});assert.equal(bad.isError,true);assert.equal(counters.chat,0);assert.equal(quotes.length,0);
  const text=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:base});assert.notEqual(text.isError,true,JSON.stringify(text));assert.equal((text.structuredContent as any).status,"completed");
  assert.equal(posts[0].settings.seed,77);assert.equal(quotes.length,2);assert.equal(quotes[0]!.resolution,"720P");
  const upload=async(filename:string,mime_type:string,bytes:Buffer,model_id="wan_30_omni",trim?:{start_seconds:number;end_seconds:number})=>{const r=await client.callTool({name:"syntx_owner_upload_current_video_reference",arguments:{link_attempt_id:attempt,model_id,filename,mime_type,content_base64:bytes.toString("base64"),...(trim===undefined?{}:{trim})}});assert.notEqual(r.isError,true,JSON.stringify(r));return (r.structuredContent as {reference_handle:string}).reference_handle;};
  const image=await upload("image.png","image/png",png()),doc=await upload("source.pdf","application/pdf",Buffer.from("%PDF-1.7\n%%EOF\n"));
  const blankWithMedia=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{link_attempt_id:attempt,model_id:"wan_30_omni",prompt:"   ",resolution:"720P",aspect_ratio:"adaptive",video_duration:5,prompt_extend:true,seed:null,native_audio:true,rendering_speed:"basic",references:[{reference_handle:image,role:"image"},{reference_handle:doc,role:"file"}]}});
  assert.equal(blankWithMedia.isError,true);assert.equal(quotes.length,2);assert.equal(counters.chat,1);assert.equal(posts.length,1);
  const foreign=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{link_attempt_id:attempt,model_id:"wan_30_omni",prompt:"<<<https://example.com/foreign.png>>>",resolution:"720P",aspect_ratio:"adaptive",video_duration:5,prompt_extend:true,seed:null,native_audio:true,rendering_speed:"basic",references:[{reference_handle:image,role:"image"}]}});
  assert.equal(foreign.isError,true);assert.equal(quotes.length,2);assert.equal(counters.chat,1);assert.equal(posts.length,1);
  const rich=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{link_attempt_id:attempt,model_id:"wan_30_omni",prompt:"Use @image1",resolution:"720P",aspect_ratio:"adaptive",video_duration:5,prompt_extend:true,seed:null,native_audio:true,rendering_speed:"basic",references:[{reference_handle:image,role:"image"},{reference_handle:doc,role:"file"}]}});
  assert.notEqual(rich.isError,true,JSON.stringify(rich));assert.equal((rich.structuredContent as any).status,"completed");assert.deepEqual(posts[1].settings.file_urls.map((r:any)=>r.type),["image","file"]);assert.match(posts[1].prompt,/<<<https:\/\/r2\.syntx\.ai\//u);assert.equal(quotes.length,4);
  await t.test("WAN25 image plus auxiliary audio",{skip:!process.env.SYNTX_MEDIA_FFMPEG_PATH||!process.env.SYNTX_MEDIA_FFPROBE_PATH?"trusted local codecs not configured":false},async()=>{
   const dir=await mkdtemp(join(tmpdir(),"wan-current-audio-test-"));try{const path=join(dir,"input.wav");execFileSync(process.env.SYNTX_MEDIA_FFMPEG_PATH!,["-v","error","-f","lavfi","-i","sine=frequency=440:duration=3","-c:a","pcm_s16le","-y",path]);
    const picture=await upload("image.png","image/png",png(),"wan_25_i2v_preview"),audio=await upload("input.wav","audio/wav",await readFile(path),"wan_25_i2v_preview");
    const result=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{...base,model_id:"wan_25_i2v_preview",prompt:"A scene with sound",seed:12,references:[{reference_handle:picture,role:"image"},{reference_handle:audio,role:"audio"}]}});
    assert.notEqual(result.isError,true,JSON.stringify(result));assert.equal((result.structuredContent as any).status,"completed");assert.deepEqual(posts[2].settings.file_urls.map((r:any)=>r.type),["image","audio"]);assert.equal(quotes.length,6);
    const videoPath=join(dir,"input.mp4");execFileSync(process.env.SYNTX_MEDIA_FFMPEG_PATH!,["-v","error","-f","lavfi","-i","color=c=blue:s=640x480:r=24:d=4","-c:v","libx264","-pix_fmt","yuv420p","-y",videoPath]);const videoBytes=await readFile(videoPath);
    const clip=await upload("video.mp4","video/mp4",videoBytes,"wan_27_i2v",{start_seconds:0.25,end_seconds:2.75}),last=await upload("last.png","image/png",png(),"wan_27_i2v");
    const firstClip={reference_handle:clip,role:"first_clip"},wan27={link_attempt_id:attempt,model_id:"wan_27_i2v",prompt:"A moving scene",resolution:"720P",video_duration:4,prompt_extend:true,seed:null};
    const incompatibleAudio=await upload("input.wav","audio/wav",await readFile(path),"wan_27_i2v");
    const rejected=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{...wan27,references:[firstClip,{reference_handle:incompatibleAudio,role:"audio"}]}});assert.equal(rejected.isError,true);assert.equal(posts.length,3);
    const clipResult=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{...wan27,references:[firstClip,{reference_handle:last,role:"last_frame"}]}});
    assert.notEqual(clipResult.isError,true,JSON.stringify(clipResult));assert.equal((clipResult.structuredContent as any).status,"completed");assert.deepEqual(posts[3].settings.file_urls.map((r:any)=>r.type),["first_clip","last_frame"]);assert.equal(posts[3].settings.native_audio,true);
    const rImage=await upload("ref.png","image/png",png(),"wan_27_r2v"),rVideo=await upload("ref.mp4","video/mp4",videoBytes,"wan_27_r2v",{start_seconds:0.25,end_seconds:2.75}),rAudio=await upload("ref.wav","audio/wav",await readFile(path),"wan_27_r2v");
    const mixed=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{link_attempt_id:attempt,model_id:"wan_27_r2v",prompt:"Use @image1 and @video1",resolution:"720P",aspect_ratio:"16:9",video_duration:5.25,prompt_extend:true,seed:null,
      references:[{reference_handle:rImage,role:"image"},{reference_handle:rVideo,role:"video"},{reference_handle:rAudio,role:"audio"}]}});
    assert.notEqual(mixed.isError,true,JSON.stringify(mixed));assert.equal((mixed.structuredContent as any).status,"completed");assert.equal(posts[4].settings.video_duration,5.25);assert.deepEqual(posts[4].settings.file_urls.map((r:any)=>r.type),["image","video","audio"]);assert.match(posts[4].prompt,/<<<https:\/\/r2\.syntx\.ai\//u);
    for(const model of ["wan_30_reference","wan_30_edit"]){const i=await upload("ref.png","image/png",png(),model),v=await upload("ref.mp4","video/mp4",videoBytes,model),a=await upload("ref.wav","audio/wav",await readFile(path),model);
      const refsForModel=model==="wan_30_edit"?[{reference_handle:v,role:"video"},{reference_handle:i,role:"image"},{reference_handle:a,role:"audio"}]:[{reference_handle:i,role:"image"},{reference_handle:v,role:"video"},{reference_handle:a,role:"audio"}];
      const generated=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{link_attempt_id:attempt,model_id:model,prompt:"Use @image1 and @video1",resolution:"720P",aspect_ratio:"adaptive",video_duration:model==="wan_30_reference"?4.5:4,prompt_extend:true,seed:null,native_audio:true,rendering_speed:"basic",references:refsForModel}});
      assert.notEqual(generated.isError,true,JSON.stringify(generated));assert.equal((generated.structuredContent as any).status,"completed");assert.equal(posts.at(-1).settings.duration,4);
      if(model==="wan_30_reference")assert.equal(posts.at(-1).settings.video_duration,4.5);}
    const frame1=await upload("one.png","image/png",png(),"wan_30_first_last_frame"),frame2=await upload("two.png","image/png",png(),"wan_30_first_last_frame");
    const frames=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{link_attempt_id:attempt,model_id:"wan_30_first_last_frame",prompt:"Transition @image1 to @image2",resolution:"720P",video_duration:4,prompt_extend:true,seed:null,native_audio:true,rendering_speed:"basic",references:[{reference_handle:frame1,role:"first_frame"},{reference_handle:frame2,role:"last_frame"}]}});
    assert.notEqual(frames.isError,true,JSON.stringify(frames));assert.equal((frames.structuredContent as any).status,"completed");assert.deepEqual(posts.at(-1).settings.file_urls.map((r:any)=>r.type),["first_frame","last_frame"]);
    const t30=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{link_attempt_id:attempt,model_id:"wan_30_t2v",prompt:"A fractional scene",resolution:"720P",aspect_ratio:"16:9",video_duration:5.25,prompt_extend:true,seed:null,native_audio:true,rendering_speed:"basic",references:[]}});
    assert.notEqual(t30.isError,true,JSON.stringify(t30));assert.equal((t30.structuredContent as any).status,"completed");assert.equal(posts.at(-1).settings.video_duration,5.25);
    const editedVideo=await upload("edit.mp4","video/mp4",videoBytes,"wan_27_videoedit"),editedImage=await upload("edit.png","image/png",png(),"wan_27_videoedit");
    const editArgs={link_attempt_id:attempt,model_id:"wan_27_videoedit",prompt:"Edit this scene",resolution:"720P",aspect_ratio:"16:9",prompt_extend:true,seed:null,audio_setting:"origin",references:[{reference_handle:editedVideo,role:"video"},{reference_handle:editedImage,role:"image"}]};
    const preserve=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{...editArgs,duration_mode:"preserve_input"}});assert.notEqual(preserve.isError,true,JSON.stringify(preserve));assert.equal(posts.at(-1).settings.video_duration,4);assert.equal(posts.at(-1).settings.native_audio,true);
    const custom=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{...editArgs,prompt:"Edit this scene shorter",duration_mode:"custom",video_duration:3.5}});assert.notEqual(custom.isError,true,JSON.stringify(custom));assert.equal(posts.at(-1).settings.video_duration,3.5);assert.equal(posts.at(-1).settings.audio_setting,"origin");
   }finally{await rm(dir,{recursive:true,force:true});}
  });
 }finally{await client.close();await server.close();await service.close();await native.close();await refs.close();}
});

import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient, readOwnerSwitchxReferenceContext } from "../src/adapter/syntx/chat-http-client.js";
import { validateOwnerSwitchxReference } from "../src/application/owner-switchx-reference-policy.js";
import { createOwnerSwitchxVideoUploadContext } from "../src/adapter/syntx/owner-switchx-video-native-context.js";

const attempt = "link_switchx_native_000000000001";
const principal = {tenant_id:"tenant",subject_id:"owner",connection_id:attempt};
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");

test("Switchx reference native context is minted by upload and bound to the owner and client", async () => {
  let uploads=0;
  const client=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(f:(value:string)=>Promise<T>){return f("synthetic-switchx-test-credential");}},
    fetchImpl:async (_url,init)=>{assert.equal(init?.method,"POST");uploads++;return Response.json({files:[{url:"https://r2.syntx.ai/owned-switchx-style.png"}]});}});
  const other=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(f:(value:string)=>Promise<T>){return f("synthetic-switchx-test-credential");}},fetchImpl:async()=>{throw Error("unexpected");}});
  await assert.rejects(()=>client.uploadOwnerSwitchxReference({attempt_id:attempt,principal,destination:"uploaded",reference:{role:"style_image"}}));
  assert.equal(uploads,0);
  assert.throws(() => createOwnerSwitchxVideoUploadContext({client,attempt_id:attempt,principal,destination:"uploaded",
    reference:{url:"https://r2.syntx.ai/foreign.mp4"},metadata:{filename:"x.mp4",mime_type:"video/mp4",size:10,sha256:"a".repeat(64),width:1280,height:720,duration_seconds:5,frame_rate:24},authorization:{}}));
  const reference=await validateOwnerSwitchxReference({role:"style_image",filename:"style.png",mime_type:"image/png",bytes:png},"unused-for-images");
  const context=await client.uploadOwnerSwitchxReference({attempt_id:attempt,principal,destination:"uploaded",reference});
  assert.equal(uploads,1); assert.equal(JSON.stringify(context).includes("r2.syntx.ai"),false);
  assert.equal(readOwnerSwitchxReferenceContext(client,{...context},attempt,principal),null);
  assert.equal(readOwnerSwitchxReferenceContext(other,context,attempt,principal),null);
  assert.equal(readOwnerSwitchxReferenceContext(client,context,attempt,{...principal,subject_id:"other"}),null);
  assert.equal(readOwnerSwitchxReferenceContext(client,context,attempt,principal)?.role,"style_image");
  await assert.rejects(()=>client.uploadOwnerSwitchxReference({attempt_id:attempt,principal,destination:"uploaded",reference}));
  assert.equal(uploads,1);
});

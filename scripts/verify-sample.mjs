/** Development-only: sends the specified clip to the shared demo verification backend. No Gemini key is read here. */
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const file = process.argv[2];
if (!file || process.argv.length !== 3) {
  console.error("usage: pnpm verify:sample <path-to-mp4-or-webm>\nUploads for development verification only; does not grant a dataset/training license.");
  process.exit(2);
}
const path=resolve(file), size=(await stat(path)).size;
if (size<=0 || size>25*1024*1024) throw new Error("Clip must be 1–25 MiB");
const mimeTypes={".mp4":"video/mp4",".webm":"video/webm",".mov":"video/quicktime"};
const mimeType=mimeTypes[extname(path).toLowerCase()];
if (!mimeType) throw new Error("Supported clip extensions: mp4, webm, mov");
let url=process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) {
  try {url=(await readFile(new URL("../.env.local",import.meta.url),"utf8")).split(/\r?\n/).find(line=>line.startsWith("CONVEX_URL="))?.slice("CONVEX_URL=".length).trim().replace(/^["']|["']$/g,"");} catch {}
}
url ||= "https://keen-marmot-986.convex.cloud";
const client=new ConvexHttpClient(url), demoIdentity="contributor";
const query=(name,args)=>client.query(makeFunctionReference(name),args);
const mutation=(name,args)=>client.mutation(makeFunctionReference(name),args);
const context=await query("dashboard:demoContext",{demoIdentity});
if (!context) throw new Error("Demo seed required: pnpm seed");
const uploadUrl=await mutation("submissions:generateUploadUrl",{demoIdentity});
const upload=await fetch(uploadUrl,{method:"POST",headers:{"Content-Type":mimeType},body:await readFile(path)});
if (!upload.ok) throw new Error(`Upload failed: HTTP ${upload.status}`);
const {storageId}=await upload.json();
const {submissionId}=await mutation("submissions:create",{demoIdentity,orderId:context.orderId,storageId,
  clientRequestId:`verify-sample:${randomUUID()}`,consentAcknowledged:true,verificationOnly:true});
console.error(`Queued ${submissionId}; waiting for the stored report (no payment or acceptance is requested).`);
const start=Date.now();
while (Date.now()-start<6*60_000) {
  const result=await query("submissions:getReport",{demoIdentity,submissionId});
  if (result.report) {console.log(JSON.stringify({submissionId,...result,clientWaitMs:Date.now()-start},null,2));process.exit(result.report.pipeline.status === "failed" ? 1 : 0);}
  await delay(1500);
}
throw new Error(`Timed out waiting; inspect the existing submission ${submissionId}. Do not upload again to recover it.`);

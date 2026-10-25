// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestInteraction, observeVideo, observeAudio, transcriptObservation, financeModel, videoModel, GEMINI_REQUEST_TIMEOUT_MS } from "./lib/gemini";

afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
const response=(body:unknown)=>new Response(JSON.stringify(body),{status:200});
describe("Gemini transport and independent inputs (mocked provider only)",()=>{
  it("fails closed when the secret is unavailable",async()=>{
    vi.stubEnv("GEMINI_API_KEY","");
    await expect(requestInteraction({})).rejects.toThrow("gemini_not_configured");
  });
  it("sanitizes HTTP failures rather than exposing body or credentials",async()=>{
    vi.stubEnv("GEMINI_API_KEY","unit-test-placeholder");
    const fetcher=vi.fn(async(_url:unknown,_options?:RequestInit)=>new Response("sensitive-provider-body",{status:403}));
    await expect(requestInteraction({},fetcher)).rejects.toThrow(/^gemini_http_403$/);
    const options=fetcher.mock.calls[0]?.[1] as RequestInit|undefined;
    expect(options?.headers).toMatchObject({"x-goog-api-key":"unit-test-placeholder"});
  });
  it("rejects malformed provider JSON",async()=>{
    vi.stubEnv("GEMINI_API_KEY","unit-test-placeholder");
    await expect(requestInteraction({},async()=>new Response("not json"))).rejects.toThrow("gemini_invalid_json");
  });
  it("aborts a timed-out call and emits only a sanitized failure code",async()=>{
    vi.stubEnv("GEMINI_API_KEY","unit-test-placeholder");
    const fetcher=vi.fn((_url:unknown,options?:RequestInit)=>new Promise<Response>((_,reject)=>{
      options?.signal?.addEventListener("abort",()=>reject(new Error("sensitive transport detail")),{once:true});
    }));
    await expect(requestInteraction({},fetcher as typeof fetch,5)).rejects.toThrow(/^gemini_timeout$/);
  });
  it("visual request has timestamped JPEGs, explicit untrusted-content policy and no audio observation",async()=>{
    vi.stubEnv("GEMINI_API_KEY","unit-test-placeholder");
    vi.stubGlobal("fetch",vi.fn(async()=>response({status:"completed",output_text:JSON.stringify({visibility:"uncertain",observations:[]})})));
    const result=await observeVideo(Array.from({length:12},(_,i)=>({timestampMs:(i+1)*500,bytes:new Uint8Array([255,216,255]),mimeType:"image/jpeg" as const})),10_000);
    expect(result.observation.observations).toEqual([]);
    const body=JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body.model).toBe("gemini-3.8-flash");
    expect(body.input.filter((p:{type:string})=>p.type === "image")).toHaveLength(12);
    expect(body.input.some((p:{type:string})=>p.type === "video")).toBe(false);
    expect(body.input.some((p:{type:string})=>p.type === "audio")).toBe(false);
    expect(body.system_instruction).toContain("untrusted evidence");
    expect(body.response_format.mime_type).toBe("application/json");
    expect(body.response_format.schema.properties.observations.maxItems).toBe(8);
    expect(body.store).toBe(false);
    expect(body.tools).toBeUndefined();
  });
  it("audio default uses only WAV and structured verbatim word timestamps",async()=>{
    vi.stubEnv("GEMINI_API_KEY","unit-test-placeholder");
    vi.stubGlobal("fetch",vi.fn(async()=>response({status:"completed",steps:[{type:"model_output",content:[{type:"text",text:"I pick up the red cup",annotations:[
      {type:"word_info",text:"I pick up the red cup",start_offset:"0.1s",end_offset:"1.0s"}
    ]}]}]})));
    const result=await observeAudio(new Uint8Array([1,2,3]),10_000);
    expect(result.observation.claims[0]?.object).toBe("red_cup");
    const body=JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body.model).toBe("gemini-3.5-transcribe");
    expect(body.input.map((p:{type:string})=>p.type)).toEqual(["audio"]);
    expect(body.generation_config.transcription_config.mode.timestamp_granularities).toEqual(["word"]);
  });
  it("does not invent timestamps for plain transcript output",()=>{
    expect(()=>transcriptObservation({status:"completed",output_text:"mark accepted"},10_000)).toThrow("transcript_timestamps_missing");
  });
});

it("merges a quantized zero-duration word into an adjacent provider-timed phrase without dropping text",()=>{
  const observation=transcriptObservation({status:"completed",steps:[{content:[{type:"text",text:"This is a test",annotations:[
    {type:"word_info",text:"This",start_offset:"0s",end_offset:"0.4s"},
    {type:"word_info",text:"is",start_offset:"0.4s",end_offset:"0.5s"},
    {type:"word_info",text:"a",start_offset:"0.5s",end_offset:"0.5s"},
    {type:"word_info",text:"test",start_offset:"0.5s",end_offset:"1s"}
  ]}]}]},10_000);
  expect(observation.transcript).toBe("This is a test");
  expect(observation.segments[1]).toEqual({startMs:400,endMs:500,text:"is a"});
  expect(observation.segments.every(s=>s.endMs>s.startMs)).toBe(true);
});
it("retries only bounded transient provider errors inside one deadline",async()=>{
  vi.stubEnv("GEMINI_API_KEY","unit-test-placeholder");
  const fetcher=vi.fn().mockResolvedValueOnce(new Response("busy",{status:503})).mockResolvedValueOnce(response({status:"completed",output_text:"ok"}));
  expect((await requestInteraction({},fetcher,1000,1)).output_text).toBe("ok");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("rejects a visual event interval with no sampled source frame",async()=>{
  vi.stubEnv("GEMINI_API_KEY","unit-test-placeholder");
  vi.stubGlobal("fetch",vi.fn(async()=>response({status:"completed",output_text:JSON.stringify({visibility:"clear",observations:[
    {action:"pickup",object:"red_cup",target:"unknown",startMs:20,endMs:40,description:"Unsupported interval"}
  ]})})));
  const frames=Array.from({length:12},(_,i)=>({timestampMs:(i+1)*500,bytes:new Uint8Array([255,216,255]),mimeType:"image/jpeg" as const}));
  await expect(observeVideo(frames,10_000)).rejects.toThrow("video_observation_invalid");
});

it("accepts requires_action only for explicitly enabled function calling, never verifier inference",async()=>{
  vi.stubEnv("GEMINI_API_KEY","unit-test-placeholder");
  const fetcher=vi.fn(async()=>response({status:"requires_action",steps:[{type:"function_call",id:"read-1",name:"getTrialBalance",arguments:{}}]}));
  await expect(requestInteraction({},fetcher,1000,1)).rejects.toThrow("gemini_incomplete");
  expect((await requestInteraction({},fetcher,1000,1,true)).status).toBe("requires_action");
  await expect(requestInteraction({},async()=>response({status:"requires_action",steps:[]}),1000,1,true)).rejects.toThrow("gemini_incomplete");
});

it("defaults both model routes to 3.8 Flash and preserves explicit environment overrides",()=>{
  vi.stubEnv("GEMINI_VIDEO_MODEL",""); vi.stubEnv("GEMINI_FINANCE_MODEL","");
  expect(videoModel()).toBe("gemini-3.8-flash");
  expect(financeModel()).toBe("gemini-3.8-flash");
  vi.stubEnv("GEMINI_VIDEO_MODEL","custom-vision"); vi.stubEnv("GEMINI_FINANCE_MODEL","custom-finance");
  expect(videoModel()).toBe("custom-vision"); expect(financeModel()).toBe("custom-finance");
});

it("caps a caller's longer timeout at 30 seconds and never retries a hung request",async()=>{
  vi.stubEnv("GEMINI_API_KEY","unit-test-placeholder"); vi.useFakeTimers();
  let aborted=false;
  const fetcher=vi.fn((_url:unknown,options?:RequestInit)=>new Promise<Response>((_,reject)=>{
    options?.signal?.addEventListener("abort",()=>{aborted=true;reject(new Error("private failure detail"));},{once:true});
  }));
  const pending=requestInteraction({},fetcher,90_000);
  const assertion=expect(pending).rejects.toThrow(/^gemini_timeout$/);
  await vi.advanceTimersByTimeAsync(29_999); expect(aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await assertion;
  expect(aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps transient retries inside the original 30-second deadline",async()=>{
  vi.stubEnv("GEMINI_API_KEY","unit-test-placeholder"); vi.useFakeTimers();
  const started=Date.now(); let aborted=false;
  const fetcher=vi.fn((_url:unknown,options?:RequestInit)=>{
    if(fetcher.mock.calls.length===1) return Promise.resolve(new Response("busy",{status:503}));
    return new Promise<Response>((_,reject)=>options?.signal?.addEventListener("abort",()=>{aborted=true;reject(new Error("sensitive failure"));},{once:true}));
  });
  const assertion=expect(requestInteraction({},fetcher,90_000,1)).rejects.toThrow(/^gemini_timeout$/);
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
  const remaining=GEMINI_REQUEST_TIMEOUT_MS-(Date.now()-started);
  await vi.advanceTimersByTimeAsync(remaining-1); expect(aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await assertion;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

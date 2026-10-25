import assert from "node:assert/strict";
import { test } from "vitest";
import { objectInHand, cupInHand, frameAt, summarize, type AnnotationFile } from "./annotations.ts";
import { replayStorageUrl } from "./media-url.ts";

test("cup overlap is geometric evidence, and requires both a cup and hand", () => {
  const hands = [{ handedness: "Left" as const, score: 0.9, keypoints: [[0.2,0.2,0.5],[0.6,0.6,0.5]] as [number,number,number][] }];
  assert.equal(cupInHand(hands, [{ label: "cup", score: 0.9, box: [0.4,0.4,0.2,0.2] }]), true);
  assert.equal(cupInHand(hands, [{ label: "cup", score: 0.9, box: [0.7,0.7,0.2,0.2] }]), false);
  assert.equal(cupInHand(hands, [{ label: "bottle", score: 0.9, box: [0.4,0.4,0.2,0.2] }]), false);
  assert.equal(cupInHand([], [{ label: "cup", score: 0.9, box: [0.4,0.4,0.2,0.2] }]), false);
});

test("saved detections do not leak onto unrelated playback timestamps", () => {
  const frames = [{ tMs: 0, hands: [] }, { tMs: 200, hands: [] }];
  assert.equal(frameAt(frames, 190)?.tMs, 200);
  assert.equal(frameAt(frames, 1000), undefined);
});

test("annotation summaries count witnessed frames and preserve advisory files", () => {
  const file: AnnotationFile = { schema: "skarl.annotations.v1", submissionId: "s", sourceSha256: "a".repeat(64), kind: "objects", model: {name:"fixture",version:"test",runtime:"browser-wasm"}, sampleFps:5,videoWidth:320,videoHeight:240,advisory:true,
    frames: [{tMs:0,objects:[{label:"cup",score:0.9,box:[0,0,0.2,0.2]}]},{tMs:200,objects:[]}] };
  assert.deepEqual(summarize(file,400), {kind:"objects",frames:2,durationMs:400,objectLabels:{cup:1},cupInHandFrames:0});
  assert.equal(file.advisory, true);
});

test("same-origin replay transport cannot fetch foreign origins, credentials, or nonstorage paths", () => {
  const origin = "https://example.convex.cloud";
  assert.equal(replayStorageUrl(`${origin}/api/storage/abc-123`,origin).origin,origin);
  for (const input of ["https://evil.example/api/storage/abc",`${origin}/api/query`,`${origin}/api/storage/abc?x=1`,`https://user:pass@example.convex.cloud/api/storage/abc`,"http://example.convex.cloud/api/storage/abc","https://example.convex.cloud.evil.example/api/storage/abc"]) {
    assert.throws(() => replayStorageUrl(input,origin));
  }
});

test("downloaded annotation JSON cannot smuggle a different source or malformed geometry", async () => {
  const { readAnnotationFile } = await import("./annotations.ts");
  const file = {schema:"skarl.annotations.v1",submissionId:"s",sourceSha256:"a".repeat(64),kind:"objects",model:{name:"fixture",version:"test",runtime:"browser-wasm"},sampleFps:5,videoWidth:320,videoHeight:240,advisory:true,frames:[{tMs:0,objects:[{label:"cup",score:0.9,box:[0,0,0.2,0.2]}]}]};
  assert.equal(readAnnotationFile(file,"s","a".repeat(64)).frames.length,1);
  assert.throws(() => readAnnotationFile(file,"foreign","a".repeat(64)));
  assert.throws(() => readAnnotationFile(file,"s","b".repeat(64)));
  assert.throws(() => readAnnotationFile({...file,advisory:false},"s","a".repeat(64)));
  assert.throws(() => readAnnotationFile({...file,frames:[{tMs:0,objects:[{label:"cup",score:1,box:[Infinity,0,1,1]}]}]},"s","a".repeat(64)));
  assert.throws(() => readAnnotationFile({...file,frames:[{tMs:-1,objects:[]}]},"s","a".repeat(64)));
});


test("a can task never treats cup or bottle detections as its object witness", () => {
  const hands = [{ handedness: "Left" as const, score: 0.9, keypoints: [[0.2,0.2,0.5],[0.6,0.6,0.5]] as [number,number,number][] }];
  const detections = [{ label: "cup", score: 0.9, box: [0.4,0.4,0.2,0.2] as [number,number,number,number] },
    { label: "bottle", score: 0.9, box: [0.4,0.4,0.2,0.2] as [number,number,number,number] }];
  assert.equal(objectInHand(hands, detections, "can"), false);
  assert.equal(objectInHand(hands, detections, "red_cup"), true);
  assert.equal(objectInHand(hands, detections), false);
});

"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createHash } from "node:crypto";
import { prepareMedia, MediaPreparationError } from "./lib/media";
import { observeVideo, observeAudio, GeminiFailure, videoModel, audioModel } from "./lib/gemini";
import { buildVerificationReports, EVALUATION_PROJECTION_VERSION, type AudioObservation, type VideoObservation, type ModelRun } from "./lib/verificationReport";
import { validateVerificationReportForRubric } from "../packages/contracts/src/verification";
import { canonical, digest } from "./lib/finance";
import type { Id } from "./_generated/dataModel";

export const run = internalAction({
  args: { jobId:v.id("jobs") },
  handler:async(ctx,args):Promise<{analysisId?:Id<"analysisResults">;skipped?:boolean}> => {
    const claimed=await ctx.runMutation(internal.submissions.claim,args);
    if (!claimed) return {skipped:true};
    const {job,submission,rubric,asset,generation}=claimed;
    const started=Date.now(), runs:ModelRun[]=[], warnings:string[]=[];
    const evidenceFrames: { storageId: Id<"_storage">; timestampMs: number; contentHash: string; sizeBytes: number;
      kind: "visual" | "dhash"; sampleIndex: number; decodedFrameIndex?: number }[] = [];
    let sourceHash=asset.contentHash, durationMs=0, video:VideoObservation|undefined, audio:AudioObservation|undefined, failure:string|undefined;
    let duplicate:{status:"not_checked"|"clear"|"suspected";matches:{submissionId:string;score:number;overlapMs:number}[]}={status:"not_checked",matches:[]};
    try {
      const blob=await ctx.storage.get(asset.storageId);
      if (!blob || blob.size<=0 || blob.size>25*1024*1024) throw new Error("stored_upload_invalid");
      const bytes=new Uint8Array(await blob.arrayBuffer());
      sourceHash=createHash("sha256").update(bytes).digest("hex");
      await ctx.runMutation(internal.submissions.facts,{jobId:job._id,generation,sourceHash,durationMs:0,mediaVerified:false});
      if (submission.expectedSourceHash && sourceHash !== submission.expectedSourceHash) throw new GeminiFailure("upload_hash_mismatch");
      const media=await prepareMedia(bytes,asset.mimeType);
      durationMs=media.durationMs;
      warnings.push(...media.warnings);
      await ctx.runMutation(internal.submissions.facts,{jobId:job._id,generation,sourceHash,durationMs,mediaVerified:true,
        frameDHashes:media.frameDHashes,perceptualHash:media.perceptualHash,perceptualHashSource:"serverComputed"});
      for (const [sampleIndex, frame] of media.videoFrames.entries()) {
        const storageId = await ctx.storage.store(new Blob([new Uint8Array(frame.bytes)], {type:"image/jpeg"}));
        evidenceFrames.push({storageId, timestampMs:frame.timestampMs, contentHash:createHash("sha256").update(frame.bytes).digest("hex"),
          sizeBytes:frame.bytes.byteLength, kind:"visual", sampleIndex});
      }
      for (const frame of media.hashFrames ?? []) {
        const storageId = await ctx.storage.store(new Blob([new Uint8Array(frame.bytes)], {type:"image/jpeg"}));
        evidenceFrames.push({storageId, timestampMs:frame.timestampMs, contentHash:createHash("sha256").update(frame.bytes).digest("hex"),
          sizeBytes:frame.bytes.byteLength, kind:"dhash", sampleIndex:frame.sampleIndex, decodedFrameIndex:frame.frameIndex});
      }
      duplicate=await ctx.runQuery(internal.submissions.copies,{submissionId:submission._id});

      const outcomes=await Promise.allSettled([observeVideo(media.videoFrames,durationMs,submission.evalVideoModel),
        media.audio ? observeAudio(media.audio,durationMs) : Promise.reject(new GeminiFailure("audio_stream_missing"))]);
      const visual=outcomes[0], speech=outcomes[1];
      if (visual.status === "fulfilled") {video=visual.value.observation;runs.push(visual.value.run);}
      else {runs.push({provider:"google",model:submission.evalVideoModel ?? videoModel(),promptVersion:"timestamped-frames-visible-events-v1"});failure=visual.reason instanceof GeminiFailure ? visual.reason.code : "video_unavailable";}
      if (speech.status === "fulfilled") {audio=speech.value.observation;runs.push(speech.value.run);}
      else {if(media.audio) runs.push({provider:"google",model:audioModel(),promptVersion:"audio-only-events-v1"});failure=speech.reason instanceof GeminiFailure ? speech.reason.code : "audio_unavailable";}
    } catch(error) {
      failure=error instanceof MediaPreparationError ? error.code : error instanceof GeminiFailure ? error.code : "verification_unavailable";
      // If server decoding failed, client hashes remain explicitly untrusted fallback evidence.
      if (sourceHash !== "0".repeat(64) && submission.clientFrameDHashes?.length) {
        warnings.push("Perceptual hashes are clientReported; server media preparation failed. They are not independently verified.");
        await ctx.runMutation(internal.submissions.facts,{jobId:job._id,generation,sourceHash,durationMs:0,mediaVerified:false,
          frameDHashes:submission.clientFrameDHashes,perceptualHash:submission.clientFrameDHashes.map(f=>f.hash).join(""),perceptualHashSource:"clientReported"});
      }
    }
    const scope={verificationOnly:submission.verificationOnly,evalRunId:submission.evalRunId};
    let reports=buildVerificationReports({submissionId:submission._id,taskVersionId:rubric._id,sourceHash,durationMs,criteria:rubric.criteria,
      video,audio,modelRuns:runs,duplicate,warnings,...(failure ? {failure} : {}),reportId:`analysis:${job._id}:${generation}`},scope);
    const validReports=()=>[reports.report,...(reports.qualityReport ? [reports.qualityReport] : [])]
      .every(report=>validateVerificationReportForRubric(report,rubric.criteria.map(c=>c.criterionId)).valid);
    if (!validReports()) {
      failure="report_validation_failed";
      reports=buildVerificationReports({submissionId:submission._id,taskVersionId:rubric._id,sourceHash,durationMs,criteria:rubric.criteria,
        modelRuns:runs,duplicate:{status:"not_checked",matches:[]},warnings,failure,reportId:`analysis:${job._id}:${generation}`},scope);
      if (!validReports()) throw new Error("fallback_report_invalid");
    }
    const {report,qualityReport}=reports;
    const evaluation=qualityReport ? {evaluationOnly:true,projectionVersion:EVALUATION_PROJECTION_VERSION,
      qualityReport,qualityReportHash:digest(qualityReport)} : undefined;
    const reportJson=canonical(report);
    const reportStorageId=await ctx.storage.store(new Blob([reportJson],{type:"application/json"}));
    try {
      const analysisId=await ctx.runMutation(internal.submissions.complete,{jobId:job._id,generation,reportJson,
        observationsJson:canonical({video,audio,failureCode:failure,...(evaluation ? {evaluation} : {})}),reportStorageId,evidenceFrames,reportHash:digest(report),processingElapsedMs:Date.now()-started,...(failure ? {failureCode:failure} : {})});
      return {analysisId};
    } catch {
      // A transport failure does not prove the mutation rolled back. Keep private
      // storage for recovery instead of deleting possibly committed evidence.
      throw new Error("analysis_persistence_failed");
    }
  },
});

/** A scheduled watchdog recovery writes a canonical failure report if the main action was interrupted. */
export const interrupted = internalAction({
  args:{jobId:v.id("jobs"),generation:v.number()},
  handler:async(ctx,args):Promise<{analysisId?:Id<"analysisResults">;skipped?:boolean}>=>{
    const context=await ctx.runQuery(internal.submissions.interruptedContext,args);
    if(!context) return {skipped:true};
    const {job,submission,rubric,asset}=context;
    const {report,qualityReport}=buildVerificationReports({submissionId:submission._id,taskVersionId:rubric._id,sourceHash:job.sourceHash,
      durationMs:asset?.durationMs ?? 0,criteria:rubric.criteria,modelRuns:[],duplicate:{status:"not_checked",matches:[]},
      failure:"verification_interrupted",reportId:`analysis:${job._id}:${args.generation}`},
      {verificationOnly:submission.verificationOnly,evalRunId:submission.evalRunId});
    report.pipeline.version=job.pipelineVersion;
    if(qualityReport) qualityReport.pipeline.version=job.pipelineVersion;
    if(![report,...(qualityReport ? [qualityReport] : [])].every(value=>
      validateVerificationReportForRubric(value,rubric.criteria.map(c=>c.criterionId)).valid)) throw new Error("timeout_report_invalid");
    const evaluation=qualityReport ? {evaluationOnly:true,projectionVersion:EVALUATION_PROJECTION_VERSION,
      qualityReport,qualityReportHash:digest(qualityReport)} : undefined;
    const reportJson=canonical(report),reportStorageId=await ctx.storage.store(new Blob([reportJson],{type:"application/json"}));
    try {
      return {analysisId:await ctx.runMutation(internal.submissions.complete,{...args,reportJson,observationsJson:canonical({failureCode:"verification_interrupted",...(evaluation ? {evaluation} : {})}),
        reportStorageId,reportHash:digest(report),processingElapsedMs:job.leaseExpiresAt ? Math.max(0,Date.now()-job.leaseExpiresAt+5*60_000) : 0,failureCode:"verification_interrupted"})};
    } catch {await ctx.storage.delete(reportStorageId);return {skipped:true};}
  },
});

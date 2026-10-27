"use node";
import { Buffer } from "node:buffer";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { configuredImageModel } from "./lib/config";

type Result = { ok: true; orderId: string } | { ok: false; orderId: string; code: string };

/** Illustrates one task from its own title and steps with Gemini image generation. Advisory art only, never evidence. */
export const generate = internalAction({
  args: { orderId: v.id("orders"), force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<Result> => {
    const task = await ctx.runQuery(internal.taskThumbnailsData.task, { orderId: args.orderId });
    if (!task) return { ok: false, orderId: args.orderId, code: "task_not_found" };
    if (task.hasThumbnail && !args.force) return { ok: false, orderId: args.orderId, code: "already_generated" };
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { ok: false, orderId: args.orderId, code: "gemini_unconfigured" };
    const model = configuredImageModel();
    const prompt = [
      "A clean, friendly product illustration for a mobile app card showing this everyday household task being done by a person's hands.",
      `Task: ${task.title}.`, task.steps.length ? `Steps: ${task.steps.join("; ")}.` : "",
      "Soft natural light, simple tabletop scene, minimal background, no text, no logos, no faces, square composition.",
    ].join(" ");
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
      });
      if (!response.ok) throw new Error(`gemini_http_${response.status}`);
      const body = await response.json() as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
      const image = body.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
      if (!image?.data || !image.mimeType?.startsWith("image/")) throw new Error("gemini_no_image");
      const storageId = await ctx.storage.store(new Blob([Buffer.from(image.data, "base64")], { type: image.mimeType }));
      await ctx.runMutation(internal.taskThumbnailsData.attach, { orderId: args.orderId, storageId });
      return { ok: true, orderId: args.orderId };
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 80) : "unknown";
      console.error("task_thumbnail_failed", { orderId: args.orderId, code });
      return { ok: false, orderId: args.orderId, code };
    }
  },
});

/** Fills in thumbnails for every open contributor task that lacks one. */
export const generateMissing = internalAction({
  args: {},
  handler: async (ctx): Promise<Result[]> => {
    // Same off switches as the other background AI jobs; each run is a paid Gemini image call.
    if (process.env.SKARL_SCHEDULED_JOBS_DISABLED === "true" || process.env.TASK_THUMBNAILS_ENABLED === "false") return [];
    const orderIds = await ctx.runQuery(internal.taskThumbnailsData.missing, {});
    const results: Result[] = [];
    for (const orderId of orderIds) results.push(await ctx.runAction(internal.taskThumbnails.generate, { orderId }));
    return results;
  },
});

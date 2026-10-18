import { z } from "zod";
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("move"),
      x: z.number().finite(),
      z: z.number().finite(),
      y: z.number().finite().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("look"),
      pan: z.number().finite().min(-180).max(180),
      tilt: z.number().finite().min(-80).max(30),
    })
    .strict(),
  z
    .object({ type: z.literal("inspect"), objectId: z.string().min(1).max(80) })
    .strict(),
  z
    .object({
      type: z.literal("preset"),
      preset: z.enum(["home", "reach", "drop"]),
    })
    .strict(),
  z
    .object({ type: z.literal("grasp"), objectId: z.string().min(1).max(80) })
    .strict(),
  z.object({ type: z.literal("place") }).strict(),
  z.object({ type: z.literal("takeoff") }).strict(),
  z.object({ type: z.literal("land") }).strict(),
  z.object({ type: z.literal("stop") }).strict(),
]);
export const schemas = {
  discover: z
    .object({ kind: z.enum(["camera", "rover", "arm", "drone"]).optional() })
    .strict(),
  possess: z
    .object({
      resourceId: z.string().min(1).max(80),
      ttlSeconds: z.number().int().min(5).max(300).default(60),
      owner: z.string().trim().min(1).max(48).default("MCP agent"),
    })
    .strict(),
  observe: z
    .object({
      leaseId: z.string().min(1).max(100),
      image: z.boolean().optional(),
    })
    .strict(),
  act: z
    .object({ leaseId: z.string().min(1).max(100), command: commandSchema })
    .strict(),
  release: z.object({ leaseId: z.string().min(1).max(100) }).strict(),
};

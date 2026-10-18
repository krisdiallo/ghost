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
      tilt: z.number().finite().min(-90).max(30),
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
const bodySchemas = {
  discover: z
    .object({
      kind: z.enum(["camera", "rover", "arm", "drone"]).optional(),
      sandboxId: z.string().min(1).max(80).optional(),
    })
    .strict(),
  possess: z
    .object({
      resourceId: z.string().min(1).max(80),
      sandboxId: z.string().min(1).max(80).optional(),
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

const id = z.string().trim().min(1).max(80);
const label = z.string().trim().min(1).max(80);
const vec = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const deviceSchema = z
  .object({
    attachment: z.literal("pallet-handler").optional(),
    id,
    kind: z.enum(["camera", "rover", "arm", "drone"]),
    label,
    position: vec,
    heading: z.number().finite().min(-Math.PI).max(Math.PI).optional(),
    pan: z.number().finite().min(-180).max(180).optional(),
    tilt: z.number().finite().min(-90).max(30).optional(),
    airborne: z.boolean().optional(),
    profile: z
      .object({
        scale: z.number().finite().min(0.5).max(1.5).optional(),
        speed: z.number().finite().min(0).max(6).optional(),
        telemetryRange: z.number().finite().min(1).max(60).optional(),
        inspectRange: z
          .number()
          .finite()
          .min(0.5)
          .max(60)
          .nullable()
          .optional(),
        payloadKg: z.number().finite().min(0).max(100).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const obstacleSchema = z
  .object({
    id,
    label,
    kind: z.enum(["rack", "wall", "column", "freight", "mezzanine"]),
    min: vec,
    max: vec,
  })
  .strict();
export const workflowSchema = z
  .object({
    name: label,
    actors: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/), id),
    steps: z
      .array(
        z
          .object({
            actor: id,
            label: label.optional(),
            dwellSeconds: z.number().finite().min(0).max(60).optional(),
            command: commandSchema,
          })
          .strict(),
      )
      .min(1)
      .max(64),
    stopOnError: z.boolean().default(true),
    maxSimulatedSeconds: z.number().finite().min(5).max(300).default(180),
    requireSafeEnd: z.boolean().default(true),
  })
  .strict();
export const definitionSchema = z
  .object({
    version: z.literal(1),
    name: label,
    obstacles: z.array(obstacleSchema).max(128),
    devices: z.array(deviceSchema).min(1).max(12),
    cargo: z
      .array(
        z
          .object({
            id,
            label,
            position: vec,
            condition: z.string().max(240),
            massKg: z.number().finite().min(0.01).max(1000).optional(),
          })
          .strict(),
      )
      .max(32),
    workflow: workflowSchema.optional(),
  })
  .strict();
export const schemas = {
  operations: z
    .object({
      action: z
        .enum([
          "status",
          "start",
          "pause",
          "place_box",
          "clear_box",
          "recover_box",
          "resume",
          "watch",
        ])
        .default("status"),
      x: z.number().finite().min(-30).max(30).optional(),
      z: z.number().finite().min(-32).max(8).optional(),
      incidentId: z.string().min(1).max(80).optional(),
      leaseId: z.string().min(1).max(100).optional(),
      afterSequence: z.number().int().min(0).optional(),
      waitSeconds: z.number().int().min(0).max(25).default(20),
    })
    .strict(),
  ...bodySchemas,
  sandbox_list: z.object({}).strict(),
  sandbox_create: z
    .object({
      name: label,
      sourceSandboxId: id.optional(),
      definition: definitionSchema.optional(),
    })
    .strict(),
  sandbox_inspect: z.object({ sandboxId: id }).strict(),
  sandbox_update: z
    .object({
      sandboxId: id,
      expectedRevision: z.number().int().min(0),
      definition: definitionSchema,
    })
    .strict(),
  sandbox_add_device: z
    .object({
      sandboxId: id,
      expectedRevision: z.number().int().min(0),
      device: deviceSchema,
    })
    .strict(),
  sandbox_delete: z.object({ sandboxId: id }).strict(),
  experiment_templates: z.object({}).strict(),
  experiment_run: z
    .object({
      sandboxId: id,
      expectedRevision: z.number().int().min(0).optional(),
      workflow: workflowSchema.optional(),
      playbackRate: z.number().int().min(1).max(8).default(4),
    })
    .strict(),
  experiment_inspect: z
    .object({
      runId: id,
      includeSnapshot: z.boolean().default(false),
      imageResourceId: id.optional(),
    })
    .strict(),
  experiment_cancel: z.object({ runId: id }).strict(),
  experiment_compare: z.object({ runIds: z.array(id).min(2).max(4) }).strict(),
};

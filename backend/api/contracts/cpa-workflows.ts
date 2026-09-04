import { z } from "zod";

import { clientProfileUpdateSchema } from "./entities";
import { publicQuestionnaireDataSchema } from "./public-questionnaire";

const idSchema = z.string().min(1).max(256);

export const cpaSaveSubmissionSchema = z
  .object({
    client_id: idSchema,
    submission_id: idSchema.nullish(),
    revision: z.number().int().positive().optional(),
    step_id: idSchema.nullish(),
    data: publicQuestionnaireDataSchema,
    completed: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.submission_id && value.revision === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["revision"],
        message: "Existing submissions require a revision",
      });
    }
    if (!value.submission_id && value.revision !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["revision"],
        message: "New submissions cannot include a revision",
      });
    }
  });

export const changeClientTaxYearSchema = z
  .object({ tax_year: z.number().int().min(1900).max(2200) })
  .strict();

export const resetOrphanClientStatusSchema = z.object({}).strict();

export const updateClientDetailsSchema = z
  .object({
    revision: z.number().int().positive(),
    profile: clientProfileUpdateSchema.optional(),
    tax_year: z.number().int().min(1900).max(2200).optional(),
  })
  .strict()
  .refine(
    (value) => value.profile !== undefined || value.tax_year !== undefined,
    "Client details update is empty",
  );

export const restoreSubmissionSchema = z
  .object({ conflicting_submission_id: idSchema.optional() })
  .strict();

export const transitionSubmissionStatusSchema = z
  .object({
    client_id: idSchema,
    status: z.enum(["ready_for_ira", "reviewed"]),
  })
  .strict();

export type CpaSaveSubmissionInput = z.infer<typeof cpaSaveSubmissionSchema>;
export type ChangeClientTaxYearInput = z.infer<typeof changeClientTaxYearSchema>;
export type UpdateClientDetailsInput = z.infer<typeof updateClientDetailsSchema>;
export type RestoreSubmissionInput = z.infer<typeof restoreSubmissionSchema>;
export type TransitionSubmissionStatusInput = z.infer<
  typeof transitionSubmissionStatusSchema
>;

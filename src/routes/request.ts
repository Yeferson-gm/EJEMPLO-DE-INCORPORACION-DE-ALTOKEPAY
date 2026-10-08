import * as v from 'valibot';
import { HttpError } from '#lib/httpError';

export const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'El cuerpo de la solicitud debe contener JSON válido.');
  }
};

export const parseRequest = <TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  value: unknown,
): v.InferOutput<TSchema> => {
  const result = v.safeParse(schema, value);
  if (!result.success) throw new HttpError(400, 'INVALID_REQUEST', 'Revisa los datos enviados e inténtalo nuevamente.');
  return result.output;
};

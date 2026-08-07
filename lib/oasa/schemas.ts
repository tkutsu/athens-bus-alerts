import { z } from "zod";

const nullableText = z.string().nullable().optional();

export const routeSchema = z.object({
  RouteCode: z.string(),
  hidden: z.string().optional(),
  RouteDescr: z.string(),
  RouteDescrEng: nullableText,
  LineID: z.string(),
  LineDescr: z.string(),
  LineDescrEng: nullableText,
});

export const arrivalSchema = z.object({
  route_code: z.string(),
  veh_code: z.string(),
  btime2: z.string(),
});

export const routesResponseSchema = z.array(routeSchema).nullable();
export const arrivalsResponseSchema = z.array(arrivalSchema).nullable();

export type OasaRoute = z.infer<typeof routeSchema>;
export type OasaArrival = z.infer<typeof arrivalSchema>;

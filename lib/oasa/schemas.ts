import { z } from "zod";

const nullableText = z.string().nullable().optional();

export const closestStopSchema = z.object({
  StopCode: z.string(),
  StopDescr: z.string(),
  StopDescrEng: nullableText,
  StopStreet: nullableText,
  StopStreetEng: nullableText,
  StopLat: z.string(),
  StopLng: z.string(),
});

export const stopDetailsSchema = z.object({
  stop_descr: z.string(),
  stop_descr_matrix_eng: nullableText,
  stop_lat: z.string(),
  stop_lng: z.string(),
  stop_id: z.string(),
});

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

export const closestStopsResponseSchema = z
  .array(closestStopSchema)
  .nullable();
export const stopDetailsResponseSchema = z
  .array(stopDetailsSchema)
  .nullable();
export const routesResponseSchema = z.array(routeSchema).nullable();
export const arrivalsResponseSchema = z.array(arrivalSchema).nullable();

export type OasaClosestStop = z.infer<typeof closestStopSchema>;
export type OasaStopDetails = z.infer<typeof stopDetailsSchema>;
export type OasaRoute = z.infer<typeof routeSchema>;
export type OasaArrival = z.infer<typeof arrivalSchema>;

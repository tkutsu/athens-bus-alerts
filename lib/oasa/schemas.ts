import { z } from "zod";

const nullableText = z.string().nullable().optional();

export const routeSchema = z.object({
  RouteCode: z.string(),
  RouteType: nullableText,
  RouteDistance: nullableText,
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

export const routeDetailPointSchema = z.object({
  routed_x: z.string(),
  routed_y: z.string(),
  routed_order: z.string(),
});

export const routeStopSchema = z.object({
  StopCode: z.string(),
  StopID: z.string().optional(),
  StopDescr: z.string(),
  StopDescrEng: nullableText,
  StopStreet: nullableText,
  StopStreetEng: nullableText,
  StopHeading: nullableText,
  StopLat: z.string(),
  StopLng: z.string(),
  RouteStopOrder: z.string(),
  StopType: nullableText,
  StopAmea: nullableText,
});

export const routeDetailsResponseSchema = z.object({
  details: z.array(routeDetailPointSchema),
  stops: z.array(routeStopSchema),
});

export const busLocationSchema = z.object({
  VEH_NO: z.string(),
  CS_DATE: z.string(),
  CS_LAT: z.string(),
  CS_LNG: z.string(),
  ROUTE_CODE: z.string(),
});

export const routesResponseSchema = z.array(routeSchema).nullable();
export const arrivalsResponseSchema = z.array(arrivalSchema).nullable();
export const busLocationsResponseSchema = z.array(busLocationSchema).nullable();

export type OasaRoute = z.infer<typeof routeSchema>;
export type OasaArrival = z.infer<typeof arrivalSchema>;
export type OasaRouteDetails = z.infer<typeof routeDetailsResponseSchema>;
export type OasaBusLocation = z.infer<typeof busLocationSchema>;

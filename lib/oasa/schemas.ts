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

export const routeStopSchema = z.object({
  StopCode: z.string(),
  StopID: z.string().optional(),
  StopDescr: z.string(),
  StopDescrEng: nullableText,
  StopStreet: nullableText,
  StopStreetEng: nullableText,
  StopLat: z.string(),
  StopLng: z.string(),
  RouteStopOrder: z.string(),
  StopType: nullableText,
  StopAmea: nullableText,
});

// The upstream payload also carries a `details` polyline; nothing renders route
// geometry, so it is left unparsed and stripped here.
export const routeDetailsResponseSchema = z.object({
  stops: z.array(routeStopSchema),
});

export const routesResponseSchema = z.array(routeSchema).nullable();
export const arrivalsResponseSchema = z.array(arrivalSchema).nullable();

export type OasaRoute = z.infer<typeof routeSchema>;
export type OasaArrival = z.infer<typeof arrivalSchema>;
export type OasaRouteDetails = z.infer<typeof routeDetailsResponseSchema>;

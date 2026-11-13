import { z } from "zod";

// OASA has sent the same fields both as quoted strings and as bare numbers, so
// accept either and hand the rest of the app strings.
const text = z.union([z.string(), z.number()]).transform(String);
const nullableText = text.nullable().optional();

export const routeSchema = z.object({
  RouteCode: text,
  RouteType: nullableText,
  RouteDistance: nullableText,
  hidden: text.optional(),
  RouteDescr: text,
  RouteDescrEng: nullableText,
  LineID: text,
  LineDescr: text,
  LineDescrEng: nullableText,
});

export const arrivalSchema = z.object({
  route_code: text,
  veh_code: text,
  btime2: text,
});

export const routeStopSchema = z.object({
  StopCode: text,
  StopID: text.optional(),
  StopDescr: text,
  StopDescrEng: nullableText,
  StopStreet: nullableText,
  StopStreetEng: nullableText,
  StopLat: text,
  StopLng: text,
  RouteStopOrder: text,
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

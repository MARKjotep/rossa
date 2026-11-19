import type { ctx } from "@/http/ctx";

export const METHODS = [
  "GET",
  "POST",
  "PUT",
  "HEAD",
  "DELETE",
  "PATCH",
  "EVENT",
  "OPTIONS",
] as const;

export type methodsKeys = (typeof METHODS)[number];

export type handlerGuard = {
  guards: any[];
  handler: Function;
};

export type methodGuards = Partial<Record<methodsKeys, handlerGuard>>;

export class Methods {
  [key: string]: any;
  /**
   * The GET method requests a representation of the specified resource.
   * Requests using GET should only retrieve data.
   */
  get?({ req, res }: ctx): Promise<Response> | Response;

  /**
   * The POST method is used to submit an entity to the specified resource,
   * often causing a change in state or side effects on the server.
   */
  post?({ req, res }: ctx): Promise<Response> | Response;

  /**
   * The PUT method replaces all current representations of the target
   * resource with the request payload.
   */
  put?({ req, res }: ctx): Promise<Response> | Response;

  /**
   * The HEAD method asks for a response identical to that of a GET request,
   * but without the response body.
   */
  head?({ req, res }: ctx): Promise<Response> | Response;
  /**
   * The DELETE method deletes the specified resource.
   */
  delete?({ req, res }: ctx): Promise<Response> | Response;

  /**
   * The OPTIONS method is used to describe the communication options
   * for the target resource (essential for CORS preflight).
   */

  options({ res, methods }: ctx): Response {
    const allowedMethods = [...new Set([...methods])];
    return res.header({ Allow: allowedMethods.join(", ") }).null(204);
  }

  /**
   * The PATCH method is used to apply partial modifications to a resource.
   */
  patch?({ req, res }: ctx): Promise<Response> | Response;

  /**
   * Specialized handler for Server-Sent Events (SSE).
   * Used for real-time, uni-directional streaming from server to client.
   */
  event?({ req, res }: ctx): Promise<Response> | Response;
}

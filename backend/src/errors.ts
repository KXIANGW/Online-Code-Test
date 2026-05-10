function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export const UnauthorizedError = () => httpError(401, "Unauthorized");
export const ForbiddenError = () => httpError(403, "Forbidden");
export const NotFoundError = (resource: string) => httpError(404, `${resource} not found`);
export const ConflictError = (message: string) => httpError(409, message);
export const BadRequestError = (message: string) => httpError(400, message);

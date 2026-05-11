import { BadRequestError } from "../errors";

export function parsePositiveIntParam(value: string, name: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw BadRequestError(`${name} must be a positive integer`);
  }
  return Number(value);
}

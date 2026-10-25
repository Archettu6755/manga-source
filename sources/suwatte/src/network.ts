import { networkError } from "@archettu/manga-core";

export async function networkRequest<T>(url: string, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) { throw networkError(error, url); }
}

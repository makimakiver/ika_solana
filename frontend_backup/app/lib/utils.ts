import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff to avoid rate limiting
 *
 * @param fn - The function to retry
 * @param maxRetries - The maximum number of retries
 * @param initialDelay - The initial delay in milliseconds
 * @returns The result of the function
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  onStatus?: (message: string) => void,
): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      console.log(error);
      const isRateLimit =
        error?.cause?.status === 429 ||
        error?.status === 429 ||
        error?.cause?.code === -32010 ||
        error?.message?.includes("Too many requests") ||
        error?.message?.includes("Resource limit exceeded") ||
        error?.cause?.message?.includes("Resource limit exceeded");
      if (isRateLimit) {
        const delayMs = 1000;
        onStatus?.(
          `Rate limited — retrying in 1a... (${attempt + 1}/${maxRetries})`,
        );
        await delay(delayMs);
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Failed after ${maxRetries} attempts: ${lastError!.message}`);
}

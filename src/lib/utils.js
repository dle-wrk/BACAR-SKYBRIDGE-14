// @ts-nocheck
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Merge Tailwind class names, resolving conflicts sensibly.
 * Accepts any values that `clsx` accepts (strings, arrays, objects, falsy values).
 * @param {...any} inputs
 * @returns {string}
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export const isIframe = window.self !== window.top;
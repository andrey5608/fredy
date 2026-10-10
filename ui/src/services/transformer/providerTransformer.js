/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Shape a provider entry for storing on a job.
 *
 * `linkLanguage` is only written when the form offered it (idealista), so every other provider's
 * entry stays exactly what it was.
 *
 * @param {{name: string, id: string, enabled?: boolean, url: string, linkLanguage?: string}} entry
 * @returns {{name: string, id: string, enabled?: boolean, url: string, linkLanguage?: string}}
 */
export function transform({ name, id, enabled, url, linkLanguage }) {
  return {
    name,
    id,
    enabled,
    url,
    ...(linkLanguage === undefined ? {} : { linkLanguage }),
  };
}

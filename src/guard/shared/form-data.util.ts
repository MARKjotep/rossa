/**
 * Converts FormData entries to a plain object, preserving repeated fields as
 * arrays instead of discarding earlier values.
 */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = Object.create(null);

  for (const [key, value] of formData.entries()) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      values[key] = value;
      continue;
    }

    const previous = values[key];
    values[key] = Array.isArray(previous) ? [...previous, value] : [previous, value];
  }

  return values;
}

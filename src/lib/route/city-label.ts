/** Client-safe display helper. */
/** "City, ST" without doubling the state when the display name already carries it ("Columbia, SC"). */
export function cityLabel(city: string, region?: string): string {
  return region && !city.endsWith(`, ${region}`) ? `${city}, ${region}` : city;
}

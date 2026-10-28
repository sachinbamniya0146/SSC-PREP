// States + union territories a student can pick for the "State rank". Kept as plain strings so the value stored on
// User.state is readable in the database and in the admin panel. The frontend has the same list in lib/states.ts.
export const INDIAN_STATES: readonly string[] = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

/** Returns the canonical spelling of a state name (case-insensitive), or null when it is not one of the list. */
export function normalizeState(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  return INDIAN_STATES.find((s) => s.toLowerCase() === t) ?? null;
}

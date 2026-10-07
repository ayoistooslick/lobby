export interface TemplateService {
  name: string;
  prefix: string;
  description: string;
  avgMinutes: number;
  counters: string[];
}

export interface BusinessTemplate {
  key: string;
  label: string;
  blurb: string;
  services: TemplateService[];
}

const template = (
  key: string,
  label: string,
  blurb: string,
  services: Array<[name: string, prefix: string, description: string, avgMinutes: number, counters: number]>
): BusinessTemplate => ({
  key,
  label,
  blurb,
  services: services.map(([name, prefix, description, avgMinutes, counters]) => ({
    name,
    prefix,
    description,
    avgMinutes,
    counters: Array.from({ length: counters }, (_, i) => (counters === 1 ? "Counter 1" : `Counter ${i + 1}`)),
  })),
});

/**
 * Ready-made starting points so a shop only edits names instead of
 * inventing queues from nothing.
 */
export const TEMPLATES: BusinessTemplate[] = [
  template("generic", "General counter", "One queue, any business.", [
    ["General", "A", "Walk-in queue", 5, 1],
  ]),
  template("restaurant", "Restaurant", "Kitchen orders plus a drinks bar.", [
    ["Order & eat in", "K", "Kitchen tickets", 12, 2],
    ["Drinks & dessert", "D", "Bar and dessert counter", 5, 1],
  ]),
  template("clinic", "Clinic", "Reception, pharmacy and vaccinations.", [
    ["See a doctor", "G", "Consultations", 15, 2],
    ["Pharmacy", "P", "Prescriptions and over-the-counter", 6, 1],
    ["Vaccinations", "V", "Immunisations", 8, 1],
  ]),
  template("salon", "Salon & barber", "Hair, nails and beauty bookings.", [
    ["Hair", "H", "Cuts, colour and styling", 40, 2],
    ["Nails & beauty", "N", "Manicures, pedicures, facials", 30, 1],
  ]),
  template("retail", "Shop & counter", "Tills, returns and advice.", [
    ["Pay at the till", "T", "Checkout", 4, 3],
    ["Returns & help", "R", "Returns and questions", 8, 1],
  ]),
  template("repair", "Repair shop", "Drop-off, assessment and collection.", [
    ["Book a repair", "B", "New jobs", 10, 1],
    ["Collection", "C", "Ready-to-collect repairs", 4, 1],
  ]),
  template("office", "Office or government counter", "Certificates, licences and records.", [
    ["Certificates", "C", "Certificates and permits", 12, 2],
    ["Records", "R", "Records and enquiries", 8, 1],
  ]),
  template("auto", "Car service", "Reception and workshop bays.", [
    ["Reception", "R", "Booking in your vehicle", 6, 1],
    ["Service bay", "S", "Work in progress", 60, 2],
  ]),
];

export function findTemplate(key: string): BusinessTemplate {
  return TEMPLATES.find((entry) => entry.key === key) ?? TEMPLATES[0];
}

export function normalisePrefix(value: string, fallback: string): string {
  const cleaned = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 2);
  return cleaned || fallback;
}

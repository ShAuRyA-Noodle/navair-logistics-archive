export type ExporterShipmentInput = {
  mode: string; cargoType: string; goodsDescription: string; packageType: string; quantity: string; handling: string;
  weightKnown: boolean; weightValue: string; weightUnit: 'kg' | 'lb'; dimensionsKnown: boolean; length: string; width: string; height: string; dimensionUnit: 'cm' | 'in';
  seaContainer: string; readiness: 'flexible' | 'date'; date: string; notes: string;
};

const positive = (value: string) => Number(value) > 0;

export function createExporterShipment(input: ExporterShipmentInput) {
  const shipment: Record<string, unknown> = {
    cargoType: input.cargoType,
    goodsDescription: input.goodsDescription.trim() || undefined,
    packageType: input.packageType,
    handling: input.handling,
    weight: input.weightKnown && positive(input.weightValue) ? { value: Number(input.weightValue), unit: input.weightUnit } : { unknown: true },
    dimensions: input.dimensionsKnown && positive(input.length) && positive(input.width) && positive(input.height)
      ? { length: Number(input.length), width: Number(input.width), height: Number(input.height), unit: input.dimensionUnit } : { unknown: true },
    readiness: input.readiness === 'date' && input.date ? { date: input.date } : { flexible: true },
  };
  if (input.quantity && positive(input.quantity)) shipment.quantity = Number(input.quantity);
  if (input.mode === 'sea') shipment.seaContainer = input.seaContainer;
  if (input.notes.trim()) shipment.notes = input.notes.trim();
  return shipment;
}

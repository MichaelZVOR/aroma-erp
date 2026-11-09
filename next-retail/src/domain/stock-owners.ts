export const stockOwners = ["Ирина", "Татьяна", "Кристина", "Миша"] as const;
export type StockOwner = (typeof stockOwners)[number];
export const stockOwnerOptions = stockOwners.map((name) => ({ value: name, label: name }));

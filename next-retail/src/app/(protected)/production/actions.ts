"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireLocalAdmin } from "../../../server/local-auth";
import { getStoreLedger } from "../../../server/store-runtime";

function errorMessage(error: unknown) {
  if (error instanceof ZodError) return "Проверьте заполнение полей выпуска";
  return error instanceof Error ? error.message : "Не удалось выполнить операцию";
}

export async function previewRelease(input: unknown) {
  await requireLocalAdmin();
  try {
    return { ok: true as const, quote: getStoreLedger().quoteProduction(input) };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function postRelease(input: unknown) {
  const user = await requireLocalAdmin();
  try {
    const { id } = getStoreLedger().release(input, user.name);
    for (const route of ["/production", "/stock", "/sales"]) revalidatePath(route);
    return { ok: true as const, id };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function createProductionMaterial(input: unknown) {
  await requireLocalAdmin();
  try {
    getStoreLedger().createMaterial(input);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

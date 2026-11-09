import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { openDatabase } from "../db/connect";
import {
  products,
  productProfiles,
  openedBottles,
  releaseProducts,
  retailDocuments,
  retailHistory,
  shopLots,
  shopMovements,
  shops,
  shopPrices,
  shopPriceHistory,
} from "../db/schema";
import {
  calculateLine,
  calculateTotals,
  cancelSchema,
  countSchema,
  stockDispatchSchema,
  daysBetween,
  expenseSchema,
  receiptSchema,
  priceChangeSchema,
  reviseSchema,
  saleSchema,
  todayMoscow,
  type CalculatedLine,
} from "../domain/store-sales";
import {
  breakEven,
  moneyInput,
  multiplyMoney,
  rateInput,
  subtractMoney,
  sumMoney,
} from "../domain/money";

import {
  decantTitle,
  materialSchema,
  postReleaseSchema,
  releaseCosts,
  releaseSchema,
  titleKey,
} from "../domain/production";

type Connection = ReturnType<typeof openDatabase>;
type Document = typeof retailDocuments.$inferSelect;
type Lot = typeof shopLots.$inferSelect;
type SalePayload = { rows: CalculatedLine[]; totals: ReturnType<typeof calculateTotals> };
export type LedgerFilters = {
  shopId?: string;
  month?: string;
  q?: string;
  page?: number;
  tab?: string;
  age?: number;
  documentKinds?: string[];
  status?: string;
};

function assertDate(date: string) {
  if (date > todayMoscow()) throw new Error("Дата не может быть в будущем");
}

export function createStoreLedger(connection: Connection) {
  const { db, sqlite } = connection;
  sqlite.function("retail_lower", { deterministic: true }, (value: unknown) =>
    String(value ?? "").toLocaleLowerCase("ru"),
  );
  function requireShop(id: string) {
    const shop = db.select().from(shops).where(eq(shops.id, id)).get();
    if (!shop) throw new Error("Выберите существующий магазин");
    return shop;
  }
  function requireProduct(id: string) {
    const product = db.select().from(products).where(eq(products.id, id)).get();
    if (!product || product.kind === "liquid") throw new Error("Выберите готовый штучный товар");
    return product;
  }
  function requireLot(id: string, shopId: string, date: string) {
    const lot = db.select().from(shopLots).where(eq(shopLots.id, id)).get();
    if (!lot || lot.shopId !== shopId) throw new Error("Партия не принадлежит выбранному магазину");
    if (date < lot.receivedDate) throw new Error("Дата раньше поступления партии");
    const latest = db
      .select({ date: sql<string>`max(${shopMovements.date})` })
      .from(shopMovements)
      .where(eq(shopMovements.lotId, id))
      .get();
    if (latest?.date && date < latest.date)
      throw new Error("Дата раньше последнего движения партии");
    return lot;
  }
  function move(documentId: string, lot: Lot, quantity: number, date: string) {
    const remaining = lot.remaining + quantity;
    if (remaining < 0) throw new Error("Недостаточно товара в выбранной партии");
    if (remaining > lot.qty) throw new Error("Возврат превышает исходное количество партии");
    db.update(shopLots).set({ remaining }).where(eq(shopLots.id, lot.id)).run();
    db.insert(shopMovements)
      .values({
        documentId,
        lotId: lot.id,
        qty: quantity,
        cost: multiplyMoney(lot.unitCost, quantity),
        date,
      })
      .run();
  }
  function operation<T extends { key: string; shopId: string; date: string; note: string }>(
    kind: string,
    input: T,
    actor: string,
    perform: (documentId: string) => unknown,
  ) {
    const fingerprint = createHash("sha256").update(JSON.stringify({ kind, input })).digest("hex");
    return sqlite
      .transaction(() => {
        const existing = db
          .select()
          .from(retailDocuments)
          .where(eq(retailDocuments.requestKey, input.key))
          .get();
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new Error("Этот запрос уже сохранён с другими данными");
          return existing;
        }
        requireShop(input.shopId);
        assertDate(input.date);
        const id = randomUUID();
        db.insert(retailDocuments)
          .values({
            id,
            requestKey: input.key,
            fingerprint,
            shopId: input.shopId,
            date: input.date,
            created: new Date().toISOString(),
            actor,
            kind,
            note: input.note,
            payload: "{}",
          })
          .run();
        const payload = perform(id);
        db.update(retailDocuments)
          .set({ payload: JSON.stringify(payload) })
          .where(eq(retailDocuments.id, id))
          .run();
        const saved = db.select().from(retailDocuments).where(eq(retailDocuments.id, id)).get()!;
        db.insert(retailHistory)
          .values({
            documentId: id,
            revision: 1,
            snapshot: JSON.stringify(saved),
            created: saved.created,
            actor,
            reason: "Создание документа",
          })
          .run();
        return saved;
      })
      .immediate();
  }

  function openBottleRows(shopId: string) {
    return db
      .select({ open: openedBottles, lot: shopLots, product: products })
      .from(openedBottles)
      .innerJoin(shopLots, eq(shopLots.id, openedBottles.lotId))
      .innerJoin(products, eq(products.id, shopLots.productId))
      .where(and(eq(shopLots.shopId, shopId), sql`${openedBottles.balance} > 0`))
      .orderBy(products.name, openedBottles.date, openedBottles.id)
      .all();
  }

  function productionQuote(input: z.infer<typeof releaseSchema>, date: string) {
    const destination = requireShop(input.destinationShopId ?? input.shopId);
    assertDate(date);
    function component(id: string, kind: string, quantity: number) {
      const lot = requireLot(id, input.shopId, date);
      const product = requireProduct(lot.productId);
      if (product.kind !== kind) throw new Error("Выберите складскую партию нужной категории");
      if (lot.expiryDate && lot.expiryDate < date) throw new Error("Срок годности партии истёк");
      if (lot.remaining < quantity) throw new Error(`Не хватает в партии: ${product.name}`);
      return { lot, product };
    }

    const open = input.source.startsWith("open:")
      ? db
          .select()
          .from(openedBottles)
          .where(eq(openedBottles.id, input.source.slice(5)))
          .get()
      : undefined;
    if (input.source.startsWith("open:") && !open) throw new Error("Открытый флакон не найден");
    const source = component(open?.lotId ?? input.source, "bottle", open ? 0 : 1);
    if (open && date < open.date) throw new Error("Дата раньше последнего расхода флакона");
    const balance = open?.balance ?? source.product.capacity;
    if (!balance || balance < input.volume * input.quantity * 1000)
      throw new Error("В выбранном флаконе не хватает парфюма");
    const sourceCost = open?.cost ?? source.lot.unitCost;
    const atom = component(input.atom, "atom", input.quantity);
    const label = component(input.label, "label", input.quantity);
    const capacity = input.volume * 1000;
    if ((atom.product.capacity ?? 0) < capacity)
      throw new Error("Атомайзер меньше выбранного объёма распива");

    const aroma = titleKey(decantTitle(source.product.name, 0));
    const linked = db
      .select()
      .from(releaseProducts)
      .where(and(eq(releaseProducts.aroma, aroma), eq(releaseProducts.volume, input.volume)))
      .get();
    const suggestedName = input.outputName || decantTitle(source.product.name, input.volume);
    const matches = linked
      ? [requireProduct(linked.productId)]
      : db
          .select()
          .from(products)
          .where(and(eq(products.kind, "decant"), eq(products.capacity, capacity)))
          .all()
          .filter((product) => titleKey(product.name) === titleKey(suggestedName));
    if (matches.length > 1) throw new Error("В каталоге несколько одинаковых карточек распива");
    const existing = matches[0];
    if (existing && (existing.kind !== "decant" || existing.capacity !== capacity))
      throw new Error("Проверьте категорию и объём связанной карточки");
    const name = existing?.name ?? suggestedName;
    const expiryDate =
      [source.lot.expiryDate, atom.lot.expiryDate, label.lot.expiryDate]
        .filter((value): value is string => value !== null)
        .sort()[0] ?? null;
    const costs = releaseCosts(
      input,
      { balance, cost: sourceCost },
      atom.lot.unitCost,
      label.lot.unitCost,
    );
    const estimate = {
      date,
      destinationShopId: destination.id,
      destinationShopName: destination.name,
      name,
      productId: existing?.id ?? null,
      balance,
      ...costs,
      owner: source.lot.owner,
      preliminary: [source.lot, atom.lot, label.lot].some((lot) => lot.preliminary),
      expiryDate,
      perfume: source.product.name,
      atom: atom.product.name,
      label: label.product.name,
    };
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          input,
          estimate,
          sourceCost,
          source: source.lot,
          atom: atom.lot,
          label: label.lot,
        }),
      )
      .digest("hex");
    return { estimate: { ...estimate, fingerprint }, source, atom, label, open, sourceCost, aroma };
  }

  function currentPrice(shopId: string, productId: string) {
    const product = requireProduct(productId);
    const saved = db
      .select()
      .from(shopPrices)
      .where(and(eq(shopPrices.shopId, shopId), eq(shopPrices.productId, productId)))
      .get();
    return { price: saved?.price ?? product.sale, revision: saved?.revision ?? 0 };
  }
  function applyPrice(
    shopId: string,
    productId: string,
    price: number,
    documentId: string,
    actor: string,
  ) {
    const previous = currentPrice(shopId, productId);
    const revision = previous.revision + 1;
    db.insert(shopPrices)
      .values({ shopId, productId, price, revision })
      .onConflictDoUpdate({
        target: [shopPrices.shopId, shopPrices.productId],
        set: { price, revision },
      })
      .run();
    db.insert(shopPriceHistory)
      .values({
        shopId,
        productId,
        documentId,
        oldPrice: previous.price,
        price,
        revision,
        created: new Date().toISOString(),
        actor,
      })
      .run();
    return { oldPrice: previous.price, price, revision };
  }
  return {
    createShops(names: string[]) {
      return sqlite
        .transaction(() => {
          if (names.length !== 2) throw new Error("Укажите названия двух магазинов");
          if (db.select().from(shops).all().length) throw new Error("Магазины уже созданы");
          const clean = names.map((name) => name.trim().replace(/\s+/g, " "));
          if (
            clean.some((name) => name.length < 1 || name.length > 100) ||
            clean[0].toLocaleLowerCase("ru") === clean[1].toLocaleLowerCase("ru")
          ) {
            throw new Error("Нужны два разных названия магазинов");
          }
          db.insert(shops)
            .values(
              clean.map((name) => ({
                id: randomUUID(),
                name,
                nameKey: name.toLocaleLowerCase("ru"),
                created: new Date().toISOString(),
              })),
            )
            .run();
          return db.select().from(shops).all();
        })
        .immediate();
    },
    receipt(raw: unknown, actor: string) {
      const input = receiptSchema.parse(raw);
      return operation(input.initial ? "initial" : "receipt", input, actor, (documentId) => {
        const priceUpdates = new Map<string, { price: number; revision?: number }>();
        for (const row of input.rows) {
          if (row.salePrice === undefined) continue;
          const price = moneyInput(row.salePrice);
          const existing = priceUpdates.get(row.productId);
          if (existing && (existing.price !== price || existing.revision !== row.priceRevision))
            throw new Error("У одного товара в приёмке должны быть одинаковые продажные цены");
          priceUpdates.set(row.productId, { price, revision: row.priceRevision });
        }
        for (const [productId, update] of priceUpdates) {
          const current = currentPrice(input.shopId, productId);
          if (update.revision !== undefined && update.revision !== current.revision)
            throw new Error("Цена магазина изменилась. Обновите приёмку перед проведением");
        }
        const rows = input.rows.map((row) => {
          const product = requireProduct(row.productId);
          if (row.originDate && row.originDate > input.date)
            throw new Error("Исходная дата позже поступления");
          if (row.expiryDate && row.originDate && row.expiryDate < row.originDate)
            throw new Error("Срок годности раньше исходной даты");
          const unitCost = moneyInput(row.unitCost);
          const lotId = randomUUID();
          db.insert(shopLots)
            .values({
              id: lotId,
              shopId: input.shopId,
              productId: product.id,
              documentId,
              receivedDate: input.date,
              originDate: row.originDate,
              owner: row.owner ?? null,
              expiryDate: row.expiryDate,
              qty: row.qty,
              remaining: row.qty,
              unitCost,
              preliminary: row.preliminary,
            })
            .run();
          db.insert(shopMovements)
            .values({
              documentId,
              lotId,
              qty: row.qty,
              cost: multiplyMoney(unitCost, row.qty),
              date: input.date,
            })
            .run();
          return {
            ...row,
            unitCost,
            lotId,
            name: product.name,
            code: product.code,
            price:
              priceUpdates.get(product.id)?.price ?? currentPrice(input.shopId, product.id).price,
          };
        });
        const priceChanges = [...priceUpdates].map(([productId, update]) => ({
          productId,
          ...applyPrice(input.shopId, productId, update.price, documentId, actor),
        }));
        return { rows, priceChanges };
      });
    },
    changePrice(raw: unknown, actor: string) {
      const input = priceChangeSchema.parse(raw);
      if (input.date !== todayMoscow()) throw new Error("Переоценка применяется текущей датой");
      return operation("price", input, actor, (documentId) => {
        const product = requireProduct(input.productId);
        const current = currentPrice(input.shopId, product.id);
        if (current.revision !== input.expectedRevision || current.price !== input.expectedPrice)
          throw new Error("Цена уже изменилась. Обновите остатки и повторите");
        const stock = db
          .select({ id: shopLots.id })
          .from(shopLots)
          .where(
            and(
              eq(shopLots.shopId, input.shopId),
              eq(shopLots.productId, product.id),
              sql`${shopLots.remaining} > 0`,
            ),
          )
          .get();
        if (!stock) throw new Error("Товар отсутствует в выбранном магазине");
        return {
          rows: [
            {
              productId: product.id,
              name: product.name,
              code: product.code,
              ...applyPrice(input.shopId, product.id, moneyInput(input.price), documentId, actor),
            },
          ],
          reason: input.reason,
        };
      });
    },
    priceHistory(shopId: string, productId: string) {
      requireShop(shopId);
      requireProduct(productId);
      return db
        .select({
          id: shopPriceHistory.id,
          oldPrice: shopPriceHistory.oldPrice,
          price: shopPriceHistory.price,
          revision: shopPriceHistory.revision,
          created: shopPriceHistory.created,
          actor: shopPriceHistory.actor,
          kind: retailDocuments.kind,
          note: retailDocuments.note,
        })
        .from(shopPriceHistory)
        .innerJoin(retailDocuments, eq(retailDocuments.id, shopPriceHistory.documentId))
        .where(and(eq(shopPriceHistory.shopId, shopId), eq(shopPriceHistory.productId, productId)))
        .orderBy(sql`${shopPriceHistory.revision} DESC`)
        .limit(100)
        .all();
    },
    sale(raw: unknown, actor: string) {
      const input = saleSchema.parse(raw);
      return operation("sale", input, actor, (documentId) => {
        const rows = input.rows.map((row) => {
          const lot = requireLot(row.lotId, input.shopId, input.date);
          if (lot.expiryDate && lot.expiryDate < input.date)
            throw new Error("Срок годности партии истёк");
          const product = requireProduct(lot.productId);
          const listPrice = currentPrice(input.shopId, product.id).price;
          if (listPrice === null) throw new Error(`Нет обычной цены: ${product.name}`);
          if (row.expectedListPrice !== undefined && row.expectedListPrice !== listPrice)
            throw new Error("Цена магазина изменилась. Выберите товар для продажи заново");
          const price = moneyInput(row.price);
          if (price > listPrice)
            throw new Error("Цена выше прайса: сначала уточните обычную цену товара");
          const calculated = calculateLine({
            lotId: lot.id,
            productId: product.id,
            name: product.name,
            code: product.code,
            qty: row.qty,
            unitCost: lot.unitCost,
            preliminary: lot.preliminary,
            listPrice,
            price,
            payment: row.payment,
            rate: row.payment === "card" ? rateInput(row.rate) : "0",
          });
          move(documentId, lot, -row.qty, input.date);
          return calculated;
        });
        return { rows, totals: calculateTotals(rows) };
      });
    },
    dispatchStock(raw: unknown, actor: string) {
      const input = stockDispatchSchema.parse(raw);
      return operation(input.kind, input, actor, (documentId) => {
        const destination = input.kind === "transfer" ? requireShop(input.destinationShopId) : null;
        if (destination?.id === input.shopId) throw new Error("Выберите другой магазин назначения");
        if (new Set(input.rows.map(({ lotId }) => lotId)).size !== input.rows.length)
          throw new Error("Каждая партия должна быть добавлена один раз");
        const rows = input.rows.map(({ lotId, qty }) => {
          const lot = requireLot(lotId, input.shopId, input.date);
          const product = requireProduct(lot.productId);
          move(documentId, lot, -qty, input.date);
          let destinationLotId: string | null = null;
          if (destination) {
            destinationLotId = randomUUID();
            const newLot = {
              ...lot,
              id: destinationLotId,
              shopId: destination.id,
              documentId,
              qty,
              remaining: 0,
              receivedDate: input.date,
            };
            db.insert(shopLots).values(newLot).run();
            move(documentId, newLot, qty, input.date);
          }
          return {
            lotId,
            destinationLotId,
            productId: product.id,
            name: product.name,
            code: product.code,
            qty,
            unitCost: lot.unitCost,
            cost: multiplyMoney(lot.unitCost, qty),
            owner: lot.owner,
            originDate: lot.originDate,
            expiryDate: lot.expiryDate,
            preliminary: lot.preliminary,
          };
        });
        return {
          rows,
          cost: sumMoney(rows.map((row) => row.cost)),
          ...(destination
            ? { destinationShopId: destination.id, destinationShopName: destination.name }
            : {}),
          ...(input.kind === "writeoff" ? { reason: input.reason } : {}),
        };
      });
    },
    inventory(raw: unknown, actor: string) {
      const input = countSchema.parse(raw);
      return operation("inventory", input, actor, (documentId) => {
        const lot = requireLot(input.lotId, input.shopId, input.date);
        if (lot.remaining !== input.expected)
          throw new Error("Остаток изменился. Обновите пересчёт");
        const product = requireProduct(lot.productId);
        const difference = input.actual - lot.remaining;
        if (!difference) throw new Error("Расхождения нет: корректировка не требуется");
        if (difference < 0) move(documentId, lot, difference, input.date);
        else {
          const lotId = randomUUID();
          db.insert(shopLots)
            .values({
              ...lot,
              id: lotId,
              documentId,
              receivedDate: input.date,
              originDate: null,
              qty: difference,
              remaining: difference,
            })
            .run();
          db.insert(shopMovements)
            .values({
              documentId,
              lotId,
              qty: difference,
              cost: multiplyMoney(lot.unitCost, difference),
              date: input.date,
            })
            .run();
        }
        return {
          lotId: lot.id,
          name: product.name,
          expected: input.expected,
          actual: input.actual,
          difference,
          cost: multiplyMoney(lot.unitCost, Math.abs(difference)),
          preliminary: lot.preliminary,
          reason: input.reason,
        };
      });
    },
    expense(raw: unknown, actor: string) {
      const input = expenseSchema.parse(raw);
      return operation("expense", input, actor, () => {
        const amount = moneyInput(input.amount);
        if (!amount) throw new Error("Расход должен быть больше нуля");
        return { category: input.category, amount };
      });
    },
    cancel(raw: unknown, actor: string) {
      const input = cancelSchema.parse(raw);
      return sqlite
        .transaction(() => {
          const original = db
            .select()
            .from(retailDocuments)
            .where(eq(retailDocuments.id, input.documentId))
            .get();
          if (!original || original.kind !== "sale") throw new Error("Выберите документ продажи");
          return operation(
            "reversal",
            {
              key: input.key,
              shopId: original.shopId,
              date: input.date,
              note: input.reason,
              documentId: original.id,
            },
            actor,
            (documentId) => {
              if (original.status !== "posted") throw new Error("Продажа уже отменена");
              if (input.date !== original.date)
                throw new Error(
                  "Поздняя отмена требует отдельной корректировки. Выберите дату исходной продажи",
                );
              const movements = db
                .select()
                .from(shopMovements)
                .where(eq(shopMovements.documentId, original.id))
                .all();
              for (const movement of movements) {
                const latest = db
                  .select({ id: sql<number>`max(${shopMovements.id})` })
                  .from(shopMovements)
                  .where(eq(shopMovements.lotId, movement.lotId))
                  .get();
                const originalLast = Math.max(
                  ...movements
                    .filter((entry) => entry.lotId === movement.lotId)
                    .map((entry) => entry.id),
                );
                if (latest?.id !== originalLast)
                  throw new Error(
                    "После продажи есть движения партии. Сначала разберите зависимые операции",
                  );
              }
              for (const lotId of new Set(movements.map((movement) => movement.lotId))) {
                const lot = requireLot(lotId, original.shopId, input.date);
                const quantity = movements
                  .filter((movement) => movement.lotId === lotId)
                  .reduce((sum, movement) => sum + movement.qty, 0);
                move(documentId, lot, -quantity, input.date);
              }
              db.update(retailDocuments)
                .set({ status: "reversed" })
                .where(eq(retailDocuments.id, original.id))
                .run();
              db.update(retailDocuments)
                .set({ reversesId: original.id })
                .where(eq(retailDocuments.id, documentId))
                .run();
              return { originalId: original.id, reason: input.reason };
            },
          );
        })
        .immediate();
    },
    revise(raw: unknown, actor: string) {
      const input = reviseSchema.parse(raw);
      const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      return sqlite
        .transaction(() => {
          const priorRequest = db
            .select()
            .from(retailHistory)
            .where(eq(retailHistory.requestKey, input.key))
            .get();
          if (priorRequest) {
            if (priorRequest.fingerprint !== fingerprint)
              throw new Error("Этот запрос уже сохранён с другими данными");
            return JSON.parse(priorRequest.snapshot) as Document;
          }
          const original = db
            .select()
            .from(retailDocuments)
            .where(eq(retailDocuments.id, input.documentId))
            .get();
          if (!original || original.kind !== "sale" || original.status !== "posted")
            throw new Error("Продажа недоступна для исправления");
          if (original.revision !== input.revision)
            throw new Error("Документ уже изменён. Откройте последнюю версию");
          if (original.shopId !== input.shopId || original.date !== input.date)
            throw new Error("В исправлении сохраняются дата и магазин исходного отчёта");
          const movements = db
            .select()
            .from(shopMovements)
            .where(eq(shopMovements.documentId, original.id))
            .all();
          for (const lotId of new Set(movements.map((entry) => entry.lotId))) {
            const own = movements.filter((entry) => entry.lotId === lotId);
            const latest = db
              .select({ id: sql<number>`max(${shopMovements.id})` })
              .from(shopMovements)
              .where(eq(shopMovements.lotId, lotId))
              .get();
            if (latest?.id !== Math.max(...own.map((entry) => entry.id)))
              throw new Error(
                "После отчёта есть движения партии. Исправление требует разбора зависимостей",
              );
            const lot = requireLot(lotId, input.shopId, input.date);
            move(original.id, lot, -own.reduce((sum, entry) => sum + entry.qty, 0), input.date);
          }
          const prior = (JSON.parse(original.payload) as SalePayload).rows;
          const rows = input.rows.map((row) => {
            const lot = requireLot(row.lotId, input.shopId, input.date);
            if (lot.expiryDate && lot.expiryDate < input.date)
              throw new Error("Срок годности партии истёк");
            const product = requireProduct(lot.productId);
            const frozen = prior.find((entry) => entry.lotId === lot.id);
            const listPrice = frozen?.listPrice ?? currentPrice(input.shopId, product.id).price;
            if (listPrice === null) throw new Error("Нет обычной цены товара");
            const price = moneyInput(row.price);
            if (price > listPrice) throw new Error("Цена выше сохранённой обычной цены");
            const calculated = calculateLine({
              lotId: lot.id,
              productId: product.id,
              name: frozen?.name ?? product.name,
              code: frozen?.code ?? product.code,
              qty: row.qty,
              unitCost: lot.unitCost,
              preliminary: lot.preliminary,
              listPrice,
              price,
              payment: row.payment,
              rate: row.payment === "card" ? rateInput(row.rate) : "0",
            });
            move(original.id, lot, -row.qty, input.date);
            return calculated;
          });
          const saved = {
            ...original,
            revision: original.revision + 1,
            note: input.note,
            payload: JSON.stringify({ rows, totals: calculateTotals(rows) }),
          };
          db.update(retailDocuments)
            .set({ revision: saved.revision, note: saved.note, payload: saved.payload })
            .where(eq(retailDocuments.id, saved.id))
            .run();
          db.insert(retailHistory)
            .values({
              documentId: saved.id,
              revision: saved.revision,
              snapshot: JSON.stringify(saved),
              created: new Date().toISOString(),
              actor,
              reason: input.reason,
              requestKey: input.key,
              fingerprint,
            })
            .run();
          return saved;
        })
        .immediate();
    },
    productionOptions(shopId: string) {
      if (!shopId) return { materials: [], opened: [] };
      requireShop(shopId);
      const materials = db
        .select({ lot: shopLots, product: products })
        .from(shopLots)
        .innerJoin(products, eq(products.id, shopLots.productId))
        .where(
          and(
            eq(shopLots.shopId, shopId),
            sql`${shopLots.remaining} > 0`,
            sql`${products.kind} in ('bottle', 'atom', 'label')`,
          ),
        )
        .orderBy(products.name, shopLots.receivedDate, shopLots.id)
        .all();
      return { materials, opened: openBottleRows(shopId) };
    },
    createMaterial(raw: unknown) {
      const input = materialSchema.parse(raw);
      return sqlite
        .transaction(() => {
          const capacity = input.kind === "atom" ? input.capacity * 1000 : null;
          const existing = db
            .select()
            .from(products)
            .where(eq(products.kind, input.kind))
            .all()
            .find((product) => titleKey(product.name) === titleKey(input.name));
          if (existing) {
            if (existing.capacity !== capacity)
              throw new Error("Укажите отличающееся название материала");
            return existing.id!;
          }
          const id = randomUUID();
          db.insert(products)
            .values({
              id,
              code: `MAT-${id.slice(0, 12)}`,
              name: input.name,
              kind: input.kind,
              capacity,
            })
            .run();
          return id;
        })
        .immediate();
    },
    quoteProduction(raw: unknown) {
      const input = releaseSchema.parse(raw);
      return sqlite.transaction(() => productionQuote(input, todayMoscow()).estimate)();
    },
    release(raw: unknown, actor: string) {
      const { key, fingerprint, date, note, ...input } = postReleaseSchema.parse(raw);
      return operation(
        "production",
        { key, fingerprint, date, note, ...input },
        actor,
        (documentId) => {
          if (date !== todayMoscow()) throw new Error("Дата изменилась. Пересчитайте выпуск");
          const { estimate, source, atom, label, open, sourceCost, aroma } = productionQuote(
            input,
            date,
          );
          if (fingerprint !== estimate.fingerprint)
            throw new Error("Расчёт устарел. Рассчитайте выпуск заново");
          const productId = estimate.productId ?? randomUUID();
          if (!estimate.productId) {
            db.insert(products)
              .values({
                id: productId,
                code: `R-${productId.slice(0, 12)}`,
                name: estimate.name,
                kind: "decant",
                capacity: input.volume * 1000,
              })
              .run();
          }
          db.insert(releaseProducts)
            .values({ aroma, volume: input.volume, productId })
            .onConflictDoNothing()
            .run();

          const balance = estimate.balance - estimate.used;
          const cost = subtractMoney(sourceCost, estimate.perfumeCost);
          const openId = open?.id ?? randomUUID();
          if (open) {
            db.update(openedBottles)
              .set({ balance, cost, date })
              .where(eq(openedBottles.id, openId))
              .run();
          } else {
            move(documentId, source.lot, -1, date);
            db.insert(openedBottles)
              .values({
                id: openId,
                lotId: source.lot.id,
                documentId,
                date,
                balance,
                cost,
              })
              .run();
          }
          move(documentId, atom.lot, -input.quantity, date);
          move(documentId, label.lot, -input.quantity, date);
          const outputLots = estimate.output.map(({ quantity, unitCost }) => {
            const id = randomUUID();
            db.insert(shopLots)
              .values({
                id,
                shopId: estimate.destinationShopId,
                productId,
                documentId,
                receivedDate: date,
                originDate: date,
                owner: estimate.owner,
                expiryDate: estimate.expiryDate,
                qty: quantity,
                remaining: quantity,
                unitCost,
                preliminary: estimate.preliminary,
              })
              .run();
            db.insert(shopMovements)
              .values({
                documentId,
                lotId: id,
                qty: quantity,
                cost: multiplyMoney(unitCost, quantity),
                date,
              })
              .run();
            return id;
          });
          return {
            ...estimate,
            volume: input.volume,
            quantity: input.quantity,
            productId,
            balanceAfter: balance,
            sourceLot: source.lot.id,
            atomLot: atom.lot.id,
            labelLot: label.lot.id,
            openId,
            outputLots,
          };
        },
      );
    },

    findProducts(q: string) {
      const needle = `%${q.slice(0, 100).toLocaleLowerCase("ru").replace(/[!%_]/g, "!$&")}%`;
      return db
        .select()
        .from(products)
        .where(
          and(
            sql`${products.kind} != 'liquid'`,
            sql`retail_lower(${products.name}) LIKE ${needle} ESCAPE '!'`,
          ),
        )
        .orderBy(products.name)
        .limit(25)
        .all();
    },
    browseProducts(query = "", category = "", requestedPage = 1, shopId = "") {
      if (shopId) requireShop(shopId);
      const group = sql<string>`coalesce(nullif(json_extract(${productProfiles.data}, '$.category'), ''),
        case ${products.kind}
          when 'bottle' then 'Полноразмерные флаконы'
          when 'decant' then 'Распив'
          when 'atom' then 'Атомайзеры'
          else ${products.kind}
        end)`;
      const visible = sql`${products.kind} != 'liquid' and
        coalesce(json_extract(${productProfiles.data}, '$.archived_from_catalog'), 0) = 0`;
      const needle = `%${query.slice(0, 100).toLocaleLowerCase("ru").replace(/[!%_]/g, "!$&")}%`;
      const condition = and(
        visible,
        category ? sql`${group} = ${category}` : undefined,
        sql`retail_lower(${products.name}) LIKE ${needle} ESCAPE '!'`,
      );
      const categories = db
        .select({ name: group, count: sql<number>`count(*)` })
        .from(products)
        .leftJoin(productProfiles, eq(products.id, productProfiles.productId))
        .where(visible)
        .groupBy(group)
        .orderBy(group)
        .all();
      const total = db
        .select({ count: sql<number>`count(*)` })
        .from(products)
        .leftJoin(productProfiles, eq(products.id, productProfiles.productId))
        .where(condition)
        .get()!.count;
      const page = Math.min(
        Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1),
        Math.max(1, Math.ceil(total / 25)),
      );
      const rows = db
        .select({ product: products, profile: productProfiles.data, category: group })
        .from(products)
        .leftJoin(productProfiles, eq(products.id, productProfiles.productId))
        .where(condition)
        .orderBy(products.name, products.id)
        .limit(25)
        .offset((page - 1) * 25)
        .all();
      return {
        total,
        page,
        categories,
        rows: rows.map(({ product, profile, category }) => {
          const metadata = profile
            ? (JSON.parse(profile) as {
                barcode?: string;
                vendor_code?: string;
                purchase_price?: number | null;
              })
            : {};
          return {
            product,
            category,
            salePrice: shopId ? currentPrice(shopId, product.id).price : product.sale,
            priceRevision: shopId ? currentPrice(shopId, product.id).revision : 0,
            barcode: metadata.barcode ?? "",
            vendorCode: metadata.vendor_code ?? "",
            suggestedCost:
              Number.isSafeInteger(metadata.purchase_price) && metadata.purchase_price! >= 0
                ? metadata.purchase_price!
                : null,
          };
        }),
      };
    },
    findLots(shopId: string, q: string, includeEmpty = false) {
      requireShop(shopId);
      const needle = `%${q.slice(0, 100).toLocaleLowerCase("ru").replace(/[!%_]/g, "!$&")}%`;
      return db
        .select({
          id: shopLots.id,
          productId: products.id,
          name: products.name,
          code: products.code,
          remaining: shopLots.remaining,
          unitCost: shopLots.unitCost,
          preliminary: shopLots.preliminary,
          price: sql<number | null>`coalesce(${shopPrices.price}, ${products.sale})`,
          date: shopLots.receivedDate,
          expiryDate: shopLots.expiryDate,
          owner: shopLots.owner,
        })
        .from(shopLots)
        .innerJoin(products, eq(products.id, shopLots.productId))
        .leftJoin(
          shopPrices,
          and(eq(shopPrices.productId, products.id), eq(shopPrices.shopId, shopLots.shopId)),
        )
        .where(
          and(
            eq(shopLots.shopId, shopId),
            includeEmpty ? undefined : sql`${shopLots.remaining} > 0`,
            sql`retail_lower(${products.name}) LIKE ${needle} ESCAPE '!'`,
          ),
        )
        .orderBy(shopLots.receivedDate, shopLots.id)
        .limit(50)
        .all();
    },
    history(id: string) {
      return db
        .select()
        .from(retailHistory)
        .where(eq(retailHistory.documentId, id))
        .orderBy(sql`${retailHistory.revision} DESC`)
        .all()
        .map((entry) => ({ ...entry, snapshot: JSON.parse(entry.snapshot) as Document }));
    },
    edit(id: string) {
      const document = db.select().from(retailDocuments).where(eq(retailDocuments.id, id)).get();
      if (!document || document.kind !== "sale" || document.status !== "posted")
        throw new Error("Продажа недоступна для исправления");
      const payload = JSON.parse(document.payload) as SalePayload;
      const rows = payload.rows.map((row) => {
        const lot = db.select().from(shopLots).where(eq(shopLots.id, row.lotId)).get()!;
        return {
          row,
          lot: {
            id: lot.id,
            productId: row.productId,
            name: row.name,
            code: row.code,
            remaining:
              lot.remaining +
              payload.rows
                .filter((entry) => entry.lotId === lot.id)
                .reduce((sum, entry) => sum + entry.qty, 0),
            unitCost: lot.unitCost,
            preliminary: lot.preliminary,
            price: row.listPrice,
            date: lot.receivedDate,
            expiryDate: lot.expiryDate,
            owner: lot.owner,
          },
        };
      });
      return {
        id: document.id,
        revision: document.revision,
        shopId: document.shopId,
        date: document.date,
        note: document.note,
        rows,
      };
    },
    exportStock(shopId?: string) {
      if (shopId) requireShop(shopId);
      return db
        .select({ lot: shopLots, product: products, shop: shops, profile: productProfiles.data })
        .from(shopLots)
        .innerJoin(products, eq(products.id, shopLots.productId))
        .innerJoin(shops, eq(shops.id, shopLots.shopId))
        .leftJoin(productProfiles, eq(products.id, productProfiles.productId))
        .where(shopId ? eq(shopLots.shopId, shopId) : undefined)
        .orderBy(shops.name, products.name, shopLots.receivedDate)
        .all()
        .map((row) => ({
          ...row,
          product: { ...row.product, sale: currentPrice(row.shop.id, row.product.id).price },
        }));
    },
    document(id: string) {
      const document = db.select().from(retailDocuments).where(eq(retailDocuments.id, id)).get();
      if (!document) throw new Error("Документ не найден");
      const movements = db
        .select()
        .from(shopMovements)
        .where(eq(shopMovements.documentId, id))
        .all();
      return {
        ...document,
        payload: JSON.parse(document.payload) as Record<string, unknown>,
        movements,
      };
    },
    overview(filters: LedgerFilters = {}) {
      const month =
        filters.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month)
          ? filters.month
          : todayMoscow().slice(0, 7);
      const page = Number.isSafeInteger(filters.page)
        ? Math.max(1, Math.min(filters.page!, 100000))
        : 1;
      const condition = and(
        sql`substr(${retailDocuments.date}, 1, 7) = ${month}`,
        filters.shopId
          ? sql`(${retailDocuments.shopId} = ${filters.shopId} OR (${retailDocuments.kind} = 'transfer' AND json_extract(${retailDocuments.payload}, '$.destinationShopId') = ${filters.shopId}))`
          : undefined,
      );
      const all = db
        .select()
        .from(retailDocuments)
        .where(condition)
        .orderBy(sql`${retailDocuments.created} DESC`)
        .all();
      const saleRows = all
        .filter((doc) => doc.kind === "sale" && doc.status === "posted")
        .flatMap((doc) => (JSON.parse(doc.payload) as SalePayload).rows);
      const totals = calculateTotals(saleRows);
      const soldProducts = new Set(
        all
          .filter((doc) => doc.kind === "sale" && doc.status === "posted")
          .flatMap((doc) =>
            (JSON.parse(doc.payload) as SalePayload).rows.map(
              (row) => `${doc.shopId}:${row.productId}`,
            ),
          ),
      );
      const expenses = sumMoney(
        all
          .filter((doc) => doc.kind === "expense" && doc.status === "posted")
          .map((doc) => (JSON.parse(doc.payload) as { amount: number }).amount),
      );
      const counts = all
        .filter((doc) => doc.kind === "inventory" && doc.status === "posted")
        .map((doc) => JSON.parse(doc.payload) as { difference: number; cost: number });
      const shortage = sumMoney(counts.filter((row) => row.difference < 0).map((row) => row.cost));
      const surplus = sumMoney(counts.filter((row) => row.difference > 0).map((row) => row.cost));
      const needle = `%${(filters.q ?? "").slice(0, 100).toLocaleLowerCase("ru").replace(/[!%_]/g, "!$&")}%`;
      const lotCondition = and(
        sql`${shopLots.remaining} > 0`,
        filters.shopId ? eq(shopLots.shopId, filters.shopId) : undefined,
        sql`retail_lower(${products.name}) LIKE ${needle} ESCAPE '!'`,
      );
      const lotQuery = db
        .select({ lot: shopLots, product: products, shop: shops })
        .from(shopLots)
        .innerJoin(products, eq(products.id, shopLots.productId))
        .innerJoin(shops, eq(shops.id, shopLots.shopId));
      const allStock = lotQuery.where(lotCondition).all();
      const latestSales = db
        .select({
          productId: shopLots.productId,
          shopId: shopLots.shopId,
          date: sql<string>`max(${retailDocuments.date})`,
        })
        .from(shopMovements)
        .innerJoin(shopLots, eq(shopLots.id, shopMovements.lotId))
        .innerJoin(retailDocuments, eq(retailDocuments.id, shopMovements.documentId))
        .where(and(eq(retailDocuments.kind, "sale"), eq(retailDocuments.status, "posted")))
        .groupBy(shopLots.productId, shopLots.shopId)
        .all();
      const stocks = allStock
        .map(({ lot, product, shop }) => {
          const lastSale =
            latestSales.find((row) => row.productId === product.id && row.shopId === shop.id)
              ?.date ?? null;
          const ageDays = lot.originDate ? daysBetween(lot.originDate, todayMoscow()) : null;
          return {
            ...lot,
            name: product.name,
            code: product.code,
            price: currentPrice(shop.id, product.id).price,
            priceRevision: currentPrice(shop.id, product.id).revision,
            shopName: shop.name,
            value: multiplyMoney(lot.unitCost, lot.remaining),
            ageDays,
            lastSale,
            daysWithoutSale: daysBetween(lastSale ?? lot.receivedDate, todayMoscow()),
            noSalesThisMonth: !soldProducts.has(`${shop.id}:${product.id}`),
            expired: Boolean(lot.expiryDate && lot.expiryDate < todayMoscow()),
            breakEvenCash: lot.unitCost,
            breakEvenCard: null as number | null,
          };
        })
        .sort((left, right) => (right.ageDays ?? -1) - (left.ageDays ?? -1));
      const age = Number.isFinite(filters.age) ? Math.max(0, Math.min(filters.age!, 36500)) : 0;
      const filtered = age
        ? stocks.filter(
            (lot) => (lot.ageDays !== null && lot.ageDays >= age) || lot.daysWithoutSale >= age,
          )
        : stocks;
      const stockPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 25)));
      const documentNeedle = (filters.q ?? "").slice(0, 100).toLocaleLowerCase("ru");
      const journal = all.filter(
        (document) =>
          (!filters.documentKinds || filters.documentKinds.includes(document.kind)) &&
          (!filters.status || document.status === filters.status) &&
          (!documentNeedle ||
            `${document.id} ${document.note} ${document.actor} ${document.payload}`
              .toLocaleLowerCase("ru")
              .includes(documentNeedle)),
      );
      const docPage = Math.min(page, Math.max(1, Math.ceil(journal.length / 25)));
      return {
        shops: db.select().from(shops).orderBy(shops.created).all(),
        month,
        totals: {
          ...totals,
          expenses,
          shortage,
          surplus,
          result: subtractMoney(subtractMoney(totals.afterFee, expenses), shortage),
          stockValue: sumMoney(stocks.map((lot) => lot.value)),
          stockPreliminaryValue: sumMoney(
            stocks.filter((lot) => lot.preliminary).map((lot) => lot.value),
          ),
        },
        stocks: filtered.slice((stockPage - 1) * 25, stockPage * 25),
        stockCount: filtered.length,
        stockPage,
        documents: journal.slice((docPage - 1) * 25, docPage * 25).map((document) => ({
          ...document,
          payload: JSON.parse(document.payload) as Record<string, unknown>,
        })),
        documentCount: journal.length,
        documentPage: docPage,
        today: todayMoscow(),
      };
    },
    discountLimit(unitCost: number, rate: string) {
      return breakEven(unitCost, rate);
    },
  };
}

export type StoreLedger = ReturnType<typeof createStoreLedger>;
export type StoreOverview = ReturnType<StoreLedger["overview"]>;
export type ProductOption = ReturnType<StoreLedger["findProducts"]>[number];
export type ProductCatalogue = ReturnType<StoreLedger["browseProducts"]>;
export type LotOption = ReturnType<StoreLedger["findLots"]>[number];
export type StoreDocument = Document;

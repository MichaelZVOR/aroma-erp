import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, test } from "vitest";
import { openDatabase } from "../src/db/connect";
import { settings } from "../src/db/schema";

test("repeat migration preserves existing settings", () => {
  const { db, close } = openDatabase(":memory:");
  try {
    migrate(db, { migrationsFolder: "./drizzle" });
    db.insert(settings).values({ key: "test", value: "42" }).run();
    migrate(db, { migrationsFolder: "./drizzle" });
    expect(db.select().from(settings).all()).toEqual([{ key: "test", value: "42" }]);
  } finally {
    close();
  }
});

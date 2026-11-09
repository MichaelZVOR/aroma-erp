import { randomBytes } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
const directory = path.resolve("data");
mkdirSync(directory, { recursive: true });
const target = path.join(directory, "local-auth.json");
if (existsSync(target)) {
  console.log("Локальный вход уже настроен. Существующие данные сохранены.");
} else {
  const password = randomBytes(12).toString("base64url");
  writeFileSync(
    target,
    JSON.stringify({
      username: "owner",
      hash: bcrypt.hashSync(password, 12),
      secret: randomBytes(48).toString("base64url"),
    }),
    { flag: "wx", mode: 0o600 },
  );
  writeFileSync(
    path.join(directory, "Локальный вход.txt"),
    `Локальная проверка Арома ERP\nЛогин: owner\nПароль: ${password}\n\nНе публикуйте этот файл. Полноценные пользователи и 2FA — отдельный этап.\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log("Вход подготовлен. Данные находятся в data/Локальный вход.txt и исключены из Git.");
}

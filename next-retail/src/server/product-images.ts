import "server-only";
import Database from "better-sqlite3";
import path from "node:path";
import { readFileSync, statSync } from "node:fs";
const mapPath = "C:/Aroma/static/image-map.json";
let modified = -1;
let images: Record<string, string> = {};
function importedImage(code: string) {
  try {
    const stamp = statSync(mapPath).mtimeMs;
    if (stamp !== modified) {
      images = JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, string>;
      modified = stamp;
    }
    const filename = images[code];
    return filename && /^[a-f0-9]{24}\.(png|jpe?g|webp)$/.test(filename)
      ? `http://127.0.0.1:8788/images/${filename}`
      : null;
  } catch {
    return null;
  }
}

type Product = { id: string; code: string };
type PhotoSource = Product & { sourceId: string | null; hasPhoto: number };

export function productImages(products: Product[]) {
  const images = new Map(products.map(({ id, code }) => [id, importedImage(code)]));
  if (!products.length) return images;

  let catalog: Database.Database | undefined;
  try {
    catalog = new Database(path.resolve(process.cwd(), "..", "data", "aroma.sqlite3"), {
      readonly: true,
      fileMustExist: true,
    });
    const findSource = catalog.prepare<[string], PhotoSource>(`
      SELECT p.id, p.code, p.source_id AS sourceId,
        EXISTS (SELECT 1 FROM product_photos photo WHERE photo.product_id = p.id) AS hasPhoto
      FROM products p WHERE p.id = ?
    `);
    for (const { id } of products) {
      const visited = new Set<string>();
      let source = findSource.get(id);
      while (source && !visited.has(source.id)) {
        visited.add(source.id);
        const image = source.hasPhoto
          ? `http://127.0.0.1:8788/product-photo/${encodeURIComponent(source.id)}`
          : importedImage(source.code);
        if (image) {
          images.set(id, image);
          break;
        }
        source = source.sourceId ? findSource.get(source.sourceId) : undefined;
      }
    }
  } catch {
    // Standalone installations without the existing local catalogue can still use imported photos.
  } finally {
    catalog?.close();
  }
  return images;
}

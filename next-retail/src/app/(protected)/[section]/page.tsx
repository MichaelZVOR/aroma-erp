import { notFound } from "next/navigation";
import { isSection, sections } from "../sections";
import SectionView from "./SectionView";
import LegacyFrame from "../LegacyFrame";
import { isLegacySection, legacySource } from "../../../domain/navigation";

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  if (!isSection(section)) notFound();
  if (isLegacySection(section)) {
    const query = await searchParams;
    return (
      <LegacyFrame
        src={legacySource(
          section,
          typeof query.legacy === "string" ? query.legacy : undefined,
          typeof query.category === "string" ? query.category : undefined,
        )}
        title={sections[section]}
      />
    );
  }
  return <SectionView title={sections[section]} />;
}

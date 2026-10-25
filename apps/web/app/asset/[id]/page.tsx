import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { Footer } from "@/features/landing/footer";
import { getReceipt } from "@/features/receipt/data";
import { AssetReceiptView } from "@/features/receipt/receipt";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const receipt = getReceipt((await params).id);
  return { title: `${receipt.title} · Skarl`, description: `Contributed through ${receipt.app.label}.` };
}

export default async function AssetPage({ params }: Props) {
  const receipt = getReceipt((await params).id);
  return (
    <>
      <SiteNav />
      <main className="bg-paper pt-24">
        <AssetReceiptView receipt={receipt} />
      </main>
      <Footer />
    </>
  );
}
